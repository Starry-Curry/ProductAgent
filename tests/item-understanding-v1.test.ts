import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import {
  itemContext,
  itemContextPage,
  accessibleItemContexts,
  readItemContext,
} from "../src/lib/context/items.ts";
import { itemAdviceIssues } from "../src/lib/context/item-advice.ts";
import {
  positiveGoalText,
  violatesGoal,
} from "../src/lib/life/planning-constraints.ts";
import { planDiscovery } from "../src/lib/life/planning.ts";
import { modelIdea } from "../src/lib/life/ideas.ts";
import { respond } from "../src/lib/agent/service.ts";
import { ProviderError, type Provider } from "../src/lib/ai/provider.ts";
import { routeProductTurn } from "../src/lib/home/router.ts";
import type { ServiceSession } from "../src/lib/agent/contracts.ts";
import { mutate } from "../src/lib/domain.ts";

for (const goal of [
  "无线鼠标的登记型号和品牌是什么？",
  "无线鼠标的官方资料能证明我的这只目前工作正常吗？",
]) {
  test(`档案和实物状态不被型号知识淹没：${goal}`, async () => {
    const t = fixture();
    try {
      const id = t.add("无线鼠标", "设备", "Logitech", "M-R0061");
      t.write(
        mutate(t.read(), "lin", "bindProduct", {
          itemId: id,
          packId: "logitech-m185-m-r0061",
          confirmed: true,
        }),
      );
      const p: Provider = {
        ready: true,
        model: "offline",
        generate: async () => {
          throw Error("metadata must not call model");
        },
        complete: async () => {
          throw Error("metadata must not call model");
        },
      };
      const r = await respond(
        t.db,
        t.read,
        "lin",
        {
          requestId: crypto.randomUUID(),
          itemId: id,
          question: goal,
          mode: "auto",
          memoryPolicy: "off",
          uiContext: { page: "assistant" },
        },
        p,
      );
      assert.equal(r.modelCalls, 0);
      assert.match(
        r.reply.answer,
        goal.includes("登记型号") ? /Logitech.*M-R0061/ : /不能证明/,
      );
    } finally {
      t.db.close();
    }
  });
}
test("候选资源检查失败返回明确本地降级，不当成模型成功或用户没登记", async () => {
  const t = fixture();
  const p: Provider = {
    ready: true,
    model: "offline",
    generate: async () => ({
      model: "offline",
      tokens: null,
      text: JSON.stringify({
        title: "缺资源",
        itemIds: ["not-owned"],
        minutes: 10,
        steps: ["做一个纸笔游戏"],
        limits: ["未实测"],
        rationale: "规则互动",
        missing: [],
        factIds: [],
      }),
    }),
  };
  try {
    const r = await planDiscovery(
      t.db,
      t.read(),
      "lin",
      {
        goal: "只用我登记的物品想个新用途",
        model: true,
        publicEvidence: false,
        candidates: 1,
      },
      p,
      t.read,
    );
    assert.equal(r.cloudRejected, true);
    assert.equal(r.failure?.kind, "candidate_invalid");
    assert.notEqual(r.source, "model-creative");
    assert.equal(r.modelCalls, 2);
  } finally {
    t.db.close();
  }
});
function fixture() {
  const t = validationFixture(
    mkdtempSync(path.join(process.cwd(), ".runtime/item-v1-test-")),
  );
  const cup = t.add("无盖不锈钢水杯", "水杯", "未知", "未知", {
    attributes: {
      material: "不锈钢，单层，无杯盖",
      quantity: 1,
      care: "食品接触与耐热未确认；不加热",
      capabilities: ["容纳常温物品"],
    },
  });
  return { ...t, cup };
}
const packet = (answer: string, kind = "general") =>
  JSON.stringify({
    kind,
    answer,
    factIds: [],
    procedureId: null,
    questions: [],
  });
const question = "今天很累，先核对登记，再说一件适合休息的物品。";
function result(text: string, toolCalls: any[] = []) {
  return {
    text,
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : "stop",
    model: "offline-fixture",
    tokens: { input: 1, output: 1 },
  };
}

