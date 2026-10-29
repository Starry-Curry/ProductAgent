import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import {
  installVirtualHome,
  refreshHomeKnowledge,
  setVirtualHomeCloud,
  virtualHomeItems,
} from "../src/lib/life/virtual-home.ts";
import {
  homeItemId,
  apartmentProducts,
} from "../src/lib/catalog/virtual-apartment.ts";
import { isProductManual } from "../src/lib/life/manuals.ts";
import { readKnowledge } from "../src/lib/life/acquisition.ts";
import { buildHomeTaskContext } from "../src/lib/context/home-task.ts";
import {
  listMemories,
  forgetMemory,
  saveMemory,
  savePersona,
} from "../src/lib/memory/store.ts";
import { respond } from "../src/lib/agent/service.ts";
import type { Provider, ModelMessage } from "../src/lib/ai/provider.ts";
const fixture = () => {
  mkdirSync(".runtime", { recursive: true });
  return validationFixture(mkdtempSync(path.resolve(".runtime/home-test-")));
};
const input = (extra: Record<string, unknown> = {}) => ({
  requestId: crypto.randomUUID(),
  question: "这幅画是谁送的？和新书桌怎么一起安排？",
  mode: "auto",
  memoryPolicy: "off",
  uiContext: { page: "assistant", homeId: "young-apartment-v1" },
  ...extra,
});
function model(
  options: {
    beforeAnswer?: () => void;
    foreign?: boolean;
    inspect?: (messages: ModelMessage[]) => void;
  } = {},
): Provider {
  return {
    ready: true,
    model: "offline-scripted",
    generate: async (_system, input) => {
      if (_system.startsWith("SOURCE_REVIEW")) {
        const v = input as any;
        return {
          text: JSON.stringify({
            keepSentenceIds: v.sentences.map((s: any) => s.id),
            keepStepIds: v.steps.map((s: any) => s.id),
            issues: [],
          }),
          model: "offline-scripted",
          tokens: null,
        };
      }
      const value = input as {
        question: string;
        taskDraft: { goal: string; parts: unknown[] };
        readResults: any[];
      };
      const c = value.readResults.find((c) => c.items) || {};
      return {
        text: JSON.stringify({
          answer: "仅使用当前资料回应完整目标，支撑结构未知。",
          goal: "布置画与书桌",
          tasks: [
            { title: "赠送关系", status: "addressed" },
            { title: "布局条件", status: "needs_info" },
          ],
          usedItemIds: c.items?.map((i: any) => i.id) || [
            homeItemId("dad", "painting"),
          ],
          memoryIds: c.memories?.map((m: any) => m.id) || [],
          sourceIds: [],
          questions: ["是否有原配支架？"],
          steps: [],
        }),
        model: "offline-scripted",
        tokens: { input: 10, output: 10 },
      };
    },
    complete: async (messages) => {
      options.inspect?.(messages);
      const tool = messages.findLast((m) => m.role === "tool");
      if (!tool)
        return {
          text: "",
          model: "offline-scripted",
          tokens: { input: 10, output: 10 },
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "read-1",
              type: "function",
              function: {
                name: "read_home_items",
                arguments: JSON.stringify({
                  itemIds: options.foreign
                    ? [homeItemId("dad", "painting")]
                    : [
                        homeItemId("lin", "painting"),
                        homeItemId("lin", "desk"),
                      ],
                  query: "赠送者、尺寸与布置",
                }),
              },
            },
          ],
        };
      const c = JSON.parse(tool.content as string);
      options.beforeAnswer?.();
      return {
        text: JSON.stringify({
          answer:
            "赠送者来自当前获准关系记忆；布置时先按已知尺寸预留空间，支撑方式未知。",
          goal: "布置画与书桌",
          tasks: [
            { title: "赠送关系", status: "addressed" },
            { title: "布置与支撑条件", status: "needs_info" },
          ],
          usedItemIds: c.items?.map((i: any) => i.id) || [
            homeItemId("dad", "painting"),
          ],
          memoryIds: c.memories?.map((m: any) => m.id) || [],
          sourceIds: [],
          steps: ["先确认现有支架，再决定竖放；否则临时平放。"],
          questions: ["现有画框是否有支架？"],
        }),
        model: "offline-scripted",
        tokens: { input: 20, output: 30 },
        finishReason: "stop",
        toolCalls: [],
      };
    },
  };
}
test("固定家庭八件物品保持精确SKU，单次显式许可且重复加载不复活遗忘记忆", () => {
  const t = fixture();
  try {
    const before = t.read().items.length;
    installVirtualHome(t.db, t.read, "lin", true);
    const items = virtualHomeItems(t.read(), "lin");
    assert.equal(items.length, 8);
    assert.equal(t.read().items.length, before + 8);
    assert.deepEqual(
      items.slice(0, 7).map((i) => i.model),
      apartmentProducts.map((p) => p.model),
    );
    assert.ok(items.every((i) => i.synthetic && !i.shared));
    const memory = listMemories(t.db, t.read(), "lin").find(
      (m) => m.kind === "relationship",
    )!;
    forgetMemory(t.db, "lin", memory.id);
    assert.equal(installVirtualHome(t.db, t.read, "lin", true).replayed, true);
    assert.equal(
      listMemories(t.db, t.read(), "lin").filter(
        (m) => m.kind === "relationship" && m.status === "active",
      ).length,
      0,
    );
    assert.equal(virtualHomeItems(t.read(), "dad").length, 0);
  } finally {
    t.db.close();
  }
});
test("PDF格式不是说明书：算法备案、合规文件、营销PDF被排除", () => {
  for (const title of [
    "算法备案说明.pdf",
    "Declaration of Conformity.pdf",
    "隐私政策.pdf",
    "营销产品手册.pdf",
    "Algorithm filing manual.pdf",
  ])
    assert.equal(
      isProductManual({ title, url: "https://www.mi.com/public.pdf" }),
      false,
    );
  for (const url of [
    "https://resources.ikea.cn/assembly_instructions/micke.pdf",
    "https://www.lego.com/product.bi.core.pdf/123.pdf",
    "https://support.jbl.com/GO_4_QSG_Global.pdf",
  ])
    assert.equal(isProductManual({ title: "", url }), true);
  assert.equal(
    isProductManual({ title: "其他文档", url: "https://www.mi.com/a.pdf" }),
    false,
  );
  assert.doesNotThrow(() =>
    isProductManual({ title: "其他文档", url: "https://www.mi.com/%bad" }),
  );
});
test("商品页只跟随明确说明书，法务PDF在前也不会误入；备用产品页也能取得说明书", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", false);
    const visited: string[] = [];
    const fetcher = async (url: string) => {
      visited.push(url);
      if (url === apartmentProducts.find((p) => p.key === "roses")!.url)
        throw Error("page inaccessible");
      if (url.includes("building-instructions"))
        return {
          url,
          title: "LEGO 10328",
          text: "10328 Bouquet of Roses",
          links: [
            { title: "Legal PDF", url: "https://www.lego.com/legal.pdf" },
            {
              title: "Building instructions",
              url: "https://www.lego.com/product.bi.core.pdf/123.pdf",
            },
          ],
        };
      return {
        url,
        title: "Building instructions",
        text: "Assembly diagrams",
        links: [],
      };
    };
    const r = await refreshHomeKnowledge(t.db, t.read, "lin", "roses", fetcher);
    assert.equal(r.status, "live-read");
    assert.ok(visited.length >= 3);
    assert.ok(!visited.some((v) => v.endsWith("legal.pdf")));
    assert.ok(
      readKnowledge(t.db, t.read(), "lin", homeItemId("lin", "roses")).some(
        (d) => d.role === "manual" && d.url.endsWith("123.pdf"),
      ),
    );
  } finally {
    t.db.close();
  }
});
test("联网期间物品所有权变化后不写入官方缓存", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", false);
    const r = await refreshHomeKnowledge(
      t.db,
      t.read,
      "lin",
      "desk",
      async (url) => {
        const s = t.read();
        s.items.find((i) => i.id === homeItemId("lin", "desk"))!.owner = "dad";
        t.write(s);
        return {
          url,
          title: "MICKE 803.542.81",
          text: "803.542.81 width 73 cm",
          links: [],
        };
      },
    );
    assert.equal(r.status, "unavailable");
    assert.equal(
      t.db.prepare("SELECT count(*) AS n FROM life_knowledge_documents").get()!
        .n,
      0,
    );
  } finally {
    t.db.close();
  }
});
test("授权、临时模式、另一个用户及显式分身记忆策略不能被工具query绕过", () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    const ids = [homeItemId("lin", "painting")];
    assert.ok(
      buildHomeTaskContext(t.db, t.read(), "lin", "布局", ids).memories.length,
    );
    assert.equal(
      buildHomeTaskContext(t.db, t.read(), "lin", "布局", ids, {
        temporary: true,
      }).memories.length,
      0,
    );
    assert.equal(
      buildHomeTaskContext(t.db, t.read(), "lin", "布局", ids, {
        includeMemories: false,
      }).memories.length,
      0,
    );
    assert.throws(
      () => buildHomeTaskContext(t.db, t.read(), "dad", "回忆", ids),
      /本人/,
    );
    savePersona(t.db, t.read(), "lin", {
      enabled: true,
      nickname: "山山",
      style: "warm",
      memoryUse: "explicit",
      itemId: ids[0],
    });
    assert.equal(
      buildHomeTaskContext(t.db, t.read(), "lin", "回忆谁送的", ids, {
        memoryQuestion: "如何布置",
      }).memories.filter((m) => m.kind === "relationship").length,
      0,
    );
  } finally {
    t.db.close();
  }
});
test("没有模拟家庭云端许可时绝不调用模型；许可开关不会扩大单条记忆许可", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", false);
    let calls = 0;
    const provider = model({ inspect: () => calls++ });
    const r = await respond(t.db, t.read, "lin", input(), provider);
    assert.equal(r.modelCalls, 0);
    assert.equal(calls, 0);
    assert.equal(r.reply.outcome, "blocked");
    setVirtualHomeCloud(t.db, t.read, "lin", true);
    assert.ok(listMemories(t.db, t.read(), "lin").every((m) => !m.allowCloud));
  } finally {
    t.db.close();
  }
});
test("统一任务实际执行模型→物品与关系工具→模型，并持久化完整子任务及后续目标", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    let tools = 0;
    const provider = model({
      inspect: (messages) => {
        const tool = messages.find((m) => m.role === "tool");
        if (tool) {
          tools++;
          const c = JSON.parse(tool.content as string);
          assert.ok(c.memories.some((m: any) => m.text.includes("小夏")));
          assert.ok(
            c.items.some((i: any) =>
              i.properties.dimensions?.includes("40×30"),
            ),
          );
        }
      },
    });
    const r = await respond(t.db, t.read, "lin", input(), provider);
    assert.equal(r.modelCalls, 3);
    assert.equal(tools, 1);
    assert.equal(r.reply.task?.parts.length, 2);
    assert.ok(r.trace.some((t) => t.stage === "task_read"));
    assert.equal(r.session.known.homeTaskGoal, "布置画与书桌");
    assert.ok(t.db.prepare("SELECT 1 FROM graph_checkpoints").get());
    let currentTask: any;
    await respond(
      t.db,
      t.read,
      "lin",
      input({ sessionId: r.session.id, question: "那我想改成平放" }),
      model({
        inspect: (messages) => {
          currentTask = JSON.parse(messages[1].content as string).currentTask;
        },
      }),
    );
    assert.equal(currentTask.goal, "布置画与书桌");
  } finally {
    t.db.close();
  }
});
test("工具不能读其他用户家庭，最终回答不能引用未读物品", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    installVirtualHome(t.db, t.read, "dad", true);
    await assert.rejects(
      respond(t.db, t.read, "lin", input(), model({ foreign: true })),
      /未读取或未授权/,
    );
  } finally {
    t.db.close();
  }
});
test("多轮推理期间遗忘记忆，丢弃在途草稿而不提交旧关系", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    const m = listMemories(t.db, t.read(), "lin").find(
      (m) => m.kind === "relationship",
    )!;
    await assert.rejects(
      respond(
        t.db,
        t.read,
        "lin",
        input(),
        model({ beforeAnswer: () => forgetMemory(t.db, "lin", m.id) }),
      ),
      /记忆或授权|会话/,
    );
  } finally {
    t.db.close();
  }
});
test("纠正/遗忘后上下文仅保留新关系；旧私人片段不作为第二来源", () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    const m = listMemories(t.db, t.read(), "lin").find(
      (m) => m.kind === "relationship",
    )!;
    saveMemory(
      t.db,
      t.read,
      "lin",
      {
        kind: "relationship",
        itemId: m.itemId,
        text: "模拟纠正：朋友小雨赠送的画",
        allowCloud: true,
      },
      m.id,
    );
    let c = buildHomeTaskContext(t.db, t.read(), "lin", "画的来历和布置", [
      m.itemId!,
    ]);
    assert.ok(JSON.stringify(c.memories).includes("小雨"));
    assert.ok(!JSON.stringify(c.memories).includes("小夏"));
    forgetMemory(t.db, "lin", m.id);
    c = buildHomeTaskContext(t.db, t.read(), "lin", "画的来历", [m.itemId!]);
    assert.equal(c.memories.filter((m) => m.kind === "relationship").length, 0);
  } finally {
    t.db.close();
  }
});

