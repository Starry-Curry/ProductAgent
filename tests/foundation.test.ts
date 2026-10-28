import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { seed, mutate, type State } from "../src/lib/domain.ts";
import { migrate } from "../src/lib/migrations.ts";
import { respond, handoff } from "../src/lib/agent/service.ts";
import {
  saveMemory,
  forgetMemory,
  listMemories,
  recallMemories,
  savePersona,
} from "../src/lib/memory/store.ts";
import {
  readSession,
  recordSessionFeedback,
  closeSession,
  listSessions,
} from "../src/lib/repositories/sessions.ts";
import { pruneExpired } from "../src/lib/repositories/retention.ts";
import { buildContext } from "../src/lib/context/builder.ts";
import { validateModelPacket } from "../src/lib/agent/graph.ts";
import {
  createProvider,
  type Provider,
  type ModelMessage,
} from "../src/lib/ai/provider.ts";
function setup() {
  const filename = path.join(
    mkdtempSync(path.join(tmpdir(), "wujian-foundation-")),
    "test.sqlite",
  );
  let db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE workspace(id INTEGER PRIMARY KEY,body TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO workspace VALUES(1,?)").run(JSON.stringify(seed()));
  migrate(db, filename);
  const read = () =>
    JSON.parse(
      (
        db.prepare("SELECT body FROM workspace WHERE id=1").get() as {
          body: string;
        }
      ).body,
    ) as State;
  const change = (
    action: string,
    input: Record<string, unknown>,
    actor: "lin" | "dad" | "friend" = "lin",
  ) => {
    const s = mutate(read(), actor, action, input);
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(JSON.stringify(s));
    return s;
  };
  return {
    get db() {
      return db;
    },
    read,
    change,
    reopen() {
      db.close();
      db = new DatabaseSync(filename);
      db.exec("PRAGMA foreign_keys=ON");
    },
    close() {
      db.close();
    },
  };
}
const offline = createProvider({ AI_ALLOW_PAID_CALLS: "false" });
const turn = (question: string, extra: Record<string, unknown> = {}) => ({
  question,
  requestId: crypto.randomUUID(),
  ...extra,
});
const packet = (
  kind: string,
  answer: string,
  extra: Record<string, unknown> = {},
) =>
  JSON.stringify({
    kind,
    answer,
    factIds: [],
    questions: [],
    procedureId: null,
    ...extra,
  });
function model(
  answer: string,
  observe?: (messages: ModelMessage[]) => void,
): Provider {
  return {
    model: "offline-fixture",
    generate: async () => ({
      text: answer,
      model: "offline-fixture",
      tokens: null,
    }),
    complete: async (messages) => {
      observe?.(messages);
      return {
        text: answer,
        model: "offline-fixture",
        tokens: { input: 10, output: 5 },
        toolCalls: [],
        finishReason: "stop",
      };
    },
  };
}

test("真实 LangGraph interrupt 写 SQLite，重开数据库后复用系统信息并跳过已试步骤", async () => {
  const t = setup();
  try {
    const first = await respond(
      t.db,
      t.read,
      "lin",
      turn("鼠标双击速度怎么调？"),
      offline,
    );
    assert.equal(first.reply.outcome, "needs_info");
    assert.equal(first.modelCalls, 0);
    assert.ok(
      Number(
        (
          t.db.prepare("SELECT count(*) AS n FROM graph_checkpoints").get() as {
            n: number;
          }
        ).n,
      ) > 0,
    );
    const id = first.session.id;
    t.reopen();
    const next = await respond(
      t.db,
      t.read,
      "lin",
      turn("Windows 11", {
        sessionId: id,
        expectedRevision: first.session.revision,
      }),
      offline,
    );
    assert.equal(next.reply.steps.length, 3);
    assert.match(next.reply.citations[0].url, /microsoft/);
    recordSessionFeedback(t.db, t.read, "lin", {
      sessionId: id,
      requestId: crypto.randomUUID(),
      outcome: "tried",
      stepId: next.reply.steps[0].id,
    });
    const again = await respond(
      t.db,
      t.read,
      "lin",
      turn("还是不行", { sessionId: id }),
      offline,
    );
    assert.equal(again.reply.steps.length, 2);
    assert.ok(!again.reply.steps.some((s) => s.id === next.reply.steps[0].id));
  } finally {
    t.close();
  }
});
test("同一请求只追加一次，旧 revision 和并发请求不得覆盖会话", async () => {
  const t = setup();
  try {
    const input = turn("你好");
    const a = await respond(t.db, t.read, "lin", input, offline);
    const b = await respond(t.db, t.read, "lin", input, offline);
    assert.equal(a.session.id, b.session.id);
    assert.equal(b.session.messages.length, 2);
    await assert.rejects(
      respond(
        t.db,
        t.read,
        "lin",
        turn("再聊聊", { sessionId: a.session.id, expectedRevision: 0 }),
        offline,
      ),
      /已更新/,
    );
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((r) => (entered = r));
    const gate = new Promise<void>((r) => (release = r));
    const p = model(packet("general", "可以先描述你现在想完成的小事。"));
    p.complete = async () => {
      entered();
      await gate;
      return {
        text: packet("general", "可以先描述你现在想完成的小事。"),
        model: p.model,
        tokens: null,
        toolCalls: [],
        finishReason: "stop",
      };
    };
    const running = respond(
      t.db,
      t.read,
      "lin",
      turn("今天想试个新目标", { sessionId: a.session.id }),
      p,
    );
    await ready;
    await assert.rejects(
      respond(
        t.db,
        t.read,
        "lin",
        turn("同时提交", { sessionId: a.session.id }),
        offline,
      ),
      /正在处理/,
    );
    release();
    await running;
  } finally {
    t.close();
  }
});
test("明确兴趣影响候选，而当下不想做手工时不硬套旧喜好", async () => {
  const t = setup();
  try {
    saveMemory(t.db, t.read, "lin", {
      kind: "interest",
      text: "我喜欢手工和拼豆",
    });
    const a = await respond(
      t.db,
      t.read,
      "lin",
      turn("用家里的东西找点灵感", { mode: "ideas" }),
      offline,
    );
    assert.match(a.reply.answer, /装进相框/);
    assert.ok(a.reply.memoryIds.length);
    const b = await respond(
      t.db,
      t.read,
      "lin",
      turn("今天不想手工，换个方向", { mode: "ideas" }),
      offline,
    );
    assert.match(b.reply.answer, /生活照/);
    assert.equal(b.reply.memoryIds.length, 0);
  } finally {
    t.close();
  }
});
test("记忆默认不上云；候选、虚构、其他用户、其他物品与过期内容不召回", async () => {
  const t = setup();
  try {
    saveMemory(t.db, t.read, "lin", {
      kind: "interest",
      text: "秘密松果我喜欢手工",
    });
    saveMemory(t.db, t.read, "lin", {
      kind: "interest",
      text: "公开爱好手工",
      allowCloud: true,
    });
    saveMemory(t.db, t.read, "lin", {
      kind: "story",
      text: "候选秘密松果",
      status: "candidate",
    });
    saveMemory(t.db, t.read, "lin", { kind: "fiction", text: "虚构秘密松果" });
    saveMemory(t.db, t.read, "dad", { kind: "story", text: "别人的秘密松果" });
    const seen: string[] = [];
    await respond(
      t.db,
      t.read,
      "lin",
      turn("手工对我有什么意义"),
      model(packet("general", "可以先从你眼下愿意尝试的事情谈起。"), (m) =>
        seen.push(JSON.stringify(m)),
      ),
    );
    assert.ok(seen.length);
    assert.ok(seen.every((s) => !s.includes("秘密松果")));
    assert.ok(seen.some((s) => s.includes("公开爱好手工")));
    assert.equal(
      recallMemories(t.db, t.read(), "lin", "秘密松果", "companion").some(
        (m) => m.kind === "fiction" || m.status === "candidate",
      ),
      false,
    );
  } finally {
    t.close();
  }
});
test("纠正和忘记擦除旧对话、请求缓存、checkpoint；恢复不再复述", async () => {
  const t = setup();
  try {
    savePersona(t.db, t.read(), "lin", {
      enabled: true,
      nickname: "小物",
      style: "warm",
    });
    const m = saveMemory(t.db, t.read, "lin", {
      kind: "story",
      text: "青色相框是毕业那天妈妈送的",
    });
    const a = await respond(
      t.db,
      t.read,
      "lin",
      turn("聊聊以前的故事", { mode: "companion" }),
      offline,
    );
    assert.match(a.reply.answer, /毕业/);
    forgetMemory(t.db, "lin", m.id);
    assert.equal(listMemories(t.db, t.read(), "lin").length, 0);
    assert.equal(
      Number(
        (
          t.db.prepare("SELECT count(*) AS n FROM graph_checkpoints").get() as {
            n: number;
          }
        ).n,
      ),
      0,
    );
    const cleared = readSession(t.db, t.read(), "lin", a.session.id);
    assert.equal(cleared.messages.length, 0);
    const b = await respond(
      t.db,
      t.read,
      "lin",
      turn("还记得以前的故事吗", {
        mode: "companion",
        sessionId: a.session.id,
      }),
      offline,
    );
    assert.doesNotMatch(JSON.stringify(b), /毕业那天/);
  } finally {
    t.close();
  }
});
test("网络等待中撤销物品共享或删除记忆，返回值和迟到的 checkpoint 都被阻止", async () => {
  for (const cause of ["revoke", "forget"]) {
    const t = setup();
    try {
      const memory = saveMemory(t.db, t.read, "dad", {
        kind: "story",
        text: "不应再出现的故事",
      });
      let release!: () => void, entered!: () => void;
      const ready = new Promise<void>((r) => (entered = r)),
        gate = new Promise<void>((r) => (release = r));
      const p = model(packet("general", "一起先整理当前目标。"));
      p.complete = async () => {
        entered();
        await gate;
        return {
          text: packet("general", "一起先整理当前目标。"),
          model: p.model,
          tokens: null,
          toolCalls: [],
          finishReason: "stop",
        };
      };
      const running = respond(
        t.db,
        t.read,
        "dad",
        turn("想试个新目标", { itemId: "lamp" }),
        p,
      );
      await ready;
      if (cause === "revoke")
        t.change("updateItem", { itemId: "lamp", shared: false });
      else forgetMemory(t.db, "dad", memory.id);
      release();
      await assert.rejects(running, /授权|更新|改变/);
      assert.equal(
        Number(
          (
            t.db
              .prepare("SELECT count(*) AS n FROM graph_checkpoints")
              .get() as { n: number }
          ).n,
        ),
        0,
      );
    } finally {
      t.close();
    }
  }
});
test("临时提问不保存正文，不使用私人记忆，也不能通过记住指令落盘", async () => {
  const t = setup();
  try {
    saveMemory(t.db, t.read, "lin", {
      kind: "preference",
      text: "临时不应读取的私人偏好",
      allowCloud: true,
    });
    const seen: string[] = [];
    await respond(
      t.db,
      t.read,
      "lin",
      turn("TEMP_PRIVATE_041", { temporary: true }),
      model(packet("general", "我们可以先聊你当前的目标。"), (m) =>
        seen.push(JSON.stringify(m)),
      ),
    );
    assert.ok(seen.every((s) => !s.includes("私人偏好")));
    assert.equal(
      Number(
        (
          t.db.prepare("SELECT count(*) AS n FROM agent_sessions").get() as {
            n: number;
          }
        ).n,
      ),
      0,
    );
    assert.equal(
      Number(
        (
          t.db.prepare("SELECT count(*) AS n FROM graph_checkpoints").get() as {
            n: number;
          }
        ).n,
      ),
      0,
    );
    await assert.rejects(
      respond(
        t.db,
        t.read,
        "lin",
        turn("记住：不要落盘", { temporary: true }),
        offline,
      ),
      /不保存/,
    );
  } finally {
    t.close();
  }
});
test("有依据的概括选 ID 后输出来源事实，错误话题引用与无依据设备步骤被拒绝", () => {
  const t = setup();
  try {
    t.change("bindProduct", {
      itemId: "lamp",
      packId: "logitech-m185-m-r0061",
      confirmed: true,
    });
    const ctx = buildContext(t.db, t.read(), "lin", {
      question: "电池规格",
      mode: "service",
      itemId: "lamp",
    });
    const result = validateModelPacket(
      packet("supported", "我用更自然的话概括", {
        factIds: [ctx.knowledge.facts[0].id],
      }),
      ctx,
      "service",
    );
    assert.ok(result.evidenceIds.length);
    assert.doesNotMatch(result.answer, /更自然的话/);
    const irrelevant = buildContext(t.db, t.read(), "lin", {
      question: "怎么调双击速度",
      mode: "service",
      itemId: "lamp",
    });
    assert.throws(() =>
      validateModelPacket(
        packet("supported", "", { factIds: [ctx.knowledge.facts[0].id] }),
        irrelevant,
        "service",
      ),
    );
    assert.throws(() =>
      validateModelPacket(packet("general", "按住配对键 8 秒"), ctx, "service"),
    );
  } finally {
    t.close();
  }
});

test("文件选择手势不误判为设备长按，定时重置与附加危险动作仍拒绝", () => {
  const t = setup();
  try {
    const ctx = buildContext(t.db, t.read(), "lin", {
      question: "Windows 11 怎么把文件放进文件夹",
      mode: "service",
    });
    for (const answer of [
      "按住键盘上的 Ctrl 键，逐个点击要选择的文件。",
      "按住鼠标左键，把文件拖进已经建好的文件夹。",
      "请用鼠标左键点住（按住不放）你想移动的文件，然后拖动到你刚建好的文件夹上。",
      "鼠标左键按下(按住不放)，拖入文件夹。",
    ]) {
      assert.equal(
        validateModelPacket(packet("general", answer), ctx, "service").outcome,
        "answered",
      );
    }
    for (const answer of [
      "按住 Ctrl 键 8 秒即可重置设备。",
      "按住鼠标左键拖动文件。然后长按电源键 8 秒。",
      "按住 Ctrl 键，短接电池触点。",
      "按住配对键即可连接。",
    ])
      assert.throws(() =>
        validateModelPacket(packet("general", answer), ctx, "service"),
      );
  } finally {
    t.close();
  }
});

test("原装接收器已插入会接续其他步骤，否定答复不被当成拥有", async () => {
  const t = setup();
  try {
    t.change("bindProduct", {
      itemId: "lamp",
      packId: "logitech-m185-m-r0061",
      confirmed: true,
    });
    const first = await respond(
      t.db,
      t.read,
      "lin",
      turn("第一次怎么用", { itemId: "lamp" }),
      offline,
    );
    const second = await respond(
      t.db,
      t.read,
      "lin",
      turn("我已经把原装 USB 接收器插进电脑了，还是没反应，下一步呢？", {
        itemId: "lamp",
        sessionId: first.session.id,
      }),
      offline,
    );
    assert.equal(second.session.known.originalReceiver, "yes");
    assert.ok(second.reply.steps.length);
    assert.ok(second.reply.steps.every((s) => s.id !== "m185-receiver"));
    const other = await respond(
      t.db,
      t.read,
      "lin",
      turn("第一次怎么用", { itemId: "lamp" }),
      offline,
    );
    const missing = await respond(
      t.db,
      t.read,
      "lin",
      turn("没有原配接收器", { itemId: "lamp", sessionId: other.session.id }),
      offline,
    );
    assert.notEqual(missing.session.known.originalReceiver, "yes");
    const battery = await respond(
      t.db,
      t.read,
      "lin",
      turn("是不是插上充电线就能充电", { itemId: "lamp" }),
      offline,
    );
    assert.match(battery.reply.answer, /AA/);
    assert.match(battery.reply.answer, /先不要/);
  } finally {
    t.close();
  }
});

test("校验重试保持原始服务问题，不把内部反馈当成用户经历", async () => {
  const t = setup();
  let calls = 0;
  const provider: Provider = {
    model: "mock-repair-not-live",
    ready: true,
    generate: async () => {
      throw Error("Expected complete");
    },
    complete: async (messages) => {
      calls++;
      assert.match(messages[0].content!, /大字关怀版/);
      if (calls === 2) {
        const feedback = messages.at(-1)!;
        assert.equal(feedback.role, "system");
        assert.match(feedback.content!, /原始问题.*恢复出厂设置/);
        assert.match(feedback.content!, /保持使用帮助意图/);
        assert.doesNotMatch(feedback.content!, /上次输出/);
      }
      return {
        text: packet(
          calls === 1 ? "general" : "needs_info",
          calls === 1
            ? "按住电源键8秒。"
            : "缺少型号，不能确认重置方式。请查看底部标签。",
        ),
        model: "mock-repair-not-live",
        tokens: null,
        toolCalls: [],
        finishReason: "stop",
      };
    },
  };
  try {
    const state = t.change("createItem", {
      name: "测试旧保温壶",
      model: "SYNTHETIC-100",
    });
    const r = await respond(
      t.db,
      t.read,
      "lin",
      turn("怎么恢复出厂设置？", {
        itemId: state.items.at(-1)!.id,
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { page: "assistant", interfaceMode: "care" },
      }),
      provider,
    );
    assert.equal(calls, 2);
    assert.equal(r.reply.outcome, "needs_info");
    const reminder = await respond(
      t.db,
      t.read,
      "lin",
      turn(
        "孩子说保温壶没修好。我点了我知道了，是不是代表保温壶修好可以用了？",
        {
          mode: "auto",
          uiContext: { page: "assistant", interfaceMode: "care" },
        },
      ),
      offline,
    );
    assert.match(reminder.reply.answer, /不要使用/);
    assert.equal(reminder.modelCalls, 0);
    const reassurance = await respond(
      t.db,
      t.read,
      "lin",
      turn("我记不住这些操作，觉得自己很笨。", {
        mode: "auto",
        sessionId: reminder.session.id,
        uiContext: { page: "assistant", interfaceMode: "care" },
      }),
      offline,
    );
    assert.match(reassurance.reply.answer, /不代表你笨/);
    assert.match(reassurance.reply.answer, /先不要操作/);
    assert.doesNotMatch(reassurance.reply.answer, /按一下开关|读给你听/);
    assert.equal(reassurance.modelCalls, 0);
  } finally {
    t.close();
  }
});
test("家庭交接仅共享预览摘要、幂等创建，私人会话不向家人开放", async () => {
  const t = setup();
  try {
    const a = await respond(
      t.db,
      t.read,
      "lin",
      turn("Windows 11 双击速度怎么调整", { itemId: "lamp" }),
      offline,
    );
    const input = {
      sessionId: a.session.id,
      expectedRevision: a.session.revision,
      requestId: crypto.randomUUID(),
      summary: "请帮我找到鼠标设置",
      assignee: "dad",
    };
    const one = handoff(t.db, t.read, "lin", input),
      two = handoff(t.db, t.read, "lin", input);
    assert.equal(one.taskId, two.taskId);
    assert.equal(t.read().tasks.filter((x) => x.id === one.taskId).length, 1);
    assert.throws(() => readSession(t.db, t.read(), "dad", a.session.id));
    t.change("updateItem", { itemId: "lamp", shared: false });
    assert.throws(
      () =>
        handoff(t.db, t.read, "lin", {
          ...input,
          requestId: crypto.randomUUID(),
        }),
      /共享/,
    );
  } finally {
    t.close();
  }
});
test("记住指令及显式保存可安全重试，删除后不复活；过期会话清理", async () => {
  const t = setup();
  try {
    const input = turn("记住：我喜欢手工");
    const a = await respond(t.db, t.read, "lin", input, offline);
    await respond(t.db, t.read, "lin", input, offline);
    assert.equal(listMemories(t.db, t.read(), "lin").length, 1);
    const m = listMemories(t.db, t.read(), "lin")[0];
    forgetMemory(t.db, "lin", m.id);
    await assert.rejects(
      respond(t.db, t.read, "lin", input, offline),
      /更新|处理/,
    );
    assert.equal(listMemories(t.db, t.read(), "lin").length, 0);
    t.db
      .prepare("UPDATE agent_sessions SET expires_at=? WHERE id=?")
      .run("2000-01-01T00:00:00.000Z", a.session.id);
    pruneExpired(t.db, "lin");
    assert.equal(listSessions(t.db, t.read(), "lin").length, 0);
  } finally {
    t.close();
  }
});

test("工具循环只执行白名单读取，错误工具与坏 JSON 在限定模型回合内结束", async () => {
  for (const variant of ["tool", "json"]) {
    const t = setup();
    try {
      let count = 0;
      const p = model("bad");
      p.complete = async () => {
        count++;
        return {
          text: variant === "json" ? "invalid json" : "",
          model: p.model,
          tokens: { input: 1, output: 1 },
          toolCalls:
            variant === "tool"
              ? [
                  {
                    id: "call-" + count,
                    type: "function",
                    function: { name: "delete_all_memory", arguments: "{}" },
                  },
                ]
              : [],
          finishReason: variant === "tool" ? "tool_calls" : "stop",
        };
      };
      const a = await respond(t.db, t.read, "lin", turn("想讨论一个新目标"), p);
      assert.equal(count, variant === "tool" ? 4 : 2);
      assert.ok(
        ["unavailable", "referred", "needs_info"].includes(a.reply.outcome),
      );
      assert.ok(
        a.trace.some(
          (e) =>
            e.stage ===
            (variant === "tool" ? "tool_denied" : "validation_failed"),
        ),
      );
      assert.ok(!a.reply.steps.length);
    } finally {
      t.close();
    }
  }
});
test("不同物品的记忆不混入当前主题，原配接收器确认才能进入手册操作", async () => {
  const t = setup();
  try {
    saveMemory(t.db, t.read, "lin", {
      kind: "story",
      text: "秘密相框故事",
      itemId: "frame",
    });
    assert.equal(
      recallMemories(t.db, t.read(), "lin", "秘密相框故事", "companion", "lamp")
        .length,
      0,
    );
    t.change("bindProduct", {
      itemId: "lamp",
      packId: "logitech-m185-m-r0061",
      confirmed: true,
    });
    const a = await respond(
      t.db,
      t.read,
      "lin",
      turn("第一次怎么用", { itemId: "lamp" }),
      offline,
    );
    assert.equal(a.reply.outcome, "needs_info");
    assert.equal(a.reply.steps.length, 0);
    const b = await respond(
      t.db,
      t.read,
      "lin",
      turn("有原配接收器", { itemId: "lamp", sessionId: a.session.id }),
      offline,
    );
    assert.equal(b.reply.steps.length, 3);
    assert.match(b.reply.citations[0].url, /logitech/);
  } finally {
    t.close();
  }
});
test("百炼工具传输接受 tool_calls=null，正确传递预算与关闭思考，鉴权错误有独立代码", async () => {
  const sent: Record<string, unknown>[] = [];
  const env = {
    AI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    AI_API_KEY: "synthetic-test-not-a-real-key",
    AI_MODEL: "qwen-plus",
    AI_ALLOW_PAID_CALLS: "true",
    AI_JSON_MODE: "true",
    AI_ENABLE_THINKING: "false",
  };
  const p = createProvider(env, async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: packet("general", "可以从当前目标说起。"),
            tool_calls: null,
          },
        },
      ],
      usage: { prompt_tokens: 4, completion_tokens: 3 },
    });
  });
  const a = await p.complete!([{ role: "system", content: "JSON" }], [], {
    timeoutMs: 500,
  });
  assert.deepEqual(a.toolCalls, []);
  assert.equal(sent[0].enable_thinking, false);
  assert.deepEqual(a.tokens, { input: 4, output: 3 });
  for (const status of [401, 403, 429]) {
    const denied = createProvider(
      env,
      async () => new Response("", { status }),
    );
    await assert.rejects(
      denied.complete!([], []),
      (e: unknown) =>
        !!e &&
        typeof e === "object" &&
        "code" in e &&
        e.code ===
          (status === 401
            ? "authentication"
            : status === 403
              ? "permission"
              : "rate_limited"),
    );
  }
});
test("候选保存重试幂等；角色更改保留聊天并撤销旧检查点，本人纠正仍清除旧内容", async () => {
  const t = setup();
  try {
    const requestId = crypto.randomUUID();
    const a = saveMemory(
      t.db,
      t.read,
      "lin",
      { kind: "interest", text: "候选阅读", status: "candidate" },
      undefined,
      requestId,
    );
    const b = saveMemory(
      t.db,
      t.read,
      "lin",
      { kind: "interest", text: "候选阅读", status: "candidate" },
      undefined,
      requestId,
    );
    assert.equal(a.id, b.id);
    saveMemory(
      t.db,
      t.read,
      "lin",
      { kind: "interest", text: "我喜欢阅读", status: "active" },
      a.id,
    );
    assert.equal(listMemories(t.db, t.read(), "lin")[0].version, 2);
    await respond(t.db, t.read, "lin", turn("你好"), offline);
    savePersona(t.db, t.read(), "lin", {
      enabled: true,
      nickname: "小台灯",
      style: "playful",
      itemId: "lamp",
    });
    assert.equal(listSessions(t.db, t.read(), "lin")[0].messages.length, 2);
    assert.equal(
      (
        t.db.prepare("SELECT count(*) n FROM graph_checkpoints").get() as {
          n: number;
        }
      ).n,
      0,
    );
    saveMemory(
      t.db,
      t.read,
      "lin",
      { kind: "interest", text: "不再喜欢阅读", status: "active" },
      a.id,
    );
    assert.equal(listSessions(t.db, t.read(), "lin")[0].messages.length, 0);
  } finally {
    t.close();
  }
});