for (const phrase of [
  "只用我登记的物品",
  "只用我已登记的物品",
  "只使用我登记过的物品",
  "利用现有物品",
  "用已有的东西",
  "用我录入的物品",
  "仅用家里已有的物品",
  "只有我登记的物品",
  "利用我拥有的物品",
  "使用手边已有物品",
  "只用当前登记的全部物品",
  "利用我已经录入的这些物品",
]) {
  test(`库存指代进入模型路径：${phrase}`, async () => {
    const t = fixture();
    let calls = 0;
    try {
      const p: Provider = {
        ready: true,
        model: "offline",
        generate: async () => {
          calls++;
          throw new ProviderError("network", "offline sentinel");
        },
      };
      await assert.rejects(
        planDiscovery(
          t.db,
          t.read(),
          "lin",
          {
            goal: `想找个有趣玩法，${phrase}，不买东西，不要拍照`,
            model: true,
            publicEvidence: false,
          },
          p,
          t.read,
        ),
        /offline sentinel/,
      );
      assert.equal(calls, 1);
    } finally {
      t.db.close();
    }
  });
}

for (const [goal, expected] of [
  ["不要拍照，想玩一个纸笔游戏", "想玩一个纸笔游戏"],
  ["不加热，观察纸的影子", "观察纸的影子"],
  ["不想摄影，试着写故事", "试着写故事"],
]) {
  test(`否定活动不成为目标：${goal}`, () => {
    assert.equal(positiveGoalText(goal).replace(/^[ ，,]+/, ""), expected);
  });
}
for (const [goal, action] of [
  ["不要拍照", "用相机拍照"],
  ["不用水", "倒入水"],
  ["不加热", "加热杯子"],
  ["不买东西", "购买新材料"],
]) {
  test(`实际步骤遵守否定限制：${goal}`, () =>
    assert.equal(violatesGoal(goal, action), true));
}

test("物品契约保留ID/登记/未知与来源，不泄露隐私字段或越权物品", () => {
  const t = fixture();
  try {
    const state = t.read();
    const item = state.items.find((i) => i.id === t.cup)!;
    item.note = "private note sentinel";
    item.location = "private location sentinel";
    const context = itemContext(item);
    assert.equal(context.id, t.cup);
    assert.equal(context.brand, null);
    assert.match(context.properties.care!, /食品接触/);
    assert.ok(context.unknowns.includes("尺寸"));
    assert.equal(context.sources.registration.verified, false);
    assert.doesNotMatch(JSON.stringify(context), /private .* sentinel/);
    item.owner = "friend";
    item.shared = false;
    t.write(state);
    assert.equal(readItemContext(t.read(), "lin", t.cup), undefined);
    assert.ok(
      !accessibleItemContexts(t.read(), "lin").some((i) => i.id === t.cup),
    );
  } finally {
    t.db.close();
  }
});

for (const advice of [
  "这只杯子可安心使用。",
  "先用无盖不锈钢水杯喝点温水。",
  "它是304食品级不锈钢。",
  "用它的镜面观察倒影。",
  "杯底弧面可以放大文字。",
  "可以盛装热水。",
  "这只杯子的承重足够。",
  "先加热水杯，最后再确认耐热。",
  "利用表面的凹槽夹住纸。",
  "杯子透明，能直接看到里面。",
]) {
  test(`缺证据的性质或行动被拒：${advice}`, () => {
    const t = fixture();
    try {
      assert.ok(
        itemAdviceIssues(advice, [
          itemContext(t.read().items.find((i) => i.id === t.cup)!),
        ]).length,
      );
    } finally {
      t.db.close();
    }
  });
}
for (const advice of [
  "尚未确认食品接触条件，先不要用它喝水。",
  "没有证据说明它是304或食品级，不能承诺可安心使用。",
  "如果确认食品接触适用，才用该杯喝水，否则选择其他已确认的容器。",
  "先用纸笔做接龙，不依赖杯子的耐热、镜面或承重。",
]) {
  test(`拒绝或明确前置条件不误判：${advice}`, () => {
    const t = fixture();
    try {
      assert.deepEqual(
        itemAdviceIssues(advice, [
          itemContext(t.read().items.find((i) => i.id === t.cup)!),
        ]),
        [],
      );
    } finally {
      t.db.close();
    }
  });
}