test("家庭资源摘要只包含八件模拟物品；真实物品偏好与未请求物品的关系记忆不会混入", () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    const real = t.add("私人杯子", "杯子", "私人", "未知");
    saveMemory(t.db, t.read, "lin", {
      kind: "preference",
      text: "私人旅行偏好，不属于模拟家庭",
      itemId: real,
      allowCloud: true,
    });
    const c = buildHomeTaskContext(t.db, t.read(), "lin", "如何调灯", [
      homeItemId("lin", "lamp"),
    ]);
    assert.equal(c.items.length, 8);
    assert.ok(c.items.every((i) => i.id.startsWith("virtual-home:lin:")));
    assert.ok(
      !c.memories.some((m) => m.itemId === real || m.kind === "relationship"),
    );
    assert.ok(
      c.memories.some(
        (m) =>
          m.kind === "preference" && m.itemId === homeItemId("lin", "desk"),
      ),
    );
  } finally {
    t.db.close();
  }
});
test("家庭工具首轮强制命名函数，后续恢复模型选择；核对回合不获得额外权限", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    const provider = model();
    const complete = provider.complete!;
    const choices: unknown[] = [];
    provider.complete = (m, tools, options) => {
      choices.push(options?.toolChoice);
      return complete(m, tools, options);
    };
    await respond(t.db, t.read, "lin", input(), provider);
    assert.deepEqual(choices, [
      { type: "function", function: { name: "read_home_items" } },
      undefined,
    ]);
  } finally {
    t.db.close();
  }
});
test("云端授权在推理期间撤回，拒绝在途回答；提供者不可用时不冒充模型回答", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    const offline = await respond(t.db, t.read, "lin", input(), {
      ready: false,
      model: "offline",
      generate: async () => {
        throw Error("must not call");
      },
    });
    assert.equal(offline.reply.outcome, "unavailable");
    assert.equal(offline.modelCalls, 0);
    await assert.rejects(
      respond(
        t.db,
        t.read,
        "lin",
        input(),
        model({
          beforeAnswer: () => setVirtualHomeCloud(t.db, t.read, "lin", false),
        }),
      ),
      /授权已撤回|记忆或授权/,
    );
  } finally {
    t.db.close();
  }
});

