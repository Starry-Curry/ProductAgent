import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { saveFragment, deleteFragment } from "../src/lib/life/stories.ts";
import {
  organizeStories,
  storyOrganization,
} from "../src/lib/life/organization.ts";
import { recallLifeFragments } from "../src/lib/life/recall.ts";
import { storePhoto } from "../src/lib/life/media.ts";
import { matchStoryPhoto } from "../src/lib/life/story-photo.ts";
import { buildContext } from "../src/lib/context/builder.ts";
import { savePersona, listMemories } from "../src/lib/memory/store.ts";
import { mutate } from "../src/lib/domain.ts";
const fixture = () =>
  validationFixture(
    mkdtempSync(path.join(process.cwd(), ".runtime", "personal-rc-")),
  );

test("30事件：相关召回、章节引用/拆分/改名/删除不复制、候选去重/拒绝/纠正/撤销、赠后隐私", () => {
  const t = fixture();
  try {
    const item = t.add("测试旅行包", "服装", "测试", "BAG1");
    const events = Array.from({ length: 30 }, (_, i) =>
      saveFragment(t.db, t.read, "lin", {
        text:
          i === 0
            ? "我喜欢轻装旅行。今天用旅行包试装。"
            : i === 1
              ? "这次旅行准备了轻便相机。"
              : i === 2
                ? "今天很开心，也许想出去。"
                : `合成测试第${i}段：在家整理书架。`,
        capturedOn: `2026-09-${String(i + 1).padStart(2, "0")}`,
        itemIds: i < 2 ? [item] : [],
        allowRecall: true,
        allowCloud: true,
      }),
    );
    const duplicate = saveFragment(t.db, t.read, "lin", {
      text: events[0].text,
      capturedOn: events[0].capturedOn,
      itemIds: [item],
      allowRecall: true,
      allowCloud: true,
    });
    assert.equal(duplicate.id, events[0].id);
    let data = organizeStories(t.db, t.read, "lin", {
      command: "chapter",
      name: "轻装出游",
      fragmentIds: [events[0].id, events[1].id],
    });
    let chapter = data.chapters[0];
    assert.equal(
      recallLifeFragments(t.db, t.read(), "lin", "回忆轻装出游")!.memoryIds
        .length,
      2,
    );
    assert.deepEqual(
      new Set(
        recallLifeFragments(t.db, t.read(), "lin", "回忆旅行")!.memoryIds,
      ),
      new Set([events[0].id, events[1].id]),
    );
    data = organizeStories(t.db, t.read, "lin", {
      command: "chapter",
      id: chapter.id,
      revision: chapter.revision,
      name: "轻装旅行",
      fragmentIds: [events[0].id],
    });
    chapter = data.chapters[0];
    assert.equal(chapter.fragmentIds.length, 1);
    organizeStories(t.db, t.read, "lin", { command: "extract" });
    let u = storyOrganization(t.db, t.read(), "lin").understanding;
    assert.equal(u.length, 1);
    assert.equal(u[0].status, "candidate");
    const ctx = (question: string, temporary = false) =>
      buildContext(t.db, t.read(), "lin", {
        question,
        mode: "ideas",
        temporary,
      });
    assert.equal(ctx("旅行准备").cloudMemories.length, 0);
    organizeStories(t.db, t.read, "lin", {
      command: "confirm",
      id: u[0].id,
      text: "我偏好轻装旅行",
      scope: "旅行,出游",
      allowCloud: true,
    });
    assert.ok(
      ctx("旅行准备").cloudMemories.some((m) => m.text === "我偏好轻装旅行"),
    );
    assert.equal(ctx("如何给耳机充电").cloudMemories.length, 0);
    assert.equal(ctx("随便聊聊").cloudMemories.length, 0);
    assert.equal(ctx("旅行准备", true).cloudMemories.length, 0);
    savePersona(t.db, t.read(), "lin", {
      enabled: false,
      nickname: "物间",
      style: "warm",
      memoryUse: "off",
    });
    assert.equal(ctx("旅行准备").cloudMemories.length, 0);
    savePersona(t.db, t.read(), "lin", {
      enabled: false,
      nickname: "物间",
      style: "neutral",
      memoryUse: "relevant",
    });
    assert.equal(ctx("旅行准备").cloudMemories.length, 1);
    organizeStories(t.db, t.read, "lin", { command: "reject", id: u[0].id });
    organizeStories(t.db, t.read, "lin", { command: "extract" });
    assert.equal(
      storyOrganization(t.db, t.read(), "lin").understanding.length,
      1,
    );
    assert.equal(ctx("旅行准备").cloudMemories.length, 0);
    // New evidence is a new statement, old evidence cannot resurrect rejected context.
    let f = saveFragment(t.db, t.read, "lin", {
      text: "我喜欢旅行时拍建筑",
      itemIds: [item],
      allowRecall: true,
      allowCloud: true,
    });
    organizeStories(t.db, t.read, "lin", { command: "extract" });
    u = storyOrganization(t.db, t.read(), "lin").understanding;
    const candidate = u.find((c) => c.status === "candidate")!;
    organizeStories(t.db, t.read, "lin", {
      command: "confirm",
      id: candidate.id,
      scope: "旅行",
      allowCloud: true,
    });
    assert.equal(ctx("旅行准备").cloudMemories.length, 1);
    f = saveFragment(t.db, t.read, "lin", {
      id: f.id,
      revision: f.revision,
      text: f.text,
      itemIds: [item],
      allowRecall: false,
      allowCloud: false,
    });
    assert.equal(ctx("旅行准备").cloudMemories.length, 0);
    assert.equal(
      listMemories(t.db, t.read(), "lin").filter(
        (m) => m.provenance?.extractor === "confirmed-story-statement-v1",
      ).length,
      0,
    );
    let state = mutate(t.read(), "lin", "gift", {
      itemId: item,
      memoryIds: [],
    });
    state = mutate(state, "friend", "claim", {
      token: state.gifts.at(-1)!.token,
      received: true,
    });
    t.write(state);
    assert.equal(
      storyOrganization(t.db, t.read(), "friend").chapters.length,
      0,
    );
    assert.equal(
      storyOrganization(t.db, t.read(), "lin").chapters[0].fragmentIds.length,
      1,
    );
    organizeStories(t.db, t.read, "lin", {
      command: "deleteChapter",
      id: chapter.id,
      revision: chapter.revision,
    });
    assert.equal(storyOrganization(t.db, t.read(), "lin").chapters.length, 0);
    assert.equal(
      t.db.prepare("SELECT count(*) n FROM life_fragments").get()!.n,
      31,
    );
    deleteFragment(t.db, t.read(), "lin", f.id, f.revision);
  } finally {
    t.db.close();
  }
});

