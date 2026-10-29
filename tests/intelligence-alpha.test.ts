import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { installAlphaSamples } from "../src/lib/life/alpha-samples.ts";
import { alphaProductPacks } from "../src/lib/catalog/alpha-products.ts";
import { sharedItemKnowledge } from "../src/lib/context/knowledge.ts";
import {
  creativeFacts,
  creativeReasoningSchema,
  checkCreativeReasoning,
} from "../src/lib/life/creative-reasoning.ts";
import {
  validateProposals,
  proposeMemories,
} from "../src/lib/memory/proposals.ts";
import { captureEvent, setCaptureEnabled } from "../src/lib/memory/ambient.ts";
import {
  listMemories,
  saveMemory,
  forgetMemory,
  recallMemories,
} from "../src/lib/memory/store.ts";
import { respond } from "../src/lib/agent/service.ts";
import { modelIdea, listLifeIdeas } from "../src/lib/life/ideas.ts";
import { auditIdeaActions } from "../src/lib/life/idea-audit.ts";
import type { Provider } from "../src/lib/ai/provider.ts";
import { normalizeCreativePacket } from "../src/lib/life/creative-reasoning.ts";
import { captureWorkspace } from "../src/lib/memory/ambient.ts";
import {
  isRelationshipFactQuestion,
  canComposeInCloud,
  validateStorytelling,
  planMemoryStory,
} from "../src/lib/skills/memory-storytelling.ts";
import { buildContext } from "../src/lib/context/builder.ts";
import { planDiscovery } from "../src/lib/life/planning.ts";
const fixture = () =>
  validationFixture(mkdtempSync(path.resolve(".runtime/alpha-unit-")));
const off: Provider = {
  model: "offline",
  ready: false,
  generate: async () => {
    throw Error("unexpected");
  },
};
function create() {
  const t = fixture();
  const box = t.add("旧纸盒", "手工", "", "未知", {
    attributes: { material: "纸板", dimensions: "20×15×10厘米", quantity: 1 },
  });
  return { ...t, box };
}
test("测试商品只按明确动作追加，重放保留修改且不会污染其它角色", () => {
  const t = fixture();
  try {
    const before = t.read().items.length;
    const first = installAlphaSamples(t.db, t.read, "lin");
    assert.equal(t.read().items.length, before + 2);
    const s = t.read();
    s.items.find((i) => i.id === first.itemIds[0])!.note = "保留我的编辑";
    t.write(s);
    installAlphaSamples(t.db, t.read, "lin");
    assert.equal(t.read().items.length, before + 2);
    assert.equal(
      t.read().items.find((i) => i.id === first.itemIds[0])!.note,
      "保留我的编辑",
    );
    assert.throws(() => sharedItemKnowledge(t.read(), "dad", first.itemIds));
    assert(
      t
        .read()
        .items.filter((i) => first.itemIds.includes(i.id))
        .every((i) => i.synthetic && !i.shared && !i.demo),
    );
  } finally {
    t.db.close();
  }
});
test("商品事实绑定准确型号和版本，未知性能不升级为事实", () => {
  const t = fixture();
  try {
    const { itemIds } = installAlphaSamples(t.db, t.read, "lin");
    const cards = sharedItemKnowledge(t.read(), "lin", itemIds).items;
    assert.equal(cards.length, 2);
    assert(cards[0].productUnderstanding);
    assert(
      cards.some((c) =>
        c.officialFacts.some((f) => f.text.includes("不可直接接触食物")),
      ),
    );
    assert(cards.some((c) => c.limits.some((l) => l.includes("2公斤"))));
    const s = t.read();
    s.items.find((i) => i.id === itemIds[0])!.model = "other-model";
    assert.equal(
      sharedItemKnowledge(s, "lin", [itemIds[0]]).items[0].productUnderstanding,
      null,
    );
  } finally {
    t.db.close();
  }
});
test("来源属性引用存在且用途推导有条件，两个资料包没有通用安全保证", () => {
  for (const p of alphaProductPacks) {
    for (const prop of p.understanding!.properties)
      assert(prop.factIds.every((id) => p.claims.some((c) => c.id === id)));
    for (const x of p.understanding!.possibilities) {
      assert(x.conditions.length);
      assert(x.basisFactIds.every((id) => p.claims.some((c) => c.id === id)));
    }
    assert(p.understanding!.unknowns.length);
  }
});
test("未知材质与空能力不生成可引用事实", () => {
  const t = fixture();
  try {
    const id = t.add("画", "装饰", "", "未知");
    assert(
      !creativeFacts(t.read().items.filter((i) => i.id === id))[0].facts.some(
        (f) => f.ref.endsWith("/material"),
      ),
    );
  } finally {
    t.db.close();
  }
});
const reasoning = (id: string) => ({
  outcome: "用纸盒遮挡一部分画，形成有揭晓顺序的口述故事",
  roles: [
    {
      itemId: id,
      factRefs: [id + "/material"],
      function: "遮挡视线",
      contribution: "用盒体遮住部分场景再揭晓",
    },
  ],
  checks: [
    {
      condition: "不透明且能手持",
      method: "在平放状态遮住自己的手试看",
      ifFail: "停止此方案",
    },
  ],
  extraResources: [],
  preferenceIds: [],
});
test("开放用途推导接受真实属性，依旧明确是待验证假设", () => {
  const t = create();
  try {
    const r = creativeReasoningSchema.parse(reasoning(t.box));
    assert.equal(
      checkCreativeReasoning(r, t.read().items, [t.box], [], true),
      r,
    );
  } finally {
    t.db.close();
  }
});
for (const [name, mutate] of [
  ["伪造耐热事实", (r: any) => (r.roles[0].factRefs = ["fake/heat"])],
  ["跨物品偷用来源", (r: any) => (r.roles[0].itemId = "other")],
  ["隐含额外资源", (r: any) => (r.extraResources = ["胶带"])],
  ["越权偏好", (r: any) => (r.preferenceIds = ["private-other-owner"])],
  ["缺少实际物品角色", (r: any) => (r.roles = [])],
] as const)
  test("创意契约拒绝" + name, () => {
    const t = create();
    try {
      const r = reasoning(t.box);
      mutate(r);
      assert.throws(() =>
        checkCreativeReasoning(r, t.read().items, [t.box], [], true),
      );
    } finally {
      t.db.close();
    }
  });