test("模拟家庭与原空间不能复用已有聊天上下文；无关的私人物品不进入家庭模型", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    const r = await respond(t.db, t.read, "lin", input(), model());
    await assert.rejects(
      respond(
        t.db,
        t.read,
        "lin",
        input({ sessionId: r.session.id, uiContext: { page: "assistant" } }),
        model(),
      ),
      /开始新问题/,
    );
  } finally {
    t.db.close();
  }
});

test("多主题原文交错选取，后一个问题不会被前一个问题挤掉", async () => {
  const { homeTaskPassages } = await import("../src/lib/context/home-task.ts");
  const passages = homeTaskPassages(
    (topic) => Array.from({ length: 8 }, (_, i) => ({ id: topic + i })),
    ["尺寸", "材质", "限制"],
  );
  assert.deepEqual(
    passages.map((p) => p.id),
    ["尺寸0", "材质0", "限制0", "尺寸1", "材质1", "限制1"],
  );
});

test("未请求的家庭资源不附带无关说明书原文", () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    const c = buildHomeTaskContext(t.db, t.read(), "lin", "台灯调光", [
      homeItemId("lin", "lamp"),
    ]);
    assert.equal(c.items.length, 8);
    assert.ok(
      c.items
        .filter((i) => i.contextRole !== "requested-item")
        .every((i) => i.passages.length === 0),
    );
  } finally {
    t.db.close();
  }
});

