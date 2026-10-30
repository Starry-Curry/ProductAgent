import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { installAlphaSamples } from "../src/lib/life/alpha-samples.ts";
import { buildContext } from "../src/lib/context/builder.ts";
import {
  curatedDecision,
  validateModelPacket,
} from "../src/lib/agent/graph.ts";
import { planDiscovery } from "../src/lib/life/planning.ts";
import { feedbackIdea, listLifeIdeas } from "../src/lib/life/ideas.ts";
import {
  createProvider,
  ProviderError,
  type Provider,
} from "../src/lib/ai/provider.ts";
import { saveMemory, forgetMemory } from "../src/lib/memory/store.ts";
import { exploreCreativeUses } from "../src/lib/life/creative-exploration.ts";
const fixture = () =>
  validationFixture(mkdtempSync(path.resolve(".runtime/behavior-unit-")));
const reply = (answer: string, factIds: string[]) =>
  JSON.stringify({
    kind: "supported",
    answer,
    factIds,
    questions: [],
    procedureId: null,
  });
test("完整型号资料不再因首个关键词丢失材质与限制；云端问答不提前截断", () => {
  const t = fixture();
  try {
    const id = installAlphaSamples(t.db, t.read, "lin").itemIds[0];
    const ctx = buildContext(t.db, t.read(), "lin", {
      question: "材质、尺寸和使用限制分别是什么？",
      mode: "service",
      itemId: id,
    });
    assert(ctx.knowledge.facts.some((f) => /聚丙烯|PP/.test(f.text)));
    assert(ctx.knowledge.facts.some((f) => /28/.test(f.text)));
    assert(ctx.knowledge.facts.some((f) => /食品|食物/.test(f.text)));
    const s: any = { mode: "service", known: {}, tried: [], messages: [] };
    assert.equal(curatedDecision(ctx.question, s, ctx, true, true), undefined);
    assert(curatedDecision(ctx.question, s, ctx, true, false));
  } finally {
    t.db.close();
  }
});
for (const [name, answer, valid] of [
  [
    "综合回答与未知保留",
    "材质是聚丙烯；外尺寸28×20×14厘米。不可直接接触食物；内尺寸未知，当前实物是否完好仍需本人核对。",
    true,
  ],
  ["数值幻觉", "耐热120度，可以放心使用。", false],
  ["引用不能掩盖危险动作", "短接电池触点后检查。", false],
  ["引用不能授权硬件操作", "长按电源键即可开启隐藏模式。", false],
] as const)
  test(name, () => {
    const t = fixture();
    try {
      const id = installAlphaSamples(t.db, t.read, "lin").itemIds[0],
        ctx = buildContext(t.db, t.read(), "lin", {
          question: "材质尺寸限制和实物情况",
          mode: "service",
          itemId: id,
        });
      const run = () =>
        validateModelPacket(
          reply(
            answer,
            ctx.knowledge.facts.map((f) => f.id),
          ),
          ctx,
          "service",
        );
      if (valid) assert.equal(run().answer, answer);
      else assert.throws(run);
    } finally {
      t.db.close();
    }
  });