test("否定粘贴不消耗胶带，后续真正粘贴不能被前一句否定遮蔽", () => {
  const t = create();
  try {
    const items = t.read().items.filter((i) => i.id === t.box);
    assert.equal(
      auditIdeaActions("只用登记物品", items, {
        itemIds: [t.box],
        steps: ["不粘贴、不固定；手持纸盒遮住自己的手"],
      }).issues.length,
      0,
    );
    assert(
      auditIdeaActions("只用登记物品", items, {
        itemIds: [t.box],
        steps: ["不裁剪，粘贴到桌面"],
      }).issues.some((i) => i.code === "implicit-tool"),
    );
  } finally {
    t.db.close();
  }
});
test("模型只能提议连续原话，不能添加关系日期或推测人格", () => {
  const text = "这幅画是朋友小夏送我的，我最近在学水彩。";
  const v = validateProposals(
    {
      candidates: [
        { kind: "relationship", quote: "这幅画是朋友小夏送我的" },
        { kind: "interest", quote: "我最近在学水彩" },
        { kind: "relationship", quote: "小夏在生日送给我画" },
      ],
    },
    text,
  );
  assert.equal(v.length, 2);
  assert(v.every((x) => text.includes(x.text)));
  assert(!JSON.stringify(v).includes("生日"));
});
test("近期目标有期限、重复原话只生成一个候选", () => {
  const v = validateProposals(
    {
      candidates: [
        { kind: "requirement", quote: "我最近想练习讲故事" },
        { kind: "requirement", quote: "我最近想练习讲故事" },
      ],
    },
    "我最近想练习讲故事",
  );
  assert.equal(v.length, 1);
  assert(v[0].expiresAt);
});
test("不记忆和敏感信息不触发候选模型请求", async () => {
  let calls = 0;
  const p = {
    ...off,
    generate: async () => {
      calls++;
      return { text: "{}", model: "stub", tokens: null };
    },
  };
  for (const text of ["不要记住我喜欢安静", "我的密码是 private-fixture"]) {
    const out = await proposeMemories(p, text);
    assert.equal(out.candidates.length, 0);
  }
  assert.equal(calls, 0);
});
test("候选确认前不召回，确认跨会话可用，纠正锁定旧认识，遗忘不再复活", () => {
  const t = create();
  try {
    const text = "这件物品是朋友小夏送我的";
    const candidates = validateProposals(
      { candidates: [{ kind: "relationship", quote: text }] },
      text,
    );
    const event = {
      id: crypto.randomUUID(),
      kind: "chat" as const,
      text,
      itemId: t.box,
      sessionId: crypto.randomUUID(),
      at: new Date().toISOString(),
      basis: "user_statement" as const,
      pending: true,
      candidates,
    };
    const [candidate] = captureEvent(t.db, t.read(), "lin", event);
    assert.equal(candidate.status, "candidate");
    assert.equal(candidate.allowCloud, false);
    assert.equal(
      recallMemories(t.db, t.read(), "lin", "还记得谁送的吗", "story", t.box)
        .length,
      0,
    );
    let saved = saveMemory(
      t.db,
      t.read,
      "lin",
      {
        kind: candidate.kind,
        text: candidate.text,
        itemId: t.box,
        status: "active",
        allowCloud: true,
      },
      candidate.id,
    );
    assert(
      recallMemories(
        t.db,
        t.read(),
        "lin",
        "还记得谁送的吗",
        "story",
        t.box,
      ).some((m) => m.id === saved.id),
    );
    saved = saveMemory(
      t.db,
      t.read,
      "lin",
      {
        kind: saved.kind,
        text: "是朋友小林送我的，不是小夏",
        itemId: t.box,
        status: "active",
        allowCloud: false,
      },
      saved.id,
    );
    captureEvent(t.db, t.read(), "lin", { ...event, id: crypto.randomUUID() });
    assert.equal(
      listMemories(t.db, t.read(), "lin").find((m) => m.id === saved.id)!.text,
      saved.text,
    );
    assert(!listMemories(t.db, t.read(), "dad").some((m) => m.id === saved.id));
    forgetMemory(t.db, "lin", saved.id);
    captureEvent(t.db, t.read(), "lin", { ...event, id: crypto.randomUUID() });
    assert(!listMemories(t.db, t.read(), "lin").some((m) => m.id === saved.id));
  } finally {
    t.db.close();
  }
});
test("真实服务接入语义候选：普通自述可提议、请求重放不再付费、关闭捕获不调用提取", async () => {
  const t = create();
  let calls = 0;
  const text = "我最近在学水彩";
  const p: Provider = {
    ready: true,
    model: "stub",
    generate: async (system) => {
      if (system.includes("连续原文")) {
        calls++;
        return {
          text: JSON.stringify({
            candidates: [{ kind: "interest", quote: text }],
          }),
          model: "stub",
          tokens: { input: 10, output: 10 },
        };
      }
      throw Error("fixture only");
    },
  };
  try {
    const input = {
      mode: "auto",
      question: text,
      requestId: crypto.randomUUID(),
      memoryPolicy: "candidates",
      uiContext: { page: "assistant" },
    };
    await respond(t.db, t.read, "lin", input, p);
    const seen = listMemories(t.db, t.read(), "lin").find(
      (m) => m.text === text,
    );
    assert(seen);
    assert.equal(seen.status, "candidate");
    assert.equal(seen.provenance?.basis, "user_statement");
    await respond(t.db, t.read, "lin", input, p);
    assert.equal(calls, 1);
    setCaptureEnabled(t.db, "lin", false);
    await respond(
      t.db,
      t.read,
      "lin",
      { ...input, requestId: crypto.randomUUID() },
      p,
    );
    assert.equal(calls, 1);
  } finally {
    t.db.close();
  }
});
test("创意执行链保存结构化成果与条件，失效来源不写库", async () => {
  const t = create();
  try {
    const r = reasoning(t.box);
    const packet = {
      title: "纸盒遮幕口述剧场",
      itemIds: [t.box],
      minutes: 5,
      steps: [
        "确认纸盒完好，手持遮住自己的手",
        "以手指扮演角色，移动纸盒依次揭晓角色并讲述故事",
      ],
      limits: ["不保证遮光效果，未实物验证"],
      rationale: "纸板遮挡视线形成揭晓顺序",
      reasoning: r,
    };
    const p: Provider = {
      model: "stub",
      generate: async () => ({
        text: JSON.stringify(packet),
        model: "stub",
        tokens: null,
      }),
    };
    const result = await modelIdea(
      t.db,
      t.read(),
      "lin",
      "只用已有物品讲故事",
      p,
      false,
      t.read,
      { itemIds: [t.box] },
    );
    assert.equal(result.reasoning?.outcome, r.outcome);
    assert.equal(result.reasoningBasis, "model_hypothesis_not_verified");
    assert(result.missing?.some((m) => m.includes("不成立")));
    const n = listLifeIdeas(t.db, t.read(), "lin").length;
    r.roles[0].factRefs = ["fake"];
    await assert.rejects(
      modelIdea(t.db, t.read(), "lin", "只用已有物品讲故事", p, false, t.read, {
        itemIds: [t.box],
        repairAttempt: true,
      }),
      /方案/,
    );
    assert.equal(listLifeIdeas(t.db, t.read(), "lin").length, n);
  } finally {
    t.db.close();
  }
});
test("协议兼容只移动已锚定的已知来源，未知引用不能悄悄删除", () => {
  const t = create();
  try {
    const r = reasoning(t.box);
    const v = normalizeCreativePacket(
      {
        reasoning: r,
        factIds: [t.box + "/material", "invented"],
        experienceIds: ["pref", "unknown"],
        requirements: { [t.box]: 1 },
      },
      t.read().items,
      ["pref"],
    );
    assert.deepEqual(v.factIds, ["invented"]);
    assert.deepEqual(v.experienceIds, ["unknown"]);
    assert.deepEqual(v.reasoning.preferenceIds, ["pref"]);
    assert.deepEqual(v.requirements, [{ itemId: t.box, quantity: 1 }]);
    assert.equal(v.reasoning.roles[0].factRefs[0], t.box + "/material");
  } finally {
    t.db.close();
  }
});
test("合成商品不会生成真实持有认识", () => {
  const t = fixture();
  try {
    const { itemIds } = installAlphaSamples(t.db, t.read, "lin");
    captureWorkspace(t.db, t.read(), "lin");
    assert(
      !listMemories(t.db, t.read(), "lin").some((m) =>
        itemIds.includes(m.itemId || ""),
      ),
    );
  } finally {
    t.db.close();
  }
});
test("勾选的物品范围不会被只识别部分短名的规则偷偷删掉", async () => {
  const t = create();
  try {
    const paper = t.add("20张白纸", "手工材料", "", "未知", {
        attributes: { material: "纸", quantity: 20, quantityUnit: "张" },
      }),
      pen = t.add("铅笔", "文具", "", "未知", { attributes: { quantity: 1 } });
    const ids = [t.box, paper, pen];
    const result = await planDiscovery(
      t.db,
      t.read(),
      "lin",
      {
        goal: "只用登记的旧纸盒、白纸和铅笔找新用途",
        itemIds: ids,
        model: false,
      },
      off,
      t.read,
    );
    assert.deepEqual(new Set(result.resources.map((r) => r.id)), new Set(ids));
  } finally {
    t.db.close();
  }
});
test("事实型赠送者问题直接取当前记录，拒绝编造人物引语", () => {
  const t = create();
  try {
    saveMemory(t.db, t.read, "lin", {
      kind: "relationship",
      text: "这件物品是小夏送我的",
      itemId: t.box,
      allowCloud: true,
    });
    const ctx = buildContext(t.db, t.read(), "lin", {
      question: "你还记得是谁送给我的吗？",
      mode: "story",
      itemId: t.box,
    });
    const session: any = {
      id: crypto.randomUUID(),
      mode: "story",
      itemId: t.box,
      messages: [],
      known: {},
      tried: [],
    };
    const plan = planMemoryStory(ctx, session)!;
    assert(plan);
    assert.equal(canComposeInCloud(plan), false);
    assert.throws(
      () =>
        validateStorytelling(
          JSON.stringify({
            answer: "小夏说过：‘希望我一直陪伴你’。",
            memoryIds: [plan.sources[0].id],
          }),
          plan,
        ),
      /Quoted/,
    );
  } finally {
    t.db.close();
  }
});
test("更正后的赠送者问句可以召回新事实，不回到欢迎语", async () => {
  const t = create();
  try {
    saveMemory(t.db, t.read, "lin", {
      kind: "relationship",
      text: "更正：这件物品是小林送我的，不是小夏",
      itemId: t.box,
      allowCloud: true,
    });
    const result = await respond(
      t.db,
      t.read,
      "lin",
      {
        mode: "story",
        itemId: t.box,
        question: "这件物品的赠送者是谁？请用更正后的记录",
        requestId: crypto.randomUUID(),
        memoryPolicy: "off",
      },
      off,
    );
    assert.match(result.reply.answer, /小林/);
    assert.equal(result.modelCalls, 0);
    assert(result.reply.memoryIds.length);
  } finally {
    t.db.close();
  }
});
test("反例复核明确否决时不发布原先通过浅层规则的草稿", async () => {
  const t = create();
  try {
    let n = 0;
    const packet = {
      title: "候选",
      itemIds: [t.box],
      minutes: 5,
      steps: ["手持纸盒换几个位置"],
      limits: ["未实物验证"],
    };
    const p: Provider = {
      model: "stub",
      generate: async () => ({
        model: "stub",
        tokens: null,
        text: JSON.stringify(++n === 1 ? packet : { ideas: [] }),
      }),
    };
    await assert.rejects(
      modelIdea(t.db, t.read(), "lin", "新用途", p, false, t.read, {
        itemIds: [t.box],
        review: true,
      }),
      /未发布/,
    );
    assert.equal(listLifeIdeas(t.db, t.read(), "lin").length, 0);
    assert.equal(n, 2);
  } finally {
    t.db.close();
  }
});
test("创意定向修复不会把未选择的私人库存交给模型", async () => {
  const t = create();
  try {
    const privateId = t.add(
      "hidden-repair-inventory-sentinel",
      "私人",
      "",
      "未知",
    );
    const s = t.read();
    s.items.find((i) => i.id === privateId)!.owner = "dad";
    s.items.find((i) => i.id === privateId)!.shared = false;
    t.write(s);
    let input: any,
      calls = 0;
    const p: Provider = {
      model: "stub",
      generate: async (system, value) => {
        calls++;
        if (system.includes("修复已有创意")) input = value;
        return {
          model: "stub",
          tokens: null,
          text: JSON.stringify({
            title: "手持盒子讲述",
            itemIds: [t.box],
            minutes: 5,
            steps: [
              calls === 1
                ? "粘贴到墙面"
                : "手持纸盒遮住手指，再移开并口述一个角色",
            ],
            limits: ["未实物验证"],
          }),
        };
      },
    };
    await modelIdea(
      t.db,
      t.read(),
      "lin",
      "只用已有物品讲故事",
      p,
      false,
      t.read,
    ).catch(() => {});
    assert.equal(calls, 2);
    assert(input);
    assert(!JSON.stringify(input).includes("hidden-repair-inventory-sentinel"));
  } finally {
    t.db.close();
  }
});

// Factual relationship questions route to current records even without an explicit recall phrase.
assert(isRelationshipFactQuestion("这幅画是谁送我的？"));
assert(isRelationshipFactQuestion("这件物品是什么时候送给我的？"));
assert(!isRelationshipFactQuestion("谁能帮我写一个程序？"));