test("家庭再创造要求既有显式许可，不能扩大到原有真实空间", async () => {
  const { planDiscovery } = await import("../src/lib/life/planning.ts");
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", false);
    let calls = 0;
    const p = {
      ...model(),
      generate: async () => {
        calls++;
        throw Error("must not call");
      },
    };
    await assert.rejects(
      () =>
        planDiscovery(
          t.db,
          t.read(),
          "lin",
          {
            goal: "新用途",
            homeId: "young-apartment-v1",
            model: true,
            includeSynthetic: true,
          },
          p,
          t.read,
        ),
      /授权/,
    );
    setVirtualHomeCloud(t.db, t.read, "lin", true);
    const foreign = t
      .read()
      .items.find((i) => !i.id.startsWith("virtual-home:"))!;
    await assert.rejects(
      () =>
        planDiscovery(
          t.db,
          t.read(),
          "lin",
          {
            goal: "新用途",
            homeId: "young-apartment-v1",
            itemIds: [foreign.id],
            model: true,
            includeSynthetic: true,
          },
          p,
          t.read,
        ),
      /未获授权/,
    );
    assert.equal(calls, 0);
  } finally {
    t.db.close();
  }
});

test("再创造途中撤回家庭云端许可，停止后续模型与方案保存", async () => {
  const { planDiscovery } = await import("../src/lib/life/planning.ts");
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    let calls = 0;
    const p = {
      ...model(),
      generate: async () => {
        calls++;
        setVirtualHomeCloud(t.db, t.read, "lin", false);
        return { text: "draft", model: "offline", tokens: null };
      },
    };
    await assert.rejects(
      () =>
        planDiscovery(
          t.db,
          t.read(),
          "lin",
          {
            goal: "探索新用途",
            homeId: "young-apartment-v1",
            model: true,
            includeSynthetic: true,
            publicEvidence: false,
          },
          p,
          t.read,
        ),
      /授权|变化/,
    );
    assert.equal(calls, 1);
    assert.equal(
      t.db.prepare("SELECT count(*) as n FROM life_ideas").get()!.n,
      0,
    );
  } finally {
    t.db.close();
  }
});

