import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { seed, mutate, type State } from "../src/lib/domain.ts";
import { migrate } from "../src/lib/migrations.ts";
import { migrateLife } from "../src/lib/life/schema.ts";
import { lifeDataDirectory } from "../src/lib/life/data-directory.ts";
import {
  saveFragment,
  listFragments,
  deleteFragment,
  readMedia,
} from "../src/lib/life/stories.ts";
import { storePhoto } from "../src/lib/life/media.ts";
import { discoverLife, feedbackIdea } from "../src/lib/life/ideas.ts";
import {
  parseCode,
  sourceURL,
  publicAddress,
  saveSource,
  sourceReply,
} from "../src/lib/life/sources.ts";
import { respond } from "../src/lib/agent/service.ts";
import { listMemories } from "../src/lib/memory/store.ts";
import { reconcileMemories } from "../src/lib/memory/ambient.ts";
import { createLifeGift } from "../src/lib/life/gifts.ts";
test("恢复后回扫仍遵守仅聊天/候选政策，不把候选升级成事实", async () => {
  for (const policy of ["off", "candidates"] as const) {
    const t = fixture();
    try {
      const provider = {
        model: "offline-fixture",
        async generate() {
          return {
            text: JSON.stringify({
              kind: "general",
              answer: "可以继续交流。",
              factIds: [],
              procedureId: null,
              questions: [],
            }),
            model: this.model,
            tokens: null,
          };
        },
      };
      await respond(
        t.db,
        t.read,
        "lin",
        {
          question: "我喜欢绘画",
          mode: "auto",
          memoryPolicy: policy,
          requestId: crypto.randomUUID(),
        },
        provider,
      );
      reconcileMemories(t.db, t.read(), "lin");
      const interests = listMemories(t.db, t.read(), "lin").filter(
        (m) => m.kind === "interest",
      );
      assert.equal(interests.length, policy === "off" ? 0 : 1);
      assert.ok(interests.every((m) => m.status === "candidate"));
    } finally {
      t.db.close();
    }
  }
});
test("生活片段赠礼仅转交明确选中的文字快照，保留作者且不自动采集快照", () => {
  const t = fixture();
  try {
    const f = saveFragment(t.db, t.read, "lin", {
      text: "这只相框的合成来源故事",
      itemIds: ["frame"],
    });
    const gift = createLifeGift(t.db, t.read, "lin", {
      itemId: "frame",
      message: "一份心意",
      fragmentIds: [f.id],
    });
    assert.equal(gift.storySnapshots?.[0].author, "lin");
    assert.equal(gift.stories[0], f.text);
    assert.throws(() =>
      createLifeGift(t.db, t.read, "dad", {
        itemId: "frame",
        message: "越权",
        fragmentIds: [f.id],
      }),
    );
    reconcileMemories(t.db, t.read(), "lin");
    assert.ok(
      !listMemories(t.db, t.read(), "lin").some((m) => m.text === f.text),
    );
    const s = mutate(t.read(), "friend", "claim", {
      token: gift.token,
      received: true,
    });
    t.write(s);
    assert.equal(listFragments(t.db, s, "lin")[0].id, f.id);
    assert.equal(listFragments(t.db, s, "friend").length, 0);
  } finally {
    t.db.close();
  }
});
function fixture() {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "wujian-life-")),
    "test.sqlite",
  );
  const db = new DatabaseSync(file);
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE workspace(id INTEGER PRIMARY KEY,body TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO workspace VALUES(1,?)").run(JSON.stringify(seed()));
  migrate(db, file);
  migrateLife(db, file);
  const read = () =>
    JSON.parse(
      (db.prepare("SELECT body FROM workspace").get() as { body: string }).body,
    ) as State;
  return {
    db,
    file,
    read,
    write: (s: State) =>
      db.prepare("UPDATE workspace SET body=?").run(JSON.stringify(s)),
  };
}
test("新版拒绝旧数据目录及其他工作区；默认独立路径", () => {
  const root = path.resolve("D:/ProductAgent-LifeContext");
  assert.equal(lifeDataDirectory({}, root), path.join(root, "data-life-v1"));
  assert.throws(() =>
    lifeDataDirectory(
      { PRODUCT_AGENT_DATA_DIR: path.join(root, "data") },
      root,
    ),
  );
  assert.throws(() =>
    lifeDataDirectory(
      { PRODUCT_AGENT_DATA_DIR: "D:/ProductAgent-Dev/data" },
      root,
    ),
  );
});
test("生活增量表保留旧库正文、备份并幂等", () => {
  const t = fixture();
  try {
    const before = t.read();
    migrateLife(t.db, t.file);
    assert.deepEqual(t.read(), before);
    assert.ok(existsSync(t.file + ".before-life-v1.sqlite"));
  } finally {
    t.db.close();
  }
});
test("生活片段唯一正文关联多物品，解除关联不删除原文；版本/作者保护", () => {
  const t = fixture();
  try {
    const a = saveFragment(t.db, t.read, "lin", {
      text: "合成毕业旅行",
      itemIds: ["lamp", "frame"],
    });
    assert.equal(listFragments(t.db, t.read(), "lin", "lamp")[0].id, a.id);
    assert.equal(listFragments(t.db, t.read(), "lin", "frame")[0].id, a.id);
    const b = saveFragment(t.db, t.read, "lin", {
      ...{
        id: a.id,
        revision: a.revision,
        text: "更正后的旅行",
        itemIds: ["frame"],
      },
    });
    assert.equal(listFragments(t.db, t.read(), "lin", "lamp").length, 0);
    assert.equal(b.id, a.id);
    assert.throws(() =>
      saveFragment(t.db, t.read, "dad", {
        id: a.id,
        revision: b.revision,
        text: "越权",
        itemIds: [],
      }),
    );
    assert.throws(() => deleteFragment(t.db, t.read(), "lin", a.id, 1));
    deleteFragment(t.db, t.read(), "lin", a.id, b.revision);
    assert.equal(listFragments(t.db, t.read(), "lin").length, 0);
  } finally {
    t.db.close();
  }
});
test("图片验证、去元数据、权限读取及删除清理同一事务", async () => {
  const t = fixture();
  try {
    const bytes = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "red" },
    })
      .jpeg()
      .toBuffer();
    const photo = await storePhoto(t.db, "lin", bytes);
    const a = saveFragment(t.db, t.read, "lin", {
      text: "测试照片",
      mediaId: photo.id,
      itemIds: [],
    });
    assert.throws(() => readMedia(t.db, t.read(), "dad", photo.id));
    assert.equal(
      (await sharp(readMedia(t.db, t.read(), "lin", photo.id).body).metadata())
        .exif,
      undefined,
    );
    deleteFragment(t.db, t.read(), "lin", a.id, a.revision);
    assert.throws(() => readMedia(t.db, t.read(), "lin", photo.id));
    await assert.rejects(() =>
      storePhoto(t.db, "lin", new TextEncoder().encode("not an image at all")),
    );
  } finally {
    t.db.close();
  }
});
test("编码只解析实际内容；内网、IP及带凭证链接被拒", () => {
  assert.equal(parseCode("6901234567892").type, "barcode");
  assert.equal(parseCode("https://example.org/a").type, "url");
  for (const url of [
    "http://example.org",
    "https://127.0.0.1",
    "https://user:pass@example.org",
    "https://localhost",
  ])
    assert.throws(() => sourceURL(url));
  for (const ip of [
    "127.0.0.1",
    "10.2.3.4",
    "169.254.1.2",
    "::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(publicAddress(ip), false);
});
test("新物品ID也参与创意；状态变化阻止尝试；跳过反馈影响下一次", () => {
  const t = fixture();
  try {
    let s = mutate(t.read(), "lin", "createItem", {
      name: "新的台灯",
      category: "照明",
    });
    const i = s.items.at(-1)!;
    s = mutate(s, "lin", "updateItem", {
      itemId: i.id,
      availability: "available",
    });
    t.write(s);
    const ideas = discoverLife(t.db, s, "lin", { goal: "摄影", itemId: i.id });
    assert.ok(ideas.length > 0);
    assert.ok(ideas[0].itemIds.includes(i.id));
    assert.equal(ideas[0].tested, false);
    s = mutate(s, "lin", "updateItem", {
      itemId: i.id,
      availability: "loaned",
    });
    assert.throws(() =>
      feedbackIdea(t.db, s, "lin", {
        id: ideas[0].id,
        saved: true,
        outcome: "准备尝试",
      }),
    );
    assert.equal(
      discoverLife(t.db, s, "lin", { goal: "摄影", itemId: i.id }).length,
      0,
    );
  } finally {
    t.db.close();
  }
});
test("上传资料是用户提供的摘录，物品共享不自动分享私有文件", () => {
  const t = fixture();
  try {
    saveSource(t.db, t.read(), "lin", {
      itemId: "lamp",
      title: "手工测试说明",
      text: "清洁要求：只用干燥软布，具体条件以原说明为准。",
      kind: "user-text",
    });
    assert.match(
      sourceReply(t.db, t.read(), "lin", "lamp", "清洁要求")!.answer,
      /干燥软布/,
    );
    assert.equal(
      sourceReply(t.db, t.read(), "dad", "lamp", "清洁要求"),
      undefined,
    );
  } finally {
    t.db.close();
  }
});
test("新版聊天候选不自动召回，普通消息保留连续性且不自动写原故事", async () => {
  const t = fixture();
  try {
    const inputs: unknown[] = [];
    const provider = {
      model: "offline-protocol-fixture",
      async generate(_s: string, i: unknown) {
        inputs.push(i);
        return {
          text: JSON.stringify({
            kind: "general",
            answer: "可以继续聊。",
            factIds: [],
            procedureId: null,
            questions: [],
          }),
          model: this.model,
          tokens: null,
        };
      },
    };
    const first = await respond(
      t.db,
      t.read,
      "lin",
      {
        question: "我喜欢摄影",
        mode: "auto",
        memoryPolicy: "candidates",
        requestId: crypto.randomUUID(),
      },
      provider,
    );
    assert.ok(
      listMemories(t.db, t.read(), "lin").every(
        (m) => m.status === "candidate",
      ),
    );
    await respond(
      t.db,
      t.read,
      "lin",
      {
        question: "那今天想聊点别的",
        mode: "auto",
        memoryPolicy: "candidates",
        sessionId: first.session.id,
        expectedRevision: first.session.revision,
        requestId: crypto.randomUUID(),
      },
      provider,
    );
    assert.match(JSON.stringify(inputs.at(-1)), /我喜欢摄影/);
    assert.equal(t.read().memories.length, seed().memories.length);
  } finally {
    t.db.close();
  }
});
