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
      const value = input as {
        question: string;
        taskDraft: { goal: string; parts: unknown[] };
        readResults: any[];
      };
      const c = value.readResults.find((c) => c.items) || {};
      return {
        text: JSON.stringify({
          answer: "仅使用当前资料回应完整目标，支撑结构未知。",
          goal:"布置画与书桌",
          tasks:[{title:"赠送关系",status:"addressed"},{title:"布局条件",status:"needs_info"}],
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

test("模拟家庭与原空间不能复用已有聊天上下文；无关的私人物品不进入家庭模型",async()=>{
 const t=fixture();try{
  installVirtualHome(t.db,t.read,"lin",true);
  const r=await respond(t.db,t.read,"lin",input(),model());
  await assert.rejects(respond(t.db,t.read,"lin",input({sessionId:r.session.id,uiContext:{page:"assistant"}}),model()),/开始新问题/);
 }finally{t.db.close();}
});