test("旧助手建议不作为新目标的资料，用户限制保留", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    const first = await respond(
      t.db,
      t.read,
      "lin",
      input({ question: "先写手账，不购买" }),
      model(),
    );
    const base = model();
    let checked = false;
    const p = {
      ...base,
      generate: async (system: any, value: any, opts: any) => {
        checked = true;
        assert.ok(value.history.some((m: any) => m.text.includes("不购买")));
        assert.ok(value.history.every((m: any) => m.role !== "assistant"));
        assert.equal(value.question, "改成收拾桌面，不用画");
        return base.generate(system, value, opts);
      },
    };
    await respond(
      t.db,
      t.read,
      "lin",
      input({ sessionId: first.session.id, question: "改成收拾桌面，不用画" }),
      p,
    );
    assert.ok(checked);
  } finally {
    t.db.close();
  }
});

test("选中创意及反馈可回到原家庭任务，不把草稿当成已验证结果", async () => {
  const { storeLifeIdea, feedbackIdea } =
    await import("../src/lib/life/ideas.ts");
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    const itemId = homeItemId("lin", "samla"),
      id = crypto.randomUUID();
    storeLifeIdea(t.db, "lin", {
      id,
      title: "测试再创造",
      itemIds: [itemId],
      minutes: 10,
      steps: ["先核对实际条件"],
      limits: [],
      source: "model-creative",
      evidence: [],
      tested: false,
      goal: "测试目标",
    });
    feedbackIdea(t.db, t.read(), "lin", {
      id,
      saved: true,
      outcome: "未成功",
      note: "不要占桌面，请换一种作用",
    });
    const first = await respond(t.db, t.read, "lin", input(), model());
    const base = model();
    let seen = false;
    const p = {
      ...base,
      generate: async (system: any, value: any, opts: any) => {
        seen = true;
        assert.equal(value.selectedPlans[0].note, "不要占桌面，请换一种作用");
        assert.equal(
          value.selectedPlans[0].verification,
          "model-hypothesis-not-physical-verification",
        );
        return base.generate(system, value, opts);
      },
    };
    const next = await respond(
      t.db,
      t.read,
      "lin",
      input({
        sessionId: first.session.id,
        question: "带着方案继续",
        uiContext: {
          page: "assistant",
          homeId: "young-apartment-v1",
          planContext: { previousIdeaIds: [id], feedbackIdeaIds: [id] },
        },
      }),
      p,
    );
    assert.equal(next.session.id, first.session.id);
    assert.ok(seen);
  } finally {
    t.db.close();
  }
});