for (const mode of ["local-demo", "public-demo"]) {
  test(`${mode} 完成真实Graph tool→result→answer，带属性与稳定ID`, async () => {
    const t = fixture();
    const previous = process.env.AUTH_MODE;
    process.env.AUTH_MODE = mode;
    let calls = 0;
    const p: Provider = {
      ready: true,
      model: "offline-fixture",
      generate: async () => {
        throw Error("unexpected");
      },
      complete: async (messages) => {
        calls++;
        if (calls === 1)
          return result("", [
            {
              id: "list",
              type: "function",
              function: { name: "list_accessible_items", arguments: "{}" },
            },
          ]);
        const value = JSON.parse(
          messages.find((m) => m.role === "tool")!.content!,
        );
        const cup = value.items.find((i: any) => i.id === t.cup);
        assert.match(cup.properties.care, /食品接触/);
        assert.equal(cup.sources.registration.verified, false);
        return result(
          packet(
            "登记包含这只水杯，食品接触适用性还未确认，先核对再决定用途。",
          ),
        );
      },
    };
    try {
      const r = await respond(
        t.db,
        t.read,
        "lin",
        {
          requestId: crypto.randomUUID(),
          mode: "auto",
          memoryPolicy: "off",
          question,
          uiContext: { page: "assistant" },
        },
        p,
      );
      assert.equal(calls, 2);
      assert.equal(r.reply.outcome, "answered");
      assert.ok(r.trace.some((s) => s.stage === "tool_completed"));
    } finally {
      t.db.close();
      if (previous === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = previous;
    }
  });
}

test("详情工具拒绝越权ID且不透露隐藏名称", async () => {
  const t = fixture();
  const state = t.read();
  const cup = state.items.find((i) => i.id === t.cup)!;
  cup.owner = "friend";
  cup.shared = false;
  cup.name = "hidden sentinel";
  t.write(state);
  let calls = 0;
  const p: Provider = {
    ready: true,
    model: "offline",
    generate: async () => {
      throw Error("unexpected");
    },
    complete: async (messages) => {
      calls++;
      if (calls === 1)
        return result("", [
          {
            id: "read",
            type: "function",
            function: {
              name: "read_item_context",
              arguments: JSON.stringify({ itemId: t.cup }),
            },
          },
        ]);
      const tool = messages.find((m) => m.role === "tool")!.content!;
      assert.match(tool, /error/);
      assert.doesNotMatch(tool, /hidden sentinel/);
      return result(packet("没有本轮获准的物品详情。", "needs_info"));
    },
  };
  try {
    const r = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        mode: "auto",
        memoryPolicy: "off",
        question,
        uiContext: { page: "assistant" },
      },
      p,
    );
    assert.ok(r.trace.some((s) => s.stage === "tool_denied"));
  } finally {
    t.db.close();
  }
});

test("模型循环耗尽明确报回合预算，不伪装成用户缺资料", async () => {
  const t = fixture();
  let calls = 0;
  const p: Provider = {
    ready: true,
    model: "offline",
    generate: async () => {
      throw Error("unexpected");
    },
    complete: async () => {
      calls++;
      return result("", [
        {
          id: `list${calls}`,
          type: "function",
          function: { name: "list_accessible_items", arguments: "{}" },
        },
      ]);
    },
  };
  try {
    const r = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        mode: "auto",
        memoryPolicy: "off",
        question,
        uiContext: { page: "assistant" },
      },
      p,
    );
    assert.equal(calls, 4);
    assert.equal(r.reply.outcome, "unavailable");
    assert.equal(r.reply.errorCode, "turn_budget_exhausted");
  } finally {
    t.db.close();
  }
});

