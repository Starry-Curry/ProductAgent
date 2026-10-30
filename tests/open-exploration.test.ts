import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  exploreOpen,
  explorationSections,
} from "../src/lib/life/open-exploration.ts";
import {
  searchInspiration,
  inspirationCases,
} from "../src/lib/life/inspiration.ts";
import { planDiscovery } from "../src/lib/life/planning.ts";
import {
  modelIdea,
  listLifeIdeas,
  feedbackIdea,
} from "../src/lib/life/ideas.ts";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { mutate } from "../src/lib/domain.ts";
import { saveMemory, forgetMemory } from "../src/lib/memory/store.ts";
import { turnInputSchema } from "../src/lib/agent/contracts.ts";
const setup = () => {
  const f = validationFixture(".runtime/open-exploration-" + randomUUID());
  const id = f.add("陌生旅行网袋", "生活物品", "", "", {
    attributes: { material: "织物", capabilities: ["便携"] },
  });
  return { ...f, id };
};
test("open first stage uses prose, preserves >3 directions and has no JSON/citation contract", async () => {
  const f = setup(),
    captured: any[] = [];
  const text = Array.from(
    { length: 7 },
    (_, i) => "## 方向" + (i + 1) + "\n不同的实际效果" + i,
  ).join("\n\n");
  const provider: any = {
    ready: true,
    model: "offline-fixture",
    generate: async (...args: any[]) => {
      captured.push(args);
      return { text, model: "offline-fixture", tokens: null };
    },
  };
  const d = await planDiscovery(
    f.db,
    f.read(),
    "lin",
    {
      goal: "我想让它更有趣",
      itemIds: [f.id],
      model: true,
      publicEvidence: false,
    },
    provider,
    f.read,
  );
  assert.equal(captured.length, 1);
  assert.equal(captured[0][2].json, false);
  assert.equal(d.ideas.length, 7);
  assert.ok(
    d.ideas.every(
      (i) =>
        !i.steps.length &&
        i.exploration?.stage === "explore" &&
        i.tested === false,
    ),
  );
  assert.equal(captured[0][1].contract, undefined);
  assert.equal(captured[0][1].outputContract, undefined);
  assert.equal(captured[0][1].preferences instanceof Array, true);
  assert.doesNotMatch(captured[0][0], /最多三个|600字|至多3/);
  f.db.close();
});
test("more than six directions can continue through the real handoff contract", () => {
  const ids = Array.from({ length: 9 }, () => randomUUID());
  assert.equal(
    turnInputSchema.parse({
      requestId: randomUUID(),
      question: "继续选一个方向",
      uiContext: { page: "item", planContext: { previousIdeaIds: ids } },
    }).uiContext?.planContext?.previousIdeaIds.length,
    9,
  );
});
test("different heading conventions never drop original content", () => {
  const text = "intro\n### first\nbody\n#### detail\nmore\n### second\nbody2";
  const sections = explorationSections(text);
  assert.equal(sections.length, 2);
  assert.match(sections[0].text, /intro/);
  assert.match(sections[0].text, /detail/);
  assert.equal(
    explorationSections("1. 没有markdown标题\n完整回答")[0].text,
    "1. 没有markdown标题\n完整回答",
  );
});
test("retrieval is optional, local, attributed and does not invent search success", async () => {
  const f = setup(),
    inputs: any[] = [];
  const p: any = {
    generate: async (_s: string, input: unknown) => {
      inputs.push(input);
      return { text: "可能的新用途", tokens: null, model: "fixture" };
    },
  };
  const item = f.read().items.filter((i) => i.id === f.id);
  const free = await exploreOpen(
    p,
    item,
    "用网袋创造旅行新玩法",
    { strategy: "free", preferences: [], feedback: [] },
    () => {},
  );
  assert.equal(free.record.retrieval, "not-requested");
  assert.equal(inputs[0].inspirations, undefined);
  assert.equal(searchInspiration("长尾夹夹持线材").cases[0].id, "clip-cables");
  assert.equal(searchInspiration("unmatchedzzzz").cases.length, 0);
  assert.equal(
    new Set(inspirationCases.map((c) => c.id)).size,
    inspirationCases.length,
  );
  for (const c of inspirationCases) {
    assert.match(c.url, /^https:/);
    assert.ok(c.author && c.license && c.evidence && c.limits.length);
  }
  f.db.close();
});
test("default prose path retains mid-flight permission revocation and no persistence", async () => {
  const f = setup(),
    p: any = {
      generate: async () => {
        f.write(
          mutate(f.read(), "lin", "updateItem", {
            itemId: f.id,
            availability: "broken",
          }),
        );
        return { text: "创意文本", model: "fixture", tokens: null };
      },
    };
  await assert.rejects(
    () =>
      planDiscovery(
        f.db,
        f.read(),
        "lin",
        { goal: "新玩法", itemIds: [f.id], model: true, publicEvidence: false },
        p,
        f.read,
      ),
    /已变化/,
  );
  assert.equal(listLifeIdeas(f.db, f.read(), "lin").length, 0);
  f.db.close();
});
test("feedback notes require explicit IDs; natural text and saves survive across calls", async () => {
  const f = setup(),
    inputs: any[] = [];
  const p: any = {
    generate: async (_s: string, input: unknown) => {
      inputs.push(input);
      return {
        text: "## 移动出门站\n利用可携带性减少逐件找东西。",
        model: "fixture",
        tokens: null,
      };
    },
  };
  const input = {
    goal: "新用途",
    itemIds: [f.id],
    model: true,
    publicEvidence: false,
  };
  const first = await planDiscovery(f.db, f.read(), "lin", input, p, f.read);
  feedbackIdea(f.db, f.read(), "lin", {
    id: first.ideas[0].id,
    saved: true,
    outcome: "不感兴趣",
    note: "PRIVATE_SYNTHETIC_NOTE",
  });
  await planDiscovery(
    f.db,
    f.read(),
    "lin",
    { ...input, previousIdeaIds: [first.ideas[0].id] },
    p,
    f.read,
  );
  assert.doesNotMatch(JSON.stringify(inputs[1]), /PRIVATE_SYNTHETIC_NOTE/);
  await planDiscovery(
    f.db,
    f.read(),
    "lin",
    {
      ...input,
      previousIdeaIds: [first.ideas[0].id],
      feedbackIdeaIds: [first.ideas[0].id],
    },
    p,
    f.read,
  );
  assert.match(JSON.stringify(inputs[2]), /PRIVATE_SYNTHETIC_NOTE/);
  assert.equal(listLifeIdeas(f.db, f.read(), "lin")[0].saved, true);
  f.db.close();
});
test("deeper verification cannot use another user's saved direction", async () => {
  const f = setup(),
    id = randomUUID(),
    p: any = {
      generate: async () => {
        throw Error("must not call");
      },
    };
  await assert.rejects(
    () =>
      modelIdea(f.db, f.read(), "lin", "深入", p, false, f.read, {
        engine: "goal",
        itemIds: [f.id],
        selectedIdeaId: id,
      }),
    /未获授权/,
  );
  f.db.close();
});
test("forgetting a preference blocks stale creative content from further cloud reuse", async () => {
  const f = setup(),
    m = saveMemory(f.db, f.read, "lin", {
      kind: "preference",
      text: "喜欢旅行",
      allowCloud: true,
    });
  const p: any = {
    generate: async () => ({
      text: "## 随身旅行站\n让网袋帮助旅行前准备。",
      model: "fixture",
      tokens: null,
    }),
  };
  const first = await planDiscovery(
    f.db,
    f.read(),
    "lin",
    {
      goal: "探索旅行新用途",
      itemIds: [f.id],
      model: true,
      publicEvidence: false,
    },
    p,
    f.read,
  );
  forgetMemory(f.db, "lin", m.id);
  await assert.rejects(
    () =>
      planDiscovery(
        f.db,
        f.read(),
        "lin",
        {
          goal: "继续",
          itemIds: [f.id],
          previousIdeaIds: [first.ideas[0].id],
          model: true,
          publicEvidence: false,
        },
        p,
        f.read,
      ),
    /记忆或授权已变化/,
  );
  await assert.rejects(
    () =>
      modelIdea(f.db, f.read(), "lin", "深入", p, false, f.read, {
        engine: "goal",
        itemIds: [f.id],
        selectedIdeaId: first.ideas[0].id,
      }),
    /记忆或授权已变化/,
  );
  f.db.close();
});

test("nullable question does not turn unknown targets into executable actions", async () => {
  const f = setup();
  const p: any = {
    generate: async () => ({
      model: "offline-fixture",
      tokens: null,
      text: JSON.stringify({
        ideas: [
          {
            title: "待验证方向",
            outcome: "希望获得新的展示方式",
            mechanism: "假设有支撑才能保持姿态",
            roles: [{ item: "i1", function: "主体", evidence: [] }],
            actions: [
              { kind: "support", items: ["i1"], target: "未登记的桌面" },
            ],
            requirements: [],
            assumptions: ["支撑不存在时不实施"],
            extraResources: [],
            preferenceIds: [],
            minutes: 5,
          },
        ],
        question: null,
      }),
    }),
  };
  const result = await modelIdea(
    f.db,
    f.read(),
    "lin",
    "分析选中方向",
    p,
    false,
    f.read,
    { engine: "goal", itemIds: [f.id] },
  );
  assert.equal(result.assessment?.level, "concept");
  assert.equal(result.steps.length, 0);
  assert.ok(
    result.assessment?.checks.some(
      (c) => c.code === "action-resource" && c.status === "contradiction",
    ),
  );
  assert.deepEqual(result.itemIds, [f.id]);
  f.db.close();
});