test("临时短引用准确还原授权物品；相似拼写不做模糊匹配", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    const base = model();
    const p = {
      ...base,
      complete: async (
        ...args: Parameters<NonNullable<Provider["complete"]>>
      ) => {
        const result = await base.complete!(...args);
        for (const call of result.toolCalls) {
          const data = JSON.parse(call.function.arguments);
          data.itemIds = ["item8", "item2"];
          call.function.arguments = JSON.stringify(data);
        }
        return result;
      },
      generate: async (system: any, value: any, opts: any) => {
        if (!system.startsWith("SOURCE_REVIEW"))
          assert.ok(
            value.readResults[0].items.every((i: any) =>
              /^item[1-8]$/.test(i.id),
            ),
          );
        return base.generate(system, value, opts);
      },
    };
    const r = await respond(t.db, t.read, "lin", input(), p);
    assert.ok(
      r.reply.usedItems!.every((i) => i.id.startsWith("virtual-home:lin:")),
    );
    const bad = {
      ...base,
      complete: async (
        ...args: Parameters<NonNullable<Provider["complete"]>>
      ) => {
        const result = await base.complete!(...args);
        for (const call of result.toolCalls)
          call.function.arguments = JSON.stringify({
            itemIds: ["item8x"],
            query: "story",
          });
        return result;
      },
    };
    await assert.rejects(
      () => respond(t.db, t.read, "lin", input(), bad),
      /未读取|未授权/,
    );
  } finally {
    t.db.close();
  }
});

test("单件再创造可使用获准家庭偏好，但不读取全局私人偏好", async () => {
  const { planDiscovery } = await import("../src/lib/life/planning.ts");
  const { ProviderError } = await import("../src/lib/ai/provider.ts");
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    saveMemory(t.db, t.read, "lin", {
      kind: "preference",
      text: "我喜欢旅行与安静 GLOBAL_PRIVATE",
      allowCloud: true,
    });
    let seen: any;
    const p = {
      ...model(),
      generate: async (_system: any, value: any) => {
        seen = value;
        throw new ProviderError("network", "offline-stop");
      },
    };
    await assert.rejects(
      () =>
        planDiscovery(
          t.db,
          t.read(),
          "lin",
          {
            goal: "探索新的创意用法，我喜欢旅行和安静",
            itemId: homeItemId("lin", "samla"),
            itemIds: [homeItemId("lin", "samla")],
            homeId: "young-apartment-v1",
            includeSynthetic: true,
            model: true,
            publicEvidence: false,
          },
          p,
          t.read,
        ),
      /offline-stop/,
    );
    assert.equal(seen.creativeFacts.length, 1);
    assert.ok(
      seen.authorizedPreferences.some((m: any) => m.text.includes("安静")),
    );
    assert.ok(!JSON.stringify(seen).includes("GLOBAL_PRIVATE"));
  } finally {
    t.db.close();
  }
});