test("未建档问题关联物品后保留澄清与尝试，不能悄悄切换其他物品", async () => {
  const { attachSession } = await import("../src/lib/repositories/sessions.ts");
  const t = setup();
  try {
    const a = await respond(
      t.db,
      t.read,
      "lin",
      turn("Windows 11 双击速度怎么调"),
      offline,
    );
    const fb = recordSessionFeedback(t.db, t.read, "lin", {
      sessionId: a.session.id,
      requestId: crypto.randomUUID(),
      outcome: "tried",
      stepId: a.reply.steps[0].id,
    });
    const linked = attachSession(
      t.db,
      t.read,
      "lin",
      a.session.id,
      "lamp",
      fb.revision,
    );
    assert.equal(linked.known.os, "windows11");
    assert.equal(linked.tried.length, 1);
    assert.equal(
      listSessions(t.db, t.read(), "lin", "lamp")[0].id,
      a.session.id,
    );
    assert.throws(
      () =>
        attachSession(
          t.db,
          t.read,
          "lin",
          a.session.id,
          "frame",
          linked.revision,
        ),
      /不能换/,
    );
    const b = await respond(
      t.db,
      t.read,
      "lin",
      turn("还是不行", {
        itemId: "lamp",
        sessionId: a.session.id,
        expectedRevision: linked.revision,
      }),
      offline,
    );
    assert.equal(b.reply.steps.length, 2);
  } finally {
    t.close();
  }
});