function fake(
  t: ReturnType<typeof fixture>,
  id: string,
  hook?: (input: any, n: number) => void,
): Provider {
  let n = 0;
  return {
    ready: true,
    model: "offline-double",
    generate: async (s, x, o) => {
      hook?.(x, ++n);
      if (o?.json === false)
        return {
          text: "方向甲：把可翻开的画框支架用于展示已有便笺，先核对槽口。方向乙：用便笺自己做一张可翻动清单。",
          model: "offline-double",
          tokens: null,
        };
      return {
        text: JSON.stringify({
          ideas: [
            {
              title: "折立便笺清单",
              itemIds: [id],
              minutes: 5,
              steps: ["将便笺沿已有折线立起，作为眼前可见的待办提示"],
              limits: ["先确认纸张可自行立稳"],
              rationale: "折成立体后使平面文字在视线内可见，不宣称自动提醒",
              reasoning: {
                outcome: "眼前可见的一张待办提示",
                roles: [
                  {
                    itemId: id,
                    factRefs: [id + "/material"],
                    function: "折成立面展示",
                    contribution: "让已有内容在工作时可见",
                  },
                ],
                checks: [
                  {
                    condition: "折后能立稳",
                    method: "在干燥桌面试放",
                    ifFail: "平放在视线可见处",
                  },
                ],
                extraResources: [],
                preferenceIds: [],
              },
            },
          ],
        }),
        model: "offline-double",
        tokens: null,
      };
    },
  };
}
function resources(t: ReturnType<typeof fixture>) {
  return [
    t.add("已写待办的便笺", "文具", "", "未知", {
      attributes: { material: "可折叠纸张，已有折线", quantity: 1 },
    }),
    t.add("金属夹子", "文具", "", "未知", {
      attributes: { material: "钢", quantity: 1 },
    }),
    t.add("普通塑料杯", "容器", "", "未知", {
      attributes: { material: "塑料", quantity: 1 },
    }),
  ];
}
test("实际规划走两步且允许资源池子集；保存反馈进入下一轮而私人备注不上云", async () => {
  const t = fixture();
  try {
    const ids = resources(t),
      seen: any[] = [];
    const p = fake(t, ids[0], (x) => seen.push(x));
    const input = {
      goal: "只用这些已有物品，给我新的桌面待办提示方式",
      itemIds: ids,
      engine: "legacy", model: true,
      publicEvidence: false,
    };
    const first = await planDiscovery(t.db, t.read(), "lin", input, p, t.read);
    assert.equal(first.modelCalls, 2);
    assert.deepEqual(first.ideas[0].itemIds, [ids[0]]);
    feedbackIdea(t.db, t.read(), "lin", {
      id: first.ideas[0].id,
      saved: true,
      outcome: "未成功",
      note: "PRIVATE_NOTE",
    });
    await planDiscovery(t.db, t.read(), "lin", input, p, t.read);
    assert(
      seen
        .at(-1)
        .planning.recentFeedback.some((f: any) => f.outcome === "未成功"),
    );
    assert(!JSON.stringify(seen).includes("PRIVATE_NOTE"));
    assert(listLifeIdeas(t.db, t.read(), "lin")[0].saved);
  } finally {
    t.db.close();
  }
});
test("发散之后撤销记忆立即停止，不发送选择请求或写入草稿", async () => {
  const t = fixture();
  try {
    const ids = resources(t),
      m = saveMemory(t.db, t.read, "lin", {
        kind: "interest",
        text: "我喜欢折纸",
        allowCloud: true,
      });
    let calls = 0;
    await assert.rejects(
      planDiscovery(
        t.db,
        t.read(),
        "lin",
        { goal: "新用途", itemIds: ids, engine: "legacy", model: true, publicEvidence: false },
        fake(t, ids[0], () => {
          calls++;
          forgetMemory(t.db, "lin", m.id);
        }),
        t.read,
      ),
      /授权或记忆已变化/,
    );
    assert.equal(calls, 1);
    assert.equal(listLifeIdeas(t.db, t.read(), "lin").length, 0);
  } finally {
    t.db.close();
  }
});
test("发散之后物品撤权停止第二回合", async () => {
  const t = fixture();
  try {
    const ids = resources(t);
    let calls = 0;
    await assert.rejects(
      planDiscovery(
        t.db,
        t.read(),
        "lin",
        { goal: "新用途", itemIds: ids, engine: "legacy", model: true, publicEvidence: false },
        fake(t, ids[0], () => {
          calls++;
          const state = t.read();
          state.items.find((i) => i.id === ids[0])!.owner = "dad";
          t.write(state);
        }),
        t.read,
      ),
      /资料或权限已变化/,
    );
    assert.equal(calls, 1);
  } finally {
    t.db.close();
  }
});
for (const reason of ["insufficient_conditions", "no_viable_idea"])
  test("失败分类 " + reason + " 不用固定观察替代也不自动付费修补", async () => {
    let calls = 0;
    const p: Provider = {
      model: "stub",
      generate: async () => ({
        model: "stub",
        tokens: null,
        text:
          ++calls === 1
            ? "一些待筛选方向"
            : JSON.stringify({ ideas: [], reason }),
      }),
    };
    await assert.rejects(
      exploreCreativeUses(p, {}, () => {}),
      (e: any) => e.code === reason,
    );
    assert.equal(calls, 2);
  });
test("生成超时不自动补发付费请求", async () => {
  let calls = 0;
  await assert.rejects(
    exploreCreativeUses(
      {
        model: "stub",
        generate: async () => {
          calls++;
          throw new ProviderError("timeout", "超时");
        },
      },
      {},
      () => {},
    ),
    /超时/,
  );
  assert.equal(calls, 1);
});
test("同一提供方可按次关闭JSON并提高发散温度；强模型仅显式创意配置使用", async () => {
  const seen: any[] = [];
  const p = createProvider(
    {
      AI_BASE_URL: "https://fixture.invalid/v1",
      AI_API_KEY: "fixture-only",
      AI_MODEL: "qwen-plus",
      AI_CREATIVE_MODEL: "qwen3-max",
      AI_ALLOW_PAID_CALLS: "true",
      AI_JSON_MODE: "true",
    },
    async (_u, init) => {
      seen.push(JSON.parse(String(init?.body)));
      return Response.json({
        choices: [{ finish_reason: "stop", message: { content: "可以探索" } }],
        usage: { prompt_tokens: 20, completion_tokens: 5 },
      });
    },
  );
  assert.equal(
    (
      await p.generate(
        "探索",
        {},
        { json: false, temperature: 0.85, purpose: "creative" },
      )
    ).model,
    "qwen3-max",
  );
  assert.equal(seen[0].response_format, undefined);
  assert.equal(seen[0].temperature, 0.85);
  assert.equal(seen[0].messages[0].content, "探索");
  await p.generate("整理", {});
  assert.equal(seen[1].model, "qwen-plus");
  assert.equal(seen[1].response_format.type, "json_object");
});

