import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { seed, mutate, type State } from "../src/lib/domain.ts";
import { migrate } from "../src/lib/migrations.ts";
import { migrateLife } from "../src/lib/life/schema.ts";
import { planDiscovery } from "../src/lib/life/planning.ts";
import { respond } from "../src/lib/agent/service.ts";
import { additionalQuestions } from "../src/lib/agent/presentation.ts";
import { routeHome } from "../src/lib/home/router.ts";
import { feedbackIdea } from "../src/lib/life/ideas.ts";
import { saveMemory, forgetMemory } from "../src/lib/memory/store.ts";
import type { Provider } from "../src/lib/ai/provider.ts";
import { withoutProhibitedActions } from "../src/lib/agent/safety-language.ts";
function fixture() {
  const file = path.join(
      mkdtempSync(path.join(tmpdir(), "wujian-experience-")),
      "test.sqlite",
    ),
    db = new DatabaseSync(file);
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
  const write = (s: State) =>
    db.prepare("UPDATE workspace SET body=?").run(JSON.stringify(s));
  const add = (name: string, category: string, material: string) => {
    const s = mutate(read(), "lin", "createItem", { name, category });
    const i = s.items.at(-1)!;
    mutate(s, "lin", "updateItem", {
      itemId: i.id,
      availability: "available",
      attributes: { material, quantity: 1 },
    });
    write(s);
    return i.id;
  };
  return { db, read, write, add };
}
const offline: Provider = {
  ready: false,
  model: "offline",
  async generate() {
    throw Error("offline must not request");
  },
};
test("安全否定句不当成危险指令，句中后续危险动作仍保留待拦截", () => {
  assert.equal(withoutProhibitedActions("不要拆机，不使用明火"), "，");
  assert.match(withoutProhibitedActions("不要拆机，然后短接电池"), /短接电池/);
});
test("页面选中物品被保留；App问题与自由交流不误入商品澄清", async () => {
  const t = fixture();
  try {
    const itemId = t.add("夜跑手电筒", "照明", "塑料");
    const app = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        question: "这个App怎么用",
        mode: "auto",
        itemId,
        memoryPolicy: "off",
        uiContext: { page: "item" },
      },
      offline,
    );
    assert.equal(app.reply.route!.intent, "app");
    assert.equal(app.modelCalls, 0);
    assert.match(app.reply.answer, /社交页/);
    const session = {
      ...app.session,
      known: { ...app.session.known, uiPage: "item", activeItemId: itemId },
    };
    assert.equal(
      routeHome("这个怎么用", t.read(), "lin", session).itemId,
      itemId,
    );
    assert.equal(
      routeHome("怎么面对工作压力，想聊聊", t.read(), "lin", session).intent,
      "companion",
    );
    assert.equal(
      routeHome("我今天有一小时，想做点有趣的事", t.read(), "lin", session)
        .intent,
      "plan",
    );
    const mouse = t.add("常用鼠标", "电子设备", "塑料");
    t.write(
      mutate(t.read(), "lin", "bindProduct", {
        itemId: mouse,
        packId: "logitech-m185-m-r0061",
        confirmed: true,
      }),
    );
    const first = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        question: "这个怎么用",
        mode: "auto",
        itemId: mouse,
        memoryPolicy: "off",
        uiContext: { page: "item" },
      },
      offline,
    );
    assert.match(first.reply.answer, /原配接收器/);
    const next = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        sessionId: first.session.id,
        expectedRevision: first.session.revision,
        question: "有原配接收器",
        mode: "auto",
        itemId: mouse,
        memoryPolicy: "off",
        uiContext: { page: "item" },
      },
      offline,
    );
    assert.equal(next.reply.route!.itemId, mouse);
    assert.equal(next.reply.steps.length, 3);
    assert.equal(next.reply.questions.length, 0);
  } finally {
    t.db.close();
  }
});
test("连续自由交流传入页面和本轮历史；不绑定物品也不强制提问", async () => {
  const t = fixture();
  try {
    saveMemory(t.db, t.read, "lin", {
      kind: "experience",
      text: "合成隐私旅行：去年海边留下的私人经历",
      allowCloud: true,
    });
    const requests: any[] = [];
    const provider: Provider = {
      model: "offline-protocol-fixture",
      async generate(_s, input) {
        requests.push(input);
        return {
          text: JSON.stringify({
            kind: "general",
            answer: "可以先放松一下，愿意的话我们慢慢聊。",
            questions: [],
            factIds: [],
            procedureId: null,
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
        requestId: crypto.randomUUID(),
        question: "今天工作压力很大",
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { page: "assistant" },
      },
      provider,
    );
    const second = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        sessionId: first.session.id,
        expectedRevision: first.session.revision,
        question: "嗯，想聊点电影",
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { page: "assistant" },
      },
      provider,
    );
    assert.equal(second.reply.route!.intent, "companion");
    assert.equal(second.reply.outcome, "answered");
    assert.equal(second.reply.questions.length, 0);
    const payload = JSON.stringify(requests.at(-1));
    assert.match(payload, /今天工作压力很大/);
    assert.match(payload, /pageContext/);
    assert.ok(!payload.includes("合成隐私旅行"));
  } finally {
    t.db.close();
  }
});
test("能力组合不依赖种子ID，下一轮排除真实资源并保护上一轮权限", async () => {
  const t = fixture();
  try {
    const light = t.add("夜跑手电筒", "电子设备", "塑料"),
      glass = t.add("透明玻璃杯", "厨房用品", "玻璃");
    const first = await planDiscovery(
      t.db,
      t.read(),
      "lin",
      { goal: "我有手电筒和玻璃杯，想做有趣的光影玩法", minutes: 30 },
      offline,
      t.read,
    );
    const pair = first.ideas.find(
      (i) => i.itemIds.includes(light) && i.itemIds.includes(glass),
    );
    assert.ok(pair);
    assert.equal(pair.source, "local-candidate");
    feedbackIdea(t.db, t.read(), "lin", {
      id: pair.id,
      saved: true,
      outcome: "用户报告有效",
    });
    const again = await planDiscovery(
      t.db,
      t.read(),
      "lin",
      { goal: "我有手电筒和玻璃杯，想做有趣的光影玩法", minutes: 30 },
      offline,
      t.read,
    );
    assert.ok(again.ideas.some((i) => i.id === pair.id && i.saved));
    const shorter = await planDiscovery(
      t.db,
      t.read(),
      "lin",
      { goal: "我只有十分钟", previousIdeaIds: [pair.id] },
      offline,
      t.read,
    );
    assert.match(shorter.understanding, /10分钟/);
    const unclear = await planDiscovery(
      t.db,
      t.read(),
      "lin",
      { goal: "不要用这个", previousIdeaIds: [pair.id] },
      offline,
      t.read,
    );
    assert.equal(unclear.ideas.length, 0);
    assert.match(unclear.missing.join(" "), /排除哪件/);
    const next = await planDiscovery(
      t.db,
      t.read(),
      "lin",
      {
        goal: "不用这件，换个方向",
        previousIdeaIds: [pair.id],
        excludedItemIds: [light],
      },
      offline,
      t.read,
    );
    assert.ok(next.resources.every((i) => i.id !== light));
    assert.ok(next.ideas.every((i) => !i.itemIds.includes(light)));
    await assert.rejects(
      planDiscovery(
        t.db,
        t.read(),
        "dad",
        { goal: "换个方向", previousIdeaIds: [pair.id] },
        offline,
        t.read,
      ),
      /未获授权/,
    );
  } finally {
    t.db.close();
  }
});
test("开放规划使用真实资源/历史反馈与预算，生成新方案并验证事实和撤权", async () => {
  const t = fixture();
  try {
    const id = t.add("旅行布包", "出行用品", "布");
    const packets: any[] = [];
    const provider: Provider = {
      model: "offline-protocol-fixture",
      async generate(_s, input) {
        packets.push(input);
        return {
          model: this.model,
          tokens: null,
          text: JSON.stringify({
            title: "给今天做一场微型寻物叙事",
            itemIds: [id],
            minutes: 20,
            steps: [
              "把布包放稳，选三个已有小物观察",
              "用一句话描述每个物品的用途，再尝试不同排序",
            ],
            limits: ["需本人确认三个小物在场；不假设已拥有额外材料"],
            rationale: "将携带能力用于整理与观察",
            missing: ["三个小物是否在场"],
          }),
        };
      },
    };
    const result = await planDiscovery(
      t.db,
      t.read(),
      "lin",
      { goal: "我有一小时，不买东西，想做点有趣的事", model: true },
      provider,
      t.read,
    );
    assert.equal(result.ideas[0].source, "model-creative");
    assert.equal(packets[0].minutes, 60);
    assert.equal(packets[0].planning.noPurchase, true);
    assert.match(result.missing.join(" "), /小物/);
    const reply = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        question: "我有一小时，不买东西，想做点有趣的事",
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { page: "assistant" },
      },
      provider,
    );
    assert.equal(reply.reply.route!.intent, "plan");
    assert.equal(reply.modelCalls, 1);
    assert.equal(reply.reply.steps.length, 2);
    const m = saveMemory(t.db, t.read, "lin", {
      kind: "interest",
      text: "合成测试：喜欢观察",
      allowCloud: true,
    });
    await assert.rejects(
      planDiscovery(
        t.db,
        t.read(),
        "lin",
        { goal: "来个新玩法", model: true },
        {
          ...provider,
          async generate(s, x) {
            forgetMemory(t.db, "lin", m.id);
            return provider.generate(s, x);
          },
        },
        t.read,
      ),
      /授权或记忆已变化/,
    );
  } finally {
    t.db.close();
  }
});
test("正文已经问过的问题不再重复展示，保存的数据包不被改写", () => {
  const r = {
    answer: "先确认一下，你用的是哪种系统？",
    questions: ["你用的是哪种系统？", "有原配接收器吗？", "有原配接收器吗？"],
  };
  assert.deepEqual(additionalQuestions(r), ["有原配接收器吗？"]);
  assert.equal(r.questions.length, 3);
});
test("新版聊天叙述不自动写生活故事，临时目标不持久化候选或个人记忆", async () => {
  const t = fixture();
  try {
    const id = t.add("随身小相机", "电子设备", "塑料");
    const provider: Provider = {
      model: "offline-protocol-fixture",
      async generate() {
        return {
          model: this.model,
          tokens: null,
          text: JSON.stringify({
            kind: "general",
            answer: "可以在这次交流里慢慢聊，想留作故事时再明确保存。",
            factIds: [],
            questions: [],
            procedureId: null,
          }),
        };
      },
    };
    const before = t.read().memories.length;
    const story = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        question: "我昨天和妈妈用相机拍了照",
        itemId: id,
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { page: "item" },
      },
      provider,
    );
    assert.equal(story.reply.route!.intent, "companion");
    assert.equal(t.read().memories.length, before);
    assert.equal(
      (
        t.db.prepare("SELECT count(*) n FROM life_fragments").get() as {
          n: number;
        }
      ).n,
      0,
    );
    await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        question: "我想用已有物品做点有趣的事",
        mode: "auto",
        temporary: true,
        uiContext: { page: "assistant" },
      },
      provider,
    );
    assert.equal(
      (t.db.prepare("SELECT count(*) n FROM life_ideas").get() as { n: number })
        .n,
      0,
    );
  } finally {
    t.db.close();
  }
});
