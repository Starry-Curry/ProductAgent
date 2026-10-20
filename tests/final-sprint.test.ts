import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { saveFragment } from "../src/lib/life/stories.ts";
import {
  suggestStoryOrganization,
  organizeStories,
  storyOrganization,
} from "../src/lib/life/organization.ts";
import { matchStoryPhoto } from "../src/lib/life/story-photo.ts";
import { storePhoto } from "../src/lib/life/media.ts";
import { modelIdea } from "../src/lib/life/ideas.ts";
import { completedStepOrdinal, respond } from "../src/lib/agent/service.ts";
import { groundedReply } from "../src/lib/skills/document-help.ts";
const fixture = () =>
  validationFixture(
    fs.mkdtempSync(path.join(process.cwd(), ".runtime", "final-unit-")),
  );
test("步骤完成语序互换与否定不会丢失/误记进度", () => {
  assert.equal(completedStepOrdinal("第一步已经完成了，接下来呢？"), 1);
  assert.equal(completedStepOrdinal("我已经做过第二步了"), 2);
  assert.equal(completedStepOrdinal("第一步还没有完成"), undefined);
  assert.equal(completedStepOrdinal("我没做过第一步"), undefined);
});
test("非关键阶段字段和一条格式错误不丢弃其余有据步骤", () => {
  const evidence: any = [
    {
      id: "e",
      category: "operation",
      model: "X",
      text: "Press the power button. Unplug before cleaning.",
      url: "https://example.org/manual",
      title: "X manual",
      start: 0,
      end: 80,
    },
  ];
  const r = groundedReply(
    {
      kind: "grounded",
      answer: "继续",
      steps: [
        { text: "按电源按钮", sourceIds: ["e"], phase: "unexpected-label" },
        { text: "缺少引用字段" },
      ],
    },
    evidence,
    { tried: [] },
  );
  assert.equal(r.steps.length, 1);
  assert.match(r.caveat!, /隐藏1条/);
});
test("无专属资料的已知型号续接不转为凭空猜指示灯/按钮，也不重复发送模型请求", async () => {
  const t = fixture(),
    before = process.env.WUJIAN_ALLOW_PUBLIC_FETCH;
  process.env.WUJIAN_ALLOW_PUBLIC_FETCH = "true";
  try {
    const id = t.add("未知测试设备", "电子设备", "NoSuchBrand", "NO-SUCH-917");
    let calls = 0;
    const provider = {
      model: "offline",
      ready: true,
      generate: async () => {
        calls++;
        throw Error("must not guess");
      },
    };
    const a = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        itemId: id,
        question: "第一次怎么用？",
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { page: "item" },
      },
      provider,
    );
    const b = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        itemId: id,
        sessionId: a.session.id,
        question: "第一步已经完成，下一步呢？",
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { page: "item" },
      },
      provider,
    );
    assert.equal(calls, 0);
    assert.equal(b.reply.steps.length, 0);
    assert.match(b.reply.answer, /未取得可靠/);
  } finally {
    t.db.close();
    if (before === undefined) delete process.env.WUJIAN_ALLOW_PUBLIC_FETCH;
    else process.env.WUJIAN_ALLOW_PUBLIC_FETCH = before;
  }
});
test("语义建议仅用获准文字；章节待确认、拒绝不复现；不从单事件推出习惯，撤销使候选失效", async () => {
  const t = fixture();
  try {
    const a = saveFragment(t.db, t.read, "lin", {
      text: "周六沿河散步，拍下了桥上的灯光。我喜欢轻装摄影。",
      capturedOn: "2026-09-12",
      allowRecall: true,
      allowCloud: true,
    });
    const b = saveFragment(t.db, t.read, "lin", {
      text: "又带轻便相机去河边拍傍晚的桥。",
      capturedOn: "2026-09-19",
      allowRecall: true,
      allowCloud: true,
    });
    const privateStory = saveFragment(t.db, t.read, "lin", {
      text: "不允许上云的私人故事",
      allowRecall: true,
      allowCloud: false,
    });
    let calls = 0;
    const provider = {
      model: "offline",
      generate: async (_s: string, input: any) => {
        calls++;
        assert.equal(input.events.length, 2);
        assert.ok(!JSON.stringify(input).includes(privateStory.text));
        return {
          model: "offline",
          tokens: null,
          text: JSON.stringify({
            chapters: [
              {
                name: "河畔摄影",
                reason: "同一河边桥梁的两次拍摄，不合并为同次事件",
                members: [
                  { fragmentId: a.id, quote: "沿河散步" },
                  { fragmentId: b.id, quote: "拍傍晚的桥" },
                ],
              },
            ],
            understanding: [
              {
                text: "我喜欢轻装摄影。",
                quote: "我喜欢轻装摄影。",
                basis: "explicit-statement",
                fragmentIds: [a.id],
                scope: "摄影,旅行",
              },
              {
                text: "喜欢每天运动",
                basis: "repeated-tendency",
                fragmentIds: [b.id],
                scope: "运动",
              },
            ],
          }),
        };
      },
    };
    await assert.rejects(
      suggestStoryOrganization(
        t.db,
        t.read,
        "lin",
        { confirmed: true, fragmentIds: [privateStory.id] },
        provider,
      ),
      /上云/,
    );
    assert.equal(calls, 0);
    const input = { confirmed: true, fragmentIds: [a.id, b.id] };
    const r = await suggestStoryOrganization(
      t.db,
      t.read,
      "lin",
      input,
      provider,
    );
    assert.equal(r.chapters.length, 0);
    assert.equal(r.chapterSuggestions.length, 1);
    assert.equal(r.understanding.length, 1);
    const c = r.chapterSuggestions[0];
    organizeStories(t.db, t.read, "lin", {
      command: "rejectChapter",
      id: c.id,
      revision: c.revision,
    });
    const u = r.understanding[0];
    organizeStories(t.db, t.read, "lin", { command: "reject", id: u.id });
    const again = await suggestStoryOrganization(
      t.db,
      t.read,
      "lin",
      input,
      provider,
    );
    assert.equal(again.chapterSuggestions.length, 0);
    assert.equal(
      again.understanding.filter((u) => u.status === "candidate").length,
      0,
    );
    assert.equal(
      t.db.prepare("SELECT count(*) n FROM life_fragments").get()!.n,
      3,
      "章节不复制原事件",
    );
  } finally {
    t.db.close();
  }
});
test("视觉描述可匹配有修饰词的已登记种类；模糊品牌不排除、同类不自动确认、未知为空", async () => {
  const t = fixture();
  try {
    const ids = [
      t.add("我的旅行相机", "电子设备", "已知品牌", "A"),
      t.add("备用相机", "电子设备", "已知品牌", "A"),
    ];
    const media = await storePhoto(
      t.db,
      "lin",
      await sharp({
        create: { width: 100, height: 100, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer(),
    );
    const r = await matchStoryPhoto(
      t.db,
      t.read,
      "lin",
      { mediaId: media.id, confirmed: true },
      {
        AI_API_KEY: "offline",
        AI_MODEL: "offline",
        AI_BASE_URL: "https://example.org/v1",
        AI_VISION_MODEL: "offline",
        AI_ALLOW_PAID_CALLS: "true",
        WUJIAN_ALLOW_PAID_CALLS: "true",
      },
      {
        model: "offline",
        generate: async () => {
          throw Error("unused");
        },
        recognize: async () => ({
          model: "offline",
          tokens: null,
          text: JSON.stringify({
            candidates: [
              {
                name: "黑色数码相机",
                brand: "猜测品牌",
                model: "猜测型号",
                basis: "visual-inference",
                uncertainties: ["铭牌不可读"],
              },
              {
                name: "雨伞",
                basis: "visual-inference",
                uncertainties: ["未知物品"],
              },
            ],
          }),
        }),
      },
    );
    assert.deepEqual(
      r.matches[0].candidates.map((c) => c.itemId),
      ids,
    );
    assert.equal(r.matches[0].observation.brand, undefined);
    assert.equal(r.matches[0].observation.model, undefined);
    assert.equal(r.matches[1].candidates.length, 0);
    assert.ok(r.matches.every((m) => m.uncertain));
  } finally {
    t.db.close();
  }
});
test("数字照片不能绕过缺少打印与粘贴材料的资源检查", async () => {
  const t = fixture();
  try {
    const camera = t.add("相机", "电子设备", "", ""),
      paper = t.add("纸笔", "文具", "", "");
    await assert.rejects(
      modelIdea(
        t.db,
        t.read(),
        "lin",
        "只用已有相机和纸笔做创作",
        {
          model: "offline",
          generate: async () => ({
            model: "offline",
            tokens: null,
            text: JSON.stringify({
              title: "纸上照片",
              itemIds: [camera, paper],
              minutes: 10,
              steps: ["拍下照片，把照片贴在纸上"],
              limits: ["不改变设备"],
            }),
          }),
        },
        false,
        t.read,
      ),
      /数字照片/,
    );
  } finally {
    t.db.close();
  }
});
