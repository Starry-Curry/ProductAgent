import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { seed, mutate, type State } from "../src/lib/domain.ts";
import { migrate } from "../src/lib/migrations.ts";
import {
  captureEvent,
  captureSettings,
  captureWorkspace,
  extractChat,
  reconcileMemories,
  setCaptureEnabled,
} from "../src/lib/memory/ambient.ts";
import {
  listMemories,
  recallMemories,
  forgetMemory,
  saveMemory,
} from "../src/lib/memory/store.ts";
import { respond } from "../src/lib/agent/service.ts";
import {
  recordSessionFeedback,
  closeSession,
} from "../src/lib/repositories/sessions.ts";
import type { Provider } from "../src/lib/ai/provider.ts";
import type { ServiceSession } from "../src/lib/agent/contracts.ts";
function fixture() {
  const filename = path.join(
    mkdtempSync(path.join(tmpdir(), "wujian-ambient-")),
    "isolated.sqlite",
  );
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE workspace(id INTEGER PRIMARY KEY,body TEXT NOT NULL)",
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
  const memories = () => listMemories(db, read(), "lin");
  const event = (
    id: string,
    text: string,
    extra: Record<string, unknown> = {},
  ) =>
    captureEvent(db, read(), "lin", {
      id,
      text,
      kind: "chat",
      at: new Date().toISOString(),
      basis: "user_statement",
      ...extra,
    });
  const change = (action: string, input: Record<string, unknown>) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const state = mutate(read(), "lin", action, input);
      db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
        JSON.stringify(state),
      );
      captureWorkspace(db, state, "lin", new Date().toISOString());
      db.exec("COMMIT");
      return state;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const provider: Provider = {
    model: "offline-no-model",
    async generate() {
      throw Error("unexpected model call");
    },
  };
  const turn = (
    question: string,
    session?: ServiceSession,
    mode: "story" | "service" | "ideas" = "story",
    itemId: string | undefined = "frame",
    temporary = false,
  ) =>
    respond(
      db,
      read,
      "lin",
      {
        question,
        mode,
        itemId,
        temporary,
        sessionId: session?.id,
        requestId: crypto.randomUUID(),
      },
      provider,
    );
  return { db, filename, read, memories, event, change, turn };
}
test("静默规则区分本人的兴趣、购买陈述与临时要求，拒绝引用/假设/他人/敏感凭证", () => {
  assert.equal(extractChat("我喜欢手工和拼豆").length, 2);
  assert.equal(extractChat("我昨天买了一个杯子")[0].kind, "purchase");
  assert.equal(extractChat("今天不想手工", "s")[0].kind, "requirement");
  assert.equal(extractChat("今天不想手工").length, 0);
  for (const text of [
    "爸爸喜欢手工",
    "我爸爸喜欢手工",
    "如果我喜欢手工怎么办",
    "例如：我喜欢手工",
    "我喜欢手工吗？",
    "别记，我喜欢手工",
    "我喜欢手工，API Key 是 synthetic-sensitive-string",
  ])
    assert.deepEqual(extractChat(text), [], text);
});
test("相同来源与同一兴趣去重，新的否定陈述替换旧兴趣，不从购买推断喜欢", () => {
  const f = fixture();
  try {
    const first = f.event("one", "我喜欢手工")[0];
    f.event("one", "我喜欢手工");
    f.event("two", "我喜欢手工");
    assert.equal(f.memories().length, 1);
    assert.equal(f.memories()[0].version, 1);
    f.event("three", "我不再喜欢手工了");
    assert.equal(f.memories()[0].id, first.id);
    assert.equal(f.memories()[0].polarity, "negative");
    f.event("delayed-older-source", "我喜欢手工", {
      at: new Date(Date.now() - 60000).toISOString(),
    });
    assert.equal(
      f.memories()[0].polarity,
      "negative",
      "延迟旧来源不能覆盖较新的否定陈述",
    );
    f.event("purchase", "我买了一个相框");
    assert.equal(f.memories().filter((m) => m.kind === "interest").length, 1);
    assert.equal(
      f.memories().find((m) => m.kind === "purchase")?.allowCloud,
      false,
    );
  } finally {
    f.db.close();
  }
});
test("领域写入同时整理新持有、本人故事与尝试；演示物品和别人的故事不会变成本人画像", () => {
  const f = fixture();
  try {
    captureWorkspace(f.db, f.read(), "lin");
    assert.equal(f.memories().length, 0);
    const state = f.change("createItem", {
      name: "毕业相框",
      note: "我喜欢手工",
    });
    const item = state.items.at(-1)!;
    assert.ok(
      f.memories().some((m) => m.kind === "possession" && m.itemId === item.id),
    );
    assert.ok(f.memories().some((m) => m.kind === "interest" && !m.itemId));
    f.change("memory", { itemId: item.id, text: "毕业当天妈妈送了这个相框" });
    const story = f.memories().find((m) => m.kind === "story")!;
    assert.equal(story.provenance?.kind, "story");
    assert.deepEqual(listMemories(f.db, f.read(), "dad"), []);
    const other = f.read();
    other.memories.push({
      id: "foreign",
      itemId: "lamp",
      author: "dad",
      text: "别人的故事",
      at: new Date().toISOString(),
      shared: true,
    });
    captureWorkspace(f.db, other, "lin");
    assert.ok(!f.memories().some((m) => m.text === "别人的故事"));
  } finally {
    f.db.close();
  }
});
test("物品故事对话真实写入原故事、静默提取并可本地回忆；保持 item 范围与原作者", async () => {
  const f = fixture();
  try {
    const result = await f.turn("毕业那天妈妈送我这个相框，我喜欢手工");
    assert.equal(result.modelCalls, 0);
    assert.ok(
      f
        .read()
        .memories.some(
          (m) => m.sourceSessionId === result.session.id && m.author === "lin",
        ),
    );
    assert.ok(
      f
        .memories()
        .some(
          (m) =>
            m.kind === "story" && m.provenance?.sessionId === result.session.id,
        ),
    );
    const recalled = await f.turn("聊聊以前的故事", result.session);
    assert.match(recalled.reply.answer, /毕业那天妈妈/);
    assert.ok(
      !recallMemories(
        f.db,
        f.read(),
        "lin",
        "聊聊以前的故事",
        "story",
        "lamp",
      ).some((m) => m.kind === "story"),
    );
    const before = f.read().memories.length;
    await f.turn("今天的一段临时经历", undefined, "story", "frame", true);
    assert.equal(f.read().memories.length, before);
  } finally {
    f.db.close();
  }
});
test("忘记和纠正之后旧聊天、原故事再扫描也不复活；手工覆盖不会被被动抽取冲掉", async () => {
  const f = fixture();
  try {
    const result = await f.turn("我喜欢手工");
    const interest = f.memories().find((m) => m.kind === "interest")!;
    saveMemory(
      f.db,
      f.read,
      "lin",
      { kind: "interest", text: "我更喜欢园艺", allowCloud: false },
      interest.id,
    );
    reconcileMemories(f.db, f.read(), "lin");
    f.event("fresh-interest", "我喜欢手工");
    assert.equal(
      f.memories().find((m) => m.id === interest.id)?.text,
      "我更喜欢园艺",
    );
    for (const m of f.memories()) forgetMemory(f.db, "lin", m.id);
    reconcileMemories(f.db, f.read(), "lin");
    assert.equal(f.memories().length, 0);
    assert.ok(
      f.read().memories.some((m) => m.sourceSessionId === result.session.id),
      "原故事保留，派生记忆删除不是删除原作品",
    );
  } finally {
    f.db.close();
  }
});
test("暂停期间不提取，恢复不补采暂停聊天；设置按人隔离且跨重开持久化", async () => {
  const f = fixture();
  try {
    setCaptureEnabled(f.db, "lin", false);
    assert.equal(captureSettings(f.db, "dad").enabled, true);
    const result = await f.turn("我喜欢园艺");
    assert.equal(f.memories().length, 0);
    setCaptureEnabled(f.db, "lin", true);
    reconcileMemories(f.db, f.read(), "lin");
    assert.equal(f.memories().length, 0);
    await f.turn("我喜欢摄影", result.session);
    assert.ok(f.memories().some((m) => m.text === "我喜欢摄影"));
    const second = new DatabaseSync(f.filename);
    assert.equal(captureSettings(second, "lin").enabled, true);
    second.close();
  } finally {
    f.db.close();
  }
});
test("要求仅召回到来源会话；临时不想做手工不覆盖长期喜欢", () => {
  const f = fixture();
  try {
    f.event("interest", "我喜欢手工");
    f.event("requirement", "今天不想手工", { sessionId: "session-a" });
    assert.ok(
      f.memories().some((m) => m.kind === "requirement" && m.expiresAt),
    );
    assert.ok(
      recallMemories(
        f.db,
        f.read(),
        "lin",
        "今天",
        "ideas",
        undefined,
        "session-a",
      ).some((m) => m.kind === "requirement"),
    );
    assert.ok(
      !recallMemories(
        f.db,
        f.read(),
        "lin",
        "今天",
        "ideas",
        undefined,
        "session-b",
      ).some((m) => m.kind === "requirement"),
    );
    assert.equal(
      f.memories().find((m) => m.kind === "interest")?.polarity,
      "positive",
    );
  } finally {
    f.db.close();
  }
});
test("完成反馈自动留存本轮方法，重复反馈幂等，后续未解决撤回方法并提供继续入口", async () => {
  const f = fixture();
  try {
    const result = await f.turn(
      "Windows 11 双击速度怎么调",
      undefined,
      "service",
      undefined,
    );
    assert.equal(result.reply.steps.length, 3);
    const requestId = crypto.randomUUID();
    const done = recordSessionFeedback(f.db, f.read, "lin", {
      sessionId: result.session.id,
      requestId,
      outcome: "completed",
    });
    recordSessionFeedback(f.db, f.read, "lin", {
      sessionId: result.session.id,
      requestId,
      outcome: "completed",
    });
    const method = f.memories().find((m) => m.kind === "method")!;
    assert.match(method.text, /用户报告/);
    assert.equal(method.allowCloud, false);
    const unresolved = recordSessionFeedback(f.db, f.read, "lin", {
      sessionId: done.id,
      requestId: crypto.randomUUID(),
      outcome: "unresolved",
      reason: "入口找到了，但没有效果",
    });
    assert.equal(unresolved.known.lastOutcome, "unresolved");
    assert.ok(!f.memories().some((m) => m.kind === "method"));
    const next = await f.turn(
      "还是没有解决，请继续",
      unresolved,
      "service",
      undefined,
    );
    assert.equal(next.reply.outcome, "needs_info");
    assert.match(next.reply.answer, /没有效果/);
  } finally {
    f.db.close();
  }
});
test("忘记故事对话同时清除派生记忆，原故事重扫不能复活", async () => {
  const f = fixture();
  try {
    const result = await f.turn("毕业那天妈妈把相框送给我");
    assert.ok(f.memories().length);
    closeSession(f.db, f.read(), "lin", result.session.id);
    reconcileMemories(f.db, f.read(), "lin");
    assert.equal(f.memories().length, 0);
  } finally {
    f.db.close();
  }
});
test("提取回执和记忆与业务事务一起回滚，失败不留下半条记录", () => {
  const f = fixture();
  try {
    f.db.exec("BEGIN IMMEDIATE");
    f.event("rolled-back", "我喜欢摄影");
    f.db.exec("ROLLBACK");
    assert.equal(f.memories().length, 0);
    assert.equal(f.event("rolled-back", "我喜欢摄影").length, 1);
  } finally {
    f.db.close();
  }
});
test("v3 到 v4 保留备份和旧正文，重复升级不重复建表，未来版本拒绝写入", () => {
  const f = fixture();
  try {
    assert.ok(existsSync(f.filename + ".before-v3-to-v4.sqlite"));
    const backup = new DatabaseSync(f.filename + ".before-v3-to-v4.sqlite", {
      readOnly: true,
    });
    assert.equal(
      (
        backup
          .prepare("SELECT MAX(version) AS v FROM schema_migrations")
          .get() as { v: number }
      ).v,
      3,
    );
    assert.equal(
      (backup.prepare("SELECT body FROM workspace").get() as { body: string })
        .body,
      JSON.stringify(seed()),
    );
    backup.close();
    migrate(f.db, f.filename);
    assert.equal(
      (
        f.db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as {
          n: number;
        }
      ).n,
      5,
    );
    f.db
      .prepare("INSERT INTO schema_migrations VALUES (6,?)")
      .run(new Date().toISOString());
    assert.throws(() => migrate(f.db, f.filename), /数据库版本/);
  } finally {
    f.db.close();
  }
});
