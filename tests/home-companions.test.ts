import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../src/lib/migrations.ts";
import { seed, mutate, type State, type Person } from "../src/lib/domain.ts";
import { respond } from "../src/lib/agent/service.ts";
import type { TurnResult, ServiceSession } from "../src/lib/agent/contracts.ts";
import { ProviderError, type Provider } from "../src/lib/ai/provider.ts";
import { placements, placeItem, decideAction } from "../src/lib/home/store.ts";
import { routeHome } from "../src/lib/home/router.ts";
import { installHouseholdCases } from "../src/lib/demo/install.ts";
import { listMemories, saveMemory } from "../src/lib/memory/store.ts";
import {
  readSession,
  recordSessionFeedback,
} from "../src/lib/repositories/sessions.ts";
import { reconcileMemories } from "../src/lib/memory/ambient.ts";
function fixture() {
  const filename = path.join(
    mkdtempSync(path.join(tmpdir(), "wujian-home-")),
    "test.sqlite",
  );
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE workspace(id INTEGER PRIMARY KEY,body TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO workspace VALUES(1,?)").run(JSON.stringify(seed()));
  migrate(db, filename);
  const read = () =>
    JSON.parse(
      (db.prepare("SELECT body FROM workspace").get() as { body: string }).body,
    ) as State;
  const write = (s: State) =>
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(JSON.stringify(s));
  const add = (name = "晨光书架", shared = true) => {
    const s = mutate(read(), "lin", "createItem", { name, location: "书房" });
    const i = s.items.at(-1)!;
    i.shared = shared;
    write(s);
    return i;
  };
  const item = add();
  const offline: Provider = {
    model: "offline",
    async generate() {
      throw new ProviderError("payment_not_authorized", "offline");
    },
  };
  const turn = (
    question: string,
    previous?: TurnResult,
    itemId?: string,
    actor: Person = "lin",
    provider = offline,
    temporary = false,
  ) =>
    respond(
      db,
      read,
      actor,
      {
        requestId: crypto.randomUUID(),
        question,
        mode: "auto",
        itemId,
        sessionId: previous?.session.id,
        expectedRevision: previous?.session.revision,
        temporary,
      },
      provider,
    );
  const place = (overrides = {}) => ({
    requestId: crypto.randomUUID(),
    itemId: item.id,
    roomId: "living",
    x: 0.4,
    y: 0.5,
    expectedRevision: 0,
    expectedLocation: read().items.find((i) => i.id === item.id)!.location,
    ...overrides,
  });
  return { db, filename, read, write, add, item, turn, place };
}
test("v6 增量迁移保留旧正文和升级前备份，重复迁移不重置数据", () => {
  const f = fixture();
  try {
    assert.ok(existsSync(f.filename + ".before-v5-to-v6.sqlite"));
    const backup = new DatabaseSync(f.filename + ".before-v5-to-v6.sqlite", {
      readOnly: true,
    });
    assert.equal(
      (
        backup
          .prepare("SELECT MAX(version) AS v FROM schema_migrations")
          .get() as any
      ).v,
      5,
    );
    backup.close();
    const before = JSON.stringify(f.read());
    migrate(f.db, f.filename);
    assert.equal(JSON.stringify(f.read()), before);
  } finally {
    f.db.close();
  }
});
test("路由区分具体帮助、真实故事、假设创作、陪伴和家庭安排", () => {
  const f = fixture();
  try {
    const s = { mode: "auto", itemId: f.item.id, known: {} } as ServiceSession;
    for (const [q, intent] of [
      ["书架怎么固定", "help"],
      ["毕业那天妈妈送我这件物品", "story"],
      ["假设它是妈妈送的，编一个故事", "companion"],
      ["今天很累，陪我聊聊", "companion"],
      ["请爸爸把书架搬到客厅", "handoff"],
      ["把书架的位置挪到客厅", "move"],
    ])
      assert.equal(routeHome(q, f.read(), "lin", s).intent, intent, q);
    assert.equal(
      routeHome("双击速度怎么调整", f.read(), "lin", {
        mode: "auto",
        known: {},
      } as ServiceSession).intent,
      "help",
    );
  } finally {
    f.db.close();
  }
});
test("只在可访问物品中匹配；同名澄清；选中物品不被文本切换", () => {
  const f = fixture();
  try {
    const hidden = f.add("秘密书架", false);
    const s = { mode: "auto", known: {} } as ServiceSession;
    assert.equal(
      routeHome("秘密书架在哪里", f.read(), "dad", s).itemId,
      undefined,
    );
    const route = routeHome("书架在哪里", f.read(), "lin", s);
    assert.equal(route.intent, "clarify");
    assert.equal(route.candidates?.length, 2);
    assert.equal(
      routeHome("秘密书架怎么用", f.read(), "lin", { ...s, itemId: f.item.id })
        .itemId,
      f.item.id,
    );
    assert.notEqual(hidden.id, f.item.id);
  } finally {
    f.db.close();
  }
});
test("位置保存同步档案，拒绝共享成员修改、越界、重复内容变化和并发覆盖", () => {
  const f = fixture();
  try {
    const input = f.place();
    const result = placeItem(f.db, f.read, "lin", input);
    assert.equal(
      f.read().items.find((i) => i.id === f.item.id)!.location,
      "客厅",
    );
    assert.deepEqual(placeItem(f.db, f.read, "lin", input), result);
    assert.equal(
      placements(f.db, f.read(), "lin").find((p) => p.itemId === f.item.id)!.x,
      0.4,
    );
    assert.throws(
      () => placeItem(f.db, f.read, "dad", f.place({ expectedRevision: 1 })),
      /所有者/,
    );
    assert.throws(
      () => placeItem(f.db, f.read, "lin", { ...input, x: 0.8 }),
      /重复请求/,
    );
    assert.throws(() => placeItem(f.db, f.read, "lin", f.place()), /已更新/);
    assert.throws(
      () => placeItem(f.db, f.read, "lin", f.place({ x: 3 })),
      /Too big/,
    );
  } finally {
    f.db.close();
  }
});
test("位置建议先预览后执行，重复确认不重复写，旧档案修改使建议失效", async () => {
  const f = fixture();
  try {
    const before = f.read().items.find((i) => i.id === f.item.id)!.location;
    const r = await f.turn("把晨光书架放到客厅");
    const card = r.reply.actionCards![0];
    assert.equal(
      f.read().items.find((i) => i.id === f.item.id)!.location,
      before,
    );
    const applied = decideAction(f.db, f.read, "lin", card.id, "confirm");
    assert.equal(applied.status, "applied");
    assert.equal(
      decideAction(f.db, f.read, "lin", card.id, "confirm").status,
      "applied",
    );
    assert.equal(
      placements(f.db, f.read(), "lin").find((p) => p.itemId === f.item.id)!
        .revision,
      1,
    );
    assert.equal(
      readSession(f.db, f.read(), "lin", r.session.id)
        .messages.filter((m) => m.role === "assistant")
        .at(-1)!.reply!.actionCards![0].status,
      "applied",
    );
    const receipts = readSession(
      f.db,
      f.read(),
      "lin",
      r.session.id,
    ).messages.filter((m) => m.role === "action");
    assert.equal(receipts.length, 1);
    assert.match(receipts[0].text, /位置已保存/);
    const second = await f.turn("把晨光书架放到卧室");
    f.write(
      mutate(f.read(), "lin", "updateItem", {
        itemId: f.item.id,
        location: "厨房",
      }),
    );
    assert.throws(
      () =>
        decideAction(
          f.db,
          f.read,
          "lin",
          second.reply.actionCards![0].id,
          "confirm",
        ),
      /档案位置已更新/,
    );
  } finally {
    f.db.close();
  }
});
test("家庭交接只创建预览摘要，确认幂等；撤权、过期和取消均阻止执行", async () => {
  const f = fixture();
  try {
    const start = f.read().tasks.length;
    const r = await f.turn("请爸爸帮我固定晨光书架");
    const c = r.reply.actionCards![0];
    assert.equal(f.read().tasks.length, start);
    assert.throws(
      () => decideAction(f.db, f.read, "dad", c.id, "confirm"),
      /授权/,
    );
    decideAction(f.db, f.read, "lin", c.id, "confirm");
    decideAction(f.db, f.read, "lin", c.id, "confirm");
    assert.equal(f.read().tasks.length, start + 1);
    assert.equal(f.read().tasks.at(-1)!.assignee, "dad");
    const cancelled = await f.turn("请爸爸帮我固定晨光书架");
    const cid = cancelled.reply.actionCards![0].id;
    decideAction(f.db, f.read, "lin", cid, "cancel");
    assert.throws(
      () => decideAction(f.db, f.read, "lin", cid, "confirm"),
      /已经处理/,
    );
    const stale = await f.turn("请爸爸帮我固定晨光书架");
    f.db
      .prepare("UPDATE home_proposals SET expires_at=? WHERE id=?")
      .run("2000-01-01", stale.reply.actionCards![0].id);
    assert.throws(
      () =>
        decideAction(
          f.db,
          f.read,
          "lin",
          stale.reply.actionCards![0].id,
          "confirm",
        ),
      /过期/,
    );
    const revoked = await f.turn(
      "请小林帮我固定晨光书架",
      undefined,
      undefined,
      "dad",
    );
    f.write(
      mutate(f.read(), "lin", "updateItem", {
        itemId: f.item.id,
        shared: false,
      }),
    );
    assert.throws(
      () =>
        decideAction(
          f.db,
          f.read,
          "dad",
          revoked.reply.actionCards![0].id,
          "confirm",
        ),
      /授权/,
    );
    assert.throws(
      () => readSession(f.db, f.read(), "dad", revoked.session.id),
      /授权/,
    );
    assert.equal(f.read().tasks.length, start + 1);
  } finally {
    f.db.close();
  }
});
test("活动准备接回原计划实体；演示物品排除；临时对话不留下行动建议", async () => {
  const f = fixture();
  try {
    installHouseholdCases(f.db);
    const start = f.read().plans?.length || 0;
    const r = await f.turn("帮我准备周末野餐");
    const c = r.reply.actionCards![0];
    assert.equal(f.read().plans?.length || 0, start);
    decideAction(f.db, f.read, "lin", c.id, "confirm");
    assert.equal(f.read().plans!.length, start + 1);
    assert.ok(
      f
        .read()
        .plans!.at(-1)!
        .itemIds.every((id) => !f.read().items.find((i) => i.id === id)!.demo),
    );
    const count = (
      f.db.prepare("SELECT COUNT(*) AS n FROM home_proposals").get() as any
    ).n;
    const temp = await f.turn(
      "帮我准备周末野餐",
      undefined,
      undefined,
      "lin",
      undefined,
      true,
    );
    assert.equal(temp.reply.actionCards, undefined);
    assert.equal(
      (f.db.prepare("SELECT COUNT(*) AS n FROM home_proposals").get() as any).n,
      count,
    );
  } finally {
    f.db.close();
  }
});
test("同一物品对话可从故事到回忆再到帮助，故事与兴趣有来源，假设不写真实经历", async () => {
  const f = fixture();
  try {
    const q = "毕业那天妈妈送我这件物品，我喜欢阅读";
    const first = await f.turn(q, undefined, f.item.id);
    assert.equal(first.reply.route!.intent, "story");
    assert.equal(first.reply.source, "local-memory");
    assert.ok(
      f.read().memories.some((m) => m.itemId === f.item.id && m.text === q),
    );
    const recalled = await f.turn("聊聊以前的故事", first, f.item.id);
    assert.match(recalled.reply.answer, /毕业那天妈妈/);
    const storyCount = f.read().memories.length;
    const requested = await f.turn("我想听以前的故事", recalled, f.item.id);
    assert.equal(f.read().memories.length, storyCount);
    assert.match(requested.reply.answer, /毕业那天妈妈/);
    const help = await f.turn("书架怎么固定", requested, f.item.id);
    assert.equal(help.session.id, first.session.id);
    assert.equal(help.reply.route!.intent, "help");
    const before = f.read().memories.length;
    await f.turn("假设我和书架去过月球，编一个故事", undefined, f.item.id);
    assert.equal(f.read().memories.length, before);
  } finally {
    f.db.close();
  }
});
test("统一陪伴实际调用 Provider，未授权私人故事与另一物品记忆不进入云端", async () => {
  const f = fixture();
  try {
    const other = f.add("安静边桌");
    saveMemory(f.db, f.read, "lin", {
      kind: "story",
      text: "不能上云的私人秘密",
      itemId: f.item.id,
    });
    saveMemory(f.db, f.read, "lin", {
      kind: "story",
      text: "另一件物品的故事",
      itemId: other.id,
      allowCloud: true,
    });
    let payload = "";
    const provider: Provider = {
      model: "offline-protocol-double",
      async generate(_, input) {
        payload = JSON.stringify(input);
        return {
          text: JSON.stringify({
            kind: "general",
            answer: "我们慢慢聊。今天有什么想说的？",
          }),
          model: "offline-protocol-double",
          tokens: { input: 20, output: 15 },
        };
      },
    };
    const r = await f.turn(
      "我今天很累，陪我聊聊",
      undefined,
      f.item.id,
      "lin",
      provider,
    );
    assert.equal(r.modelCalls, 1);
    assert.equal(r.reply.source, "model-general");
    assert.equal(r.reply.route!.intent, "companion");
    assert.ok(!payload.includes("不能上云"));
    assert.ok(!payload.includes("另一件物品"));
  } finally {
    f.db.close();
  }
});
test("演示角色对话保持案例记忆隔离，全屋不载入案例故事", async () => {
  const f = fixture();
  try {
    installHouseholdCases(f.db);
    const demo = f.read().items.find((i) => i.demo)!;
    const global = await f.turn(demo.name + "的故事");
    assert.equal(global.reply.route!.intent, "clarify");
    assert.ok(!global.reply.answer.includes("泡了茶"));
    const r = await f.turn(
      "毕业时妈妈送我这件物品，我喜欢阅读",
      undefined,
      demo.id,
    );
    const records = listMemories(f.db, f.read(), "lin").filter(
      (m) => m.itemId === demo.id && m.text.includes("毕业时"),
    );
    assert.ok(records.length);
    assert.ok(records.every((m) => m.demo && !m.allowCloud));
    assert.equal(r.reply.route!.intent, "story");
    await f.turn(demo.name + "毕业时妈妈送我的，我喜欢园艺");
    reconcileMemories(f.db, f.read(), "lin");
    assert.ok(
      !listMemories(f.db, f.read(), "lin").some(
        (m) => !m.demo && m.text.includes("园艺"),
      ),
    );
  } finally {
    f.db.close();
  }
});
test("全屋切换目标时清除尝试与设备条件，另一件物品的私人反馈不上云", async () => {
  const f = fixture();
  try {
    const mouse = f.add("晨光鼠标");
    const other = f.add("安静边桌");
    const first = await f.turn("晨光鼠标在 Windows 11 上双击速度怎么调整");
    assert.ok(first.reply.steps.length);
    const session = recordSessionFeedback(f.db, f.read, "lin", {
      sessionId: first.session.id,
      requestId: crypto.randomUUID(),
      outcome: "unresolved",
      stepId: first.reply.steps[0].id,
      reason: "关于鼠标的私人原因甲乙丙",
    });
    let sent: any;
    const provider: Provider = {
      model: "offline-protocol-double",
      async generate(_, input) {
        sent = input;
        return {
          text: JSON.stringify({
            kind: "general",
            answer: "你好，今天想聊些什么？",
          }),
          model: "offline-protocol-double",
          tokens: null,
        };
      },
    };
    const second = await f.turn(
      "安静边桌你好",
      { ...first, session },
      undefined,
      "lin",
      provider,
    );
    assert.equal(second.reply.route!.itemId, other.id);
    assert.deepEqual(second.session.tried, []);
    assert.equal(second.session.known.os, undefined);
    assert.ok(!JSON.stringify(sent).includes("私人原因甲乙丙"));
    assert.notEqual(mouse.id, other.id);
  } finally {
    f.db.close();
  }
});
test("统一对话继续原生工具循环，模型期间撤销物品授权会阻断返回", async () => {
  const f = fixture();
  try {
    let calls = 0;
    const protocol: Provider = {
      model: "offline-protocol-double",
      async generate() {
        throw Error("Use native tools");
      },
      async complete(messages, tools) {
        calls++;
        assert.ok(
          tools.some((t) => t.function.name === "list_accessible_items"),
        );
        return calls === 1
          ? {
              text: "",
              model: "offline-protocol-double",
              tokens: null,
              finishReason: "tool_calls",
              toolCalls: [
                {
                  id: "lookup",
                  type: "function",
                  function: { name: "list_accessible_items", arguments: "{}" },
                },
              ],
            }
          : {
              text: JSON.stringify({
                kind: "general",
                answer: "先留出一块常用桌面，再把暂时不用的东西归位。",
              }),
              model: "offline-protocol-double",
              tokens: null,
              finishReason: "stop",
              toolCalls: [],
            };
      },
    };
    const companion = await f.turn(
      "想听听桌面整理的灵感",
      undefined,
      undefined,
      "lin",
      protocol,
    );
    assert.equal(companion.modelCalls, 2);
    assert.ok(companion.trace.some((t) => t.stage === "tool_completed"));
    const revoke: Provider = {
      model: "offline-protocol-double",
      async generate() {
        f.write(
          mutate(f.read(), "lin", "updateItem", {
            itemId: f.item.id,
            shared: false,
          }),
        );
        return {
          text: JSON.stringify({ kind: "general", answer: "你好" }),
          model: "offline-protocol-double",
          tokens: null,
        };
      },
    };
    await assert.rejects(
      () => f.turn("晨光书架你好", undefined, undefined, "dad", revoke),
      /授权|改变/,
    );
  } finally {
    f.db.close();
  }
});
