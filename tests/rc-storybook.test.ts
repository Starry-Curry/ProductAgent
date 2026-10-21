import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import {
  saveFragment,
  listFragments,
  deleteFragment,
} from "../src/lib/life/stories.ts";
import { buildContext } from "../src/lib/context/builder.ts";
import { mutate } from "../src/lib/domain.ts";
import { epoch } from "../src/lib/memory/store.ts";
import { installLifeDemo } from "../src/lib/life/demo.ts";

test("演示故事独立场景配图、多照片、明确虚构；重复安装不改写已有记录", () => {
  const t = validationFixture(
    fs.mkdtempSync(path.join(process.cwd(), ".runtime", "storybook-demo-")),
  );
  try {
    installLifeDemo(t.db);
    const fragments = listFragments(t.db, t.read(), "lin");
    assert.equal(fragments.length, 4);
    assert.deepEqual(
      fragments.map((f) => f.mediaIds?.length).sort(),
      [0, 0, 1, 2],
    );
    for (const f of fragments) {
      assert.equal(f.demo, true);
      assert.equal(f.origin, "fiction");
      assert.equal(f.allowRecall, false);
      assert.equal(f.allowCloud, false);
      assert.ok(!/合成验收|验收旅行|合成案例|合成图文/.test(f.text));
    }
    const inventoryPhotos = new Set(
      fs
        .readdirSync("public/demo/life")
        .filter((n) => n.endsWith(".jpg"))
        .map((n) =>
          fs.readFileSync(path.join("public/demo/life", n)).toString("base64"),
        ),
    );
    const media = t.db.prepare("SELECT body FROM life_media").all() as {
      body: Uint8Array;
    }[];
    assert.equal(media.length, 3);
    for (const photo of media)
      assert.ok(
        !inventoryPhotos.has(Buffer.from(photo.body).toString("base64")),
      );
    const original = fragments[0];
    t.db
      .prepare("UPDATE life_fragments SET text=? WHERE id=?")
      .run("本人修改的演示原文，不应被替换。", original.id);
    installLifeDemo(t.db);
    const after = listFragments(t.db, t.read(), "lin");
    assert.equal(after.length, 4);
    assert.equal(
      after.find((f) => f.id === original.id)?.text,
      "本人修改的演示原文，不应被替换。",
    );
  } finally {
    t.db.close();
  }
});

test("允许上云不等于本次相关：仅选当前回忆主题，商品指导和临时聊天不取故事", () => {
  const t = validationFixture(
    fs.mkdtempSync(path.join(process.cwd(), ".runtime", "rc-relevance-")),
  );
  try {
    const relevant = saveFragment(t.db, t.read, "lin", {
      text: "合成测试：在阳台画画。",
      itemIds: [],
      allowRecall: true,
      allowCloud: true,
    });
    saveFragment(t.db, t.read, "lin", {
      text: "合成测试：昨天读完一本书。",
      itemIds: [],
      allowRecall: true,
      allowCloud: true,
    });
    const input = { question: "回忆阳台画画的故事", mode: "companion" };
    assert.deepEqual(
      buildContext(t.db, t.read(), "lin", input).cloudFragments.map(
        (f) => f.id,
      ),
      [relevant.id],
    );
    assert.equal(
      buildContext(t.db, t.read(), "lin", { ...input, temporary: true })
        .cloudFragments.length,
      0,
    );
    assert.equal(
      buildContext(t.db, t.read(), "lin", {
        question: "怎么清洗杯子",
        mode: "service",
      }).cloudFragments.length,
      0,
    );
  } finally {
    t.db.close();
  }
});

test("故事书同一正文、多照片/日期、并发编辑、赠出保留、撤销授权与媒体清理", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), ".runtime", "rc-story-")),
    t = validationFixture(dir);
  try {
    const a = t.add("测试杯", "厨房用品", "合成", "C1"),
      b = t.add("测试笔", "文具", "合成", "P1");
    const image = crypto.randomUUID(),
      image2 = crypto.randomUUID();
    for (const id of [image, image2])
      t.db
        .prepare("INSERT INTO life_media VALUES(?,?,?,?)")
        .run(id, "lin", "image/jpeg", new Uint8Array([1, 2, 3]));
    let f = saveFragment(t.db, t.read, "lin", {
      text: "合成测试：散步后画下杯子的轮廓。",
      itemIds: [a, b],
      mediaIds: [image, image2],
      capturedOn: "2026-10-19",
    });
    assert.equal(
      listFragments(t.db, t.read(), "lin", a)[0].id,
      listFragments(t.db, t.read(), "lin", b)[0].id,
    );
    assert.equal(f.mediaIds.length, 2);
    assert.equal(f.capturedOn, "2026-10-19");
    const context = () =>
      buildContext(t.db, t.read(), "lin", {
        question: "回忆我保存的生活故事",
        mode: "companion",
      });
    assert.equal(context().cloudFragments.length, 0);
    f = saveFragment(t.db, t.read, "lin", {
      id: f.id,
      revision: f.revision,
      text: f.text,
      itemIds: [a, b],
      allowCloud: true,
    });
    assert.equal(context().cloudFragments[0].id, f.id);
    assert.equal(
      buildContext(t.db, t.read(), "friend", {
        question: "回忆生活故事",
        mode: "companion",
      }).cloudFragments.length,
      0,
    );
    assert.equal(
      buildContext(t.db, t.read(), "lin", {
        question: "这件怎么用",
        mode: "service",
        itemId: a,
      }).cloudFragments.length,
      0,
    );
    const before = epoch(t.db, "lin");
    f = saveFragment(t.db, t.read, "lin", {
      id: f.id,
      revision: f.revision,
      text: "合成测试：已纠正。",
      itemIds: [a],
      mediaIds: [image2],
      capturedOn: null,
      allowRecall: false,
      allowCloud: false,
    });
    assert.ok(epoch(t.db, "lin") > before);
    assert.equal(context().cloudFragments.length, 0);
    assert.equal(f.capturedOn, null);
    assert.equal(listFragments(t.db, t.read(), "lin", b).length, 0);
    assert.equal(
      t.db.prepare("SELECT 1 FROM life_media WHERE id=?").get(image),
      undefined,
    );
    assert.throws(
      () =>
        saveFragment(t.db, t.read, "lin", {
          id: f.id,
          revision: f.revision - 1,
          text: "旧版本",
          itemIds: [],
        }),
      /更新/,
    );
    let s = mutate(t.read(), "lin", "gift", { itemId: a, memoryIds: [] });
    s = mutate(s, "friend", "claim", {
      token: s.gifts.at(-1)!.token,
      received: true,
    });
    t.write(s);
    assert.equal(
      listFragments(t.db, t.read(), "lin").find((x) => x.id === f.id)?.text,
      f.text,
    );
    assert.equal(listFragments(t.db, t.read(), "friend").length, 0);
    deleteFragment(t.db, t.read(), "lin", f.id, f.revision);
    assert.equal(
      t.db.prepare("SELECT 1 FROM life_media WHERE id=?").get(image2),
      undefined,
    );
    assert.equal(
      t.db.prepare("SELECT count(*) n FROM life_fragment_details").get()?.n,
      0,
    );
  } finally {
    t.db.close();
  }
});