test("自然的澄清和停止建议不因提及风险误拒，通用回答不能绕过电池事实校验", () => {
  const t = setup();
  try {
    const ctx = buildContext(t.db, t.read(), "lin", {
      question: "设备没反应",
      mode: "service",
    });
    assert.equal(
      validateModelPacket(
        packet("needs_info", "如果出现冒烟请停止使用；不要短接触点。", {
          questions: ["有没有冒烟或漏电现象？"],
        }),
        ctx,
        "service",
      ).outcome,
      "needs_info",
    );
    t.change("bindProduct", {
      itemId: "lamp",
      packId: "logitech-m185-m-r0061",
      confirmed: true,
    });
    const battery = buildContext(t.db, t.read(), "lin", {
      question: "电池是什么",
      mode: "service",
      itemId: "lamp",
    });
    assert.throws(() =>
      validateModelPacket(
        packet("general", "使用两节 AAA 电池。"),
        battery,
        "service",
      ),
    );
  } finally {
    t.close();
  }
});

test("真实协议回归：工具协商不混用 JSON mode，stop 附带 tool_calls 也能完成往返", async () => {
  const t = setup();
  try {
    t.change("bindProduct", {
      itemId: "lamp",
      packId: "logitech-m185-m-r0061",
      confirmed: true,
    });
    let requests = 0;
    const provider = createProvider(
      {
        AI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        AI_API_KEY: "synthetic-test-not-a-key",
        AI_MODEL: "qwen-plus",
        AI_ALLOW_PAID_CALLS: "true",
        AI_JSON_MODE: "true",
        AI_ENABLE_THINKING: "false",
      },
      async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        requests++;
        assert.equal(body.response_format, undefined);
        assert.ok(body.tools.length);
        if (requests === 1)
          return Response.json({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "native-call-1",
                      type: "function",
                      function: {
                        name: "search_product_knowledge",
                        arguments: JSON.stringify({ query: "电池规格" }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 4, completion_tokens: 3 },
          });
        assert.ok(
          body.messages.some(
            (m: ModelMessage) =>
              m.role === "tool" && m.tool_call_id === "native-call-1",
          ),
        );
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: packet("supported", "一节 AA 电池", {
                  factIds: ["M-R0061:battery"],
                }),
                tool_calls: null,
              },
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 3 },
        });
      },
    );
    const r = await respond(
      t.db,
      t.read,
      "lin",
      turn("如何依据资料确认电池规格", { itemId: "lamp" }),
      provider,
    );
    assert.equal(requests, 2);
    assert.equal(r.reply.outcome, "answered");
    assert.ok(r.trace.some((e) => e.stage === "tool_completed"));
    assert.deepEqual(r.reply.evidenceIds, ["M-R0061:battery"]);
  } finally {
    t.close();
  }
});

test("用户要求调整普通建议的语气可自然回答，仍禁止借改写编造设备操作", () => {
  const t = setup();
  try {
    const ctx = buildContext(t.db, t.read(), "lin", {
      question: "把“先把桌上的纸张归到一处”变成一句不催促人的行动建议。",
      mode: "service",
    });
    assert.equal(
      validateModelPacket(
        packet(
          "creative",
          "要不要先把桌上的纸张轻轻归到一起，按你舒服的节奏来。",
        ),
        ctx,
        "service",
      ).source,
      "model-general",
    );
    const technical = buildContext(t.db, t.read(), "lin", {
      question: "把配对步骤改写成一句建议",
      mode: "service",
    });
    assert.throws(() =>
      validateModelPacket(
        packet("creative", "先完成配对就行。"),
        technical,
        "service",
      ),
    );
    const other = buildContext(t.db, t.read(), "lin", {
      question: "设备怎么使用",
      mode: "service",
    });
    assert.throws(() =>
      validateModelPacket(
        packet("creative", "想象它已经开始工作。"),
        other,
        "service",
      ),
    );
  } finally {
    t.close();
  }
});
