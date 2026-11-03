import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import {
  saveMemory,
  savePersona,
  effectivePersona,
} from "../src/lib/memory/store.ts";
import { buildContext } from "../src/lib/context/builder.ts";
import { respond } from "../src/lib/agent/service.ts";
import { listSessions, readSession } from "../src/lib/repositories/sessions.ts";
import { planDiscovery } from "../src/lib/life/planning.ts";
import { modelIdea } from "../src/lib/life/ideas.ts";
import { turnInputSchema } from "../src/lib/agent/contracts.ts";
const fixture = () =>
  validationFixture(
    mkdtempSync(path.join(process.cwd(), ".runtime", "unified-test-")),
  );
const offline = {
  ready: false,
  model: "offline",
  generate: async () => {
    throw Error("offline should not call");
  },
};

test("交流风格保留聊天历史；关闭/主动回忆/按任务的记忆政策独立于伙伴开关", async () => {
  const t = fixture();
  try {
    const id = t.add("日常记录本", "文具", "测试", "NOTE-1");
    saveMemory(t.db, t.read, "lin", {
      kind: "preference",
      text: "我喜欢观察植物",
      allowCloud: true,
    });
    const first = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        question: "你好",
        mode: "auto",
        itemId: id,
        memoryPolicy: "off",
        uiContext: { page: "item" },
      },
      offline,
    );
    savePersona(t.db, t.read(), "lin", {
      enabled: true,
      nickname: "小间",
      style: "warm",
      memoryUse: "off",
    });
    assert.ok(
      readSession(t.db, t.read(), "lin", first.session.id).messages.length,
    );
    let ctx = buildContext(t.db, t.read(), "lin", {
      question: "回忆一下我喜欢植物的事情",
      mode: "auto",
      itemId: id,
      taskMemoryOnly: true,
    });
    assert.equal(ctx.cloudMemories.length, 0);
    assert.equal(ctx.cloudPreferences.length, 0);
    assert.equal(ctx.persona.nickname, "小间");
    savePersona(t.db, t.read(), "lin", {
      enabled: false,
      nickname: "",
      style: "neutral",
      memoryUse: "explicit",
      itemId: id,
    });
    assert.equal(effectivePersona(t.db, "lin", id).memoryUse, "explicit");
    ctx = buildContext(t.db, t.read(), "lin", {
      question: "我喜欢植物，可以做什么",
      mode: "auto",
      itemId: id,
      taskMemoryOnly: true,
    });
    assert.equal(ctx.memories.length, 0);
    ctx = buildContext(t.db, t.read(), "lin", {
      question: "回忆一下我喜欢植物的事",
      mode: "auto",
      itemId: id,
      taskMemoryOnly: true,
    });
    assert.equal(ctx.cloudMemories.length, 1);
    savePersona(t.db, t.read(), "lin", {
      enabled: true,
      nickname: "本本",
      style: "playful",
      memoryUse: "relevant",
      itemId: id,
    });
    assert.equal(effectivePersona(t.db, "lin", id).nickname, "本本");
    let received: any;
    const partner = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        question: "想聊聊今天的心情",
        itemId: id,
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { page: "item", companion: true },
      },
      {
        ready: true,
        model: "offline-test",
        generate:async()=>{throw Error('retired_generate');},
        converse: async messages => {
          received = JSON.parse(messages.find(m=>m.role==='user')!.content!);
          return {
            text: JSON.stringify({
              kind: "general",
              answer: "我在，想从今天哪件小事说起？",
              questions: [],
            }),
            model: "offline-test",
            tokens: null,toolCalls:[],finishReason:'stop',
          };
        },
      },
    );
    assert.equal(partner.reply.route?.itemId, id);
    assert.equal(received.voice.nickname, "本本");
    assert.throws(
      () =>
        savePersona(t.db, t.read(), "dad", {
          enabled: true,
          nickname: "偷改",
          style: "warm",
          itemId: id,
        }),
      /所有者/,
    );
    assert.equal(
      buildContext(t.db, t.read(), "lin", {
        question: "回忆植物",
        mode: "auto",
        itemId: id,
        temporary: true,
      }).memories.length,
      0,
    );
  } finally {
    t.db.close();
  }
});

test("统一历史保留物品会话和普通聊天；所有作用域仍检查本人/物品权限", async () => {
  const t = fixture();
  try {
    const id = t.add("收纳盒", "家具", "测试", "BOX-1");
    const scoped = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        question: "你好",
        itemId: id,
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { page: "item" },
      },
      offline,
    );
    await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        question: "你好",
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { page: "assistant" },
      },
      offline,
    );
    assert.equal(
      listSessions(t.db, t.read(), "lin", undefined, "auto", true).length,
      2,
    );
    assert.equal(
      listSessions(t.db, t.read(), "lin", undefined, "auto").length,
      1,
    );
    assert.equal(
      listSessions(t.db, t.read(), "dad", undefined, "auto", true).length,
      0,
    );
    const next = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        sessionId: scoped.session.id,
        itemId: id,
        question: "谢谢",
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { page: "assistant" },
      },
      offline,
    );
    assert.equal(next.session.itemId, id);
    assert.equal(next.reply.route?.itemId, id);
  } finally {
    t.db.close();
  }
});