test("合成照片离线视觉协议：两物品、多同型号候选与未知对象，不自动关联/不跨人；重复图片复用媒体", async () => {
  const t = fixture();
  try {
    const a = t.add("手电筒", "电子设备", "测试", "LIGHT1"),
      b = t.add("透明杯", "厨房用品", "测试", "CUP1"),
      c = t.add("另一只透明杯", "厨房用品", "测试", "CUP1");
    const image = await sharp({
      create: { width: 160, height: 100, channels: 3, background: "#f3ecd9" },
    })
      .jpeg()
      .toBuffer();
    const photo = await storePhoto(t.db, "lin", image);
    assert.equal((await storePhoto(t.db, "lin", image)).id, photo.id);
    const env = {
      AI_API_KEY: "offline-fixture",
      AI_BASE_URL: "https://example.org/v1",
      AI_MODEL: "test",
      AI_VISION_MODEL: "offline-vision",
      AI_ALLOW_PAID_CALLS: "true",
      WUJIAN_ALLOW_PAID_CALLS: "true",
    };
    const result = await matchStoryPhoto(
      t.db,
      t.read,
      "lin",
      { mediaId: photo.id, confirmed: true },
      env,
      {
        model: "offline-vision",
        generate: async () => {
          throw Error("unused");
        },
        recognize: async () => ({
          text: JSON.stringify({
            candidates: [
              {
                name: "手电筒",
                basis: "visual-inference",
                uncertainties: ["实例待确认"],
              },
              {
                name: "透明杯",
                model: "CUP1",
                observedText: "CUP1",
                basis: "visible-text",
                uncertainties: ["可能同型号"],
              },
              {
                name: "未知花瓶",
                basis: "visual-inference",
                uncertainties: ["未录入"],
              },
            ],
          }),
          model: "offline-vision",
          tokens: null,
        }),
      },
    );
    assert.deepEqual(
      result.matches[0].candidates.map((c) => c.itemId),
      [a],
    );
    assert.deepEqual(
      new Set(result.matches[1].candidates.map((c) => c.itemId)),
      new Set([b, c]),
    );
    assert.equal(result.matches[2].candidates.length, 0);
    assert.ok(result.matches.every((m) => m.uncertain));
    assert.equal(
      t.db.prepare("SELECT count(*) n FROM life_fragment_items").get()!.n,
      0,
    );
    await assert.rejects(
      matchStoryPhoto(
        t.db,
        t.read,
        "friend",
        { mediaId: photo.id, confirmed: true },
        env,
      ),
      /授权/,
    );
  } finally {
    t.db.close();
  }
});