import { routeProductTurn } from "../src/lib/home/router.ts";
test("已选商品的未枚举问题仍保留资料上下文，自由聊天保留自然入口", () => {
  const t = fixture();
  try {
    const id = installAlphaSamples(t.db, t.read, "lin").itemIds[0];
    const session: any = { itemId: id, known: { uiPage: "assistant" } };
    assert.equal(
      routeProductTurn("它适合哪种环境？", t.read(), "lin", session).itemId,
      id,
    );
    assert.equal(
      routeProductTurn("今天工作很累，随便聊聊", t.read(), "lin", session)
        .intent,
      "companion",
    );
  } finally {
    t.db.close();
  }
});
test("无粘贴不当成需要胶带，后续独立粘贴仍需胶带", () => {
  assert.equal(
    withoutProhibitedActions("无需计时、无粘贴，随后粘贴到墙上"),
    "、，随后粘贴到墙上",
  );
});
import { withoutProhibitedActions } from "../src/lib/agent/safety-language.ts";

import { respond } from "../src/lib/agent/service.ts";
import { productPacks } from "../src/lib/products.ts";
import jblRejected from "./fixtures/behavior-jbl-rejected.json" with { type: "json" };
test("真实JBL失败响应离线重放：拒绝长按猜测后保留官方事实与未知，不冒充模型成功", async () => {
  const t = fixture();
  try {
    const p = productPacks.find((p) => p.id === "jbl-go4")!,
      id = t.add("测试GO4", "电子设备", "JBL", p.model, {
        attributes: { quantity: 1 },
      });
    const state = t.read();
    state.items.find((i) => i.id === id)!.productBinding = {
      packId: p.id,
      version: p.version,
      confirmedBy: "lin",
      confirmedAt: new Date().toISOString(),
    };
    t.write(state);
    let calls = 0;
    const r = await respond(
      t.db,
      t.read,
      "lin",
      {
        itemId: id,
        question:
          "连接方式、防水等级和立体声条件是什么？我的这台能正常连接吗？",
        requestId: crypto.randomUUID(),
        mode: "auto",
        uiContext: { page: "assistant" },
        memoryPolicy: "off",
      },
      {
        ready: true,
        model: "offline-replay-of-real-output",
        generate: async () => {
          calls++;
          return {
            text: JSON.stringify(jblRejected.packet),
            model: "offline-replay",
            tokens: null,
          };
        },
      },
    );
    assert.equal(calls, 2);
    assert.equal(r.reply.source, "curated-guidance");
    assert.equal(r.reply.errorCode, "validation_failed_partial");
    assert.match(r.reply.answer, /5.3/);
    assert.match(r.reply.answer, /IP67/);
    assert.match(r.reply.answer, /尚未确认/);
    assert.doesNotMatch(r.reply.answer, /长按/);
    assert(r.trace.some((t) => t.stage === "verified_facts_fallback"));
  } finally {
    t.db.close();
  }
});
test("有商品资料也允许无关的低风险一般帮助，不被强迫选规格ID", () => {
  const t = fixture();
  try {
    const id = installAlphaSamples(t.db, t.read, "lin").itemIds[0],
      ctx = buildContext(t.db, t.read(), "lin", {
        question: "如何把问题描述清楚",
        mode: "service",
        itemId: id,
      });
    assert.equal(
      validateModelPacket(
        JSON.stringify({
          kind: "general",
          answer: "先说想完成什么，再说现在看到的现象。",
          factIds: [],
          questions: [],
        }),
        ctx,
        "service",
      ).outcome,
      "answered",
    );
  } finally {
    t.db.close();
  }
});

test("仅收藏而未尝试的方案也影响下一轮，不需要伪造成功反馈", async () => {
  const t = fixture();
  try {
    const ids = resources(t),
      seen: any[] = [];
    const p = fake(t, ids[0], (x) => seen.push(x)),
      input = {
        goal: "找一个新用途",
        itemIds: ids,
        engine: "legacy", model: true,
        publicEvidence: false,
      };
    const first = await planDiscovery(t.db, t.read(), "lin", input, p, t.read);
    feedbackIdea(t.db, t.read(), "lin", {
      id: first.ideas[0].id,
      saved: true,
      outcome: "未尝试",
    });
    await planDiscovery(t.db, t.read(), "lin", input, p, t.read);
    assert(
      seen
        .at(-1)
        .planning.recentFeedback.some(
          (f: any) => f.saved && f.outcome === "未尝试",
        ),
    );
  } finally {
    t.db.close();
  }
});