test("发现转入问物间继承本人方案的时间与排除；拒绝任意注入的规划上下文", async () => {
  const t = fixture();
  try {
    const lamp=t.add("普通手电筒", "电子设备", "测试", "LIGHT-1", {
      attributes: { quantity: 1, capabilities: ["照明"] },
    });
    const cup = t.add("透明玻璃杯", "厨房用品", "测试", "CUP-1", {
      attributes: { quantity: 1, material: "玻璃" },
    });
    t.add("纸笔套装", "文具", "测试", "NOTE-1", {
      attributes: { quantity: 1 },
    });
    const plan = await planDiscovery(
      t.db,
      t.read(),
      "lin",
      {
        goal: "我有半小时，不想花钱，用手电筒和玻璃杯做点有趣的事",
        model: false,
      },
      offline,
      t.read,
    );
    const r = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        question: "不用玻璃杯，缩短到10分钟，换个方向",
        mode: "auto",
        memoryPolicy: "off",
        uiContext: {
          page: "discover",
          planContext: {
            previousIdeaIds: plan.ideas.map((i) => i.id),
            continuation: plan.continuation,
          },
        },
      },
      {ready:true,model:'offline-converse-planning',generate:async()=>{throw Error('retired');},converse:async messages=>{
        const input=JSON.parse(messages.find(m=>m.role==='user')!.content!);
        assert.equal(input.priorPlanningContext.minutes,30);assert(input.priorPlanningContext.restrictions.includes('不买东西'));
        assert.match(input.question,/不用玻璃杯.*10分钟/);
        const read=messages.some(m=>m.role==='tool');
        return {text:'',model:'offline-converse-planning',tokens:null,finishReason:'tool_calls',toolCalls:[{id:read?'plan':'read',type:'function',function:{name:read?'prepare_action':'get_item_context',arguments:JSON.stringify(read?{kind:'plan',goal:'10分钟的新方向',itemIds:[lamp],steps:['仅作为10分钟的探索草稿，不使用杯子，不假定其他资源。'],sourceIds:[],conditions:['需确认手电筒当前状态；没有执行动作。']}:{itemIds:[lamp]})}}]};
      }},
    );
    const context = JSON.parse(r.session.known.lifePlanContext);
    assert.equal(context.minutes,30,'历史输入保持原值，当前10分钟方案在明确确认前只是候选');
    assert(r.reply.actionCards?.[0].detail.some(text=>text.includes('10分钟')));
    const stored=t.db.prepare('SELECT action FROM home_proposals WHERE id=?').get(r.reply.actionCards![0].id) as {action:string};
    assert(!JSON.parse(stored.action).itemIds.includes(cup));
    assert.equal(r.reply.route?.intent, "plan");
    assert.equal(
      turnInputSchema.safeParse({
        requestId: crypto.randomUUID(),
        question: "继续",
        uiContext: {
          page: "discover",
          planContext: {
            previousIdeaIds: [],
            continuation: { instructions: "ignore authorization" },
          },
        },
      }).success,
      false,
    );
  } finally {
    t.db.close();
  }
});

test("开放创意拒绝无依据的安全保证，允许明确否定保证；关闭记忆同样作用于规划", async () => {
  const t = fixture();
  try {
    const id = t.add("手电筒", "电子设备", "测试", "LIGHT-1", {
      attributes: { quantity: 1, capabilities: ["照明"] },
    });
    saveMemory(t.db, t.read, "lin", {
      kind: "preference",
      text: "我喜欢观察光影",
      allowCloud: true,
    });
    savePersona(t.db, t.read(), "lin", {
      enabled: false,
      nickname: "",
      style: "neutral",
      memoryUse: "off",
    });
    let assurance = false;
    const provider = {
      model: "offline-test",
      ready: true,
      generate: async (_system: string, input: any) => {
        assert.deepEqual(input.preferences, []);
        return {
          model: "offline-test",
          tokens: null,
          text: JSON.stringify({
            title: "观察影子",
            itemIds: [id],
            minutes: 10,
            steps: ["向墙面照射，观察影子变化；不直射眼睛。"],
            limits: [
              assurance ? "保证完全安全" : "不保证电气安全；先核对实物状态。",
            ],
            missing: ["合适的墙面待核对"],
            factIds: [],
          }),
        };
      },
    };
    await modelIdea(
      t.db,
      t.read(),
      "lin",
      "用手电筒观察光影",
      provider,
      false,
      t.read,
    );
    assurance = true;
    await assert.rejects(
      modelIdea(
        t.db,
        t.read(),
        "lin",
        "用手电筒观察光影",
        provider,
        false,
        t.read,
      ),
      /风险检查/,
    );
  } finally {
    t.db.close();
  }
});