test("创意修正超时保留准确错误，未通过草稿不落库，不自动重试网络", async () => {
  const t = fixture();
  let calls = 0;
  const p: Provider = {
    ready: true,
    model: "offline",
    generate: async () => {
      calls++;
      if (calls > 1) throw new ProviderError("timeout", "offline timeout");
      return {
        model: "offline",
        tokens: null,
        text: JSON.stringify({
          title: "错误表面假设",
          itemIds: [t.cup],
          minutes: 10,
          steps: ["利用杯底弧面和镜面观察文字。"],
          limits: ["未实测"],
          rationale: "抛光可以放大",
          missing: [],
          factIds: [],
          requirements: [{ itemId: t.cup, quantity: 1 }],
        }),
      };
    },
  };
  try {
    await assert.rejects(
      modelIdea(t.db, t.read(), "lin", "想试一个新玩法", p, false, t.read, {
        candidates: 1,
      }),
      (e) => e instanceof ProviderError && e.code === "creative_repair_timeout",
    );
    assert.equal(calls, 2);
    assert.equal(
      (t.db.prepare("SELECT COUNT(*) n FROM life_ideas").get() as { n: number })
        .n,
      0,
    );
  } finally {
    t.db.close();
  }
});

test("物品分页有总数和下一页，不把前40件伪装成全部", () => {
  const t = fixture();
  try {
    const state = t.read();
    const cup = state.items.find((i) => i.id === t.cup)!;
    state.items = Array.from({ length: 45 }, (_, n) => ({
      ...cup,
      id: `item-${n}`,
    }));
    const first = itemContextPage(state, "lin", false, 0, 40),
      last = itemContextPage(state, "lin", false, first.nextOffset!, 40);
    assert.equal(first.total, 45);
    assert.equal(first.items.length, 40);
    assert.equal(first.nextOffset, 40);
    assert.equal(last.items.length, 5);
    assert.equal(last.nextOffset, null);
  } finally {
    t.db.close();
  }
});

for (const kind of ["properties", "permission"]) {
  test(`模型等待期间${kind}改变时中止旧上下文回答`, async () => {
    const t = fixture();
    let calls = 0;
    const p: Provider = {
      ready: true,
      model: "offline",
      generate: async () => {
        throw Error("unexpected");
      },
      complete: async () => {
        calls++;
        if (calls === 1)
          return result("", [
            {
              id: "read",
              type: "function",
              function: {
                name: "read_item_context",
                arguments: JSON.stringify({ itemId: t.cup }),
              },
            },
          ]);
        const state = t.read(),
          item = state.items.find((i) => i.id === t.cup)!;
        if (kind === "permission") {
          item.owner = "friend";
          item.shared = false;
        } else {
          item.availability = "broken";
          item.attributes = { ...item.attributes, care: "破损，禁止使用" };
        }
        t.write(state);
        return result(packet("登记包含这只杯子。"));
      },
    };
    try {
      await assert.rejects(
        respond(
          t.db,
          t.read,
          "lin",
          {
            requestId: crypto.randomUUID(),
            mode: "auto",
            memoryPolicy: "off",
            question,
            uiContext: { page: "assistant" },
          },
          p,
        ),
        /已改变|授权/,
      );
      assert.equal(calls, 2);
    } finally {
      t.db.close();
    }
  });
}

for (const goal of [
  "用未知材质盒和纸笔构思一个新用途，材质未知，不承重、不用水、不加热。",
  "只用我已有的物品做个小游戏，不使用损坏小台灯，不拍照、不用水。",
]) {
  test(`真实路由回归：${goal}`, () => {
    const t = fixture();
    try {
      t.add("未知材质盒", "容器", "未知", "未知");
      t.add("损坏小台灯", "设备", "未知", "未知");
      const at = new Date().toISOString();
      const session: ServiceSession = {
        id: crypto.randomUUID(),
        owner: "lin",
        revision: 0,
        status: "active",
        messages: [],
        tried: [],
        memoryEpoch: 0,
        createdAt: at,
        updatedAt: at,
        expiresAt: at,
        mode: "auto",
        known: { uiPage: "assistant" },
      };
      assert.equal(
        routeProductTurn(goal, t.read(), "lin", session).intent,
        "plan",
      );
    } finally {
      t.db.close();
    }
  });
}
