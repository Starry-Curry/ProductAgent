import {
  captureTurn,
  captureFeedback,
  captureWorkspace,
  isStoryNarration,
} from "../memory/ambient.ts";
import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { canRead, type State, type Person } from "../domain.ts";
import { identity } from "../ai/harness.ts";
import { epoch, clearOwnerContext } from "../memory/store.ts";
import {
  AgentError,
  type ServiceSession,
  type TurnInput,
  type TurnResult,
} from "../agent/contracts.ts";
export function sessionAccess(s: ServiceSession, state: State, actor: Person) {
  if (
    s.owner !== actor ||
    Date.parse(s.expiresAt) <= Date.now() ||
    s.status === "closed"
  )
    return false;
  if (!s.itemId) return true;
  const item = state.items.find((i) => i.id === s.itemId);
  return (
    !!item &&
    canRead(item, actor) &&
    s.identity === JSON.stringify([item.owner, identity(item)])
  );
}
export function readSession(
  db: DatabaseSync,
  state: State,
  actor: Person,
  id: string,
) {
  const row = db
    .prepare("SELECT body FROM agent_sessions WHERE id=?")
    .get(id) as { body: string } | undefined;
  const s = row && (JSON.parse(row.body) as ServiceSession | undefined);
  if (!s || !sessionAccess(s, state, actor))
    throw new AgentError("会话不存在、已过期或物品授权已改变", 403);
  return s;
}
export function listSessions(
  db: DatabaseSync,
  state: State,
  actor: Person,
  itemId?: string,
  mode?: string,
) {
  const rows = db
    .prepare(
      "SELECT body FROM agent_sessions WHERE owner=? AND coalesce(item_id,'')=? ORDER BY json_extract(body,'$.updatedAt') DESC LIMIT 25",
    )
    .all(actor, itemId || "") as { body: string }[];
  return rows
    .map((r) => JSON.parse(r.body) as ServiceSession)
    .filter(
      (s) => sessionAccess(s, state, actor) && (!mode || s.mode === mode),
    );
}
export function beginTurn(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  input: TurnInput,
) {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        sessionId: input.sessionId,
        itemId: input.itemId,
        mode: input.mode,
        question: input.question,
        temporary: input.temporary,
      }),
    )
    .digest("hex");
  db.exec("BEGIN IMMEDIATE");
  try {
    const previous = db
      .prepare("SELECT * FROM agent_requests WHERE owner=? AND request_id=?")
      .get(actor, input.requestId) as
      | { request_hash: string; session_id: string; result: string | null }
      | undefined;
    if (previous) {
      if (previous.request_hash !== hash)
        throw new AgentError("重复请求的内容不一致", 409);
      const current = readSession(db, read(), actor, previous.session_id);
      const cached =
        previous.result && (JSON.parse(previous.result) as TurnResult | null);
      if (!cached || cached.session.memoryEpoch !== epoch(db, actor))
        throw new AgentError("请求正在处理或上下文已更新，请刷新后重试", 409);
      db.exec("COMMIT");
      return { session: current, cached: { ...cached, session: current } };
    }
    let session: ServiceSession;
    if (input.sessionId) {
      session = readSession(db, read(), actor, input.sessionId);
      if (
        (session.itemId || "") !== (input.itemId || "") ||
        session.mode !== input.mode
      )
        throw new AgentError("会话类型或物品不一致", 409);
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== session.revision
      )
        throw new AgentError("会话已更新，请刷新后继续", 409);
      const lease = db
        .prepare("SELECT lease_until FROM agent_sessions WHERE id=?")
        .get(session.id) as { lease_until: number };
      if (lease.lease_until > Date.now())
        throw new AgentError("这次问题正在处理，请稍候", 409);
    } else {
      const item = input.itemId
        ? read().items.find((i) => i.id === input.itemId && canRead(i, actor))
        : undefined;
      if (input.itemId && !item)
        throw new AgentError("物品不存在或未获授权", 403);
      const at = new Date().toISOString();
      session = {
        id: crypto.randomUUID(),
        owner: actor,
        itemId: item?.id,
        identity: item
          ? JSON.stringify([item.owner, identity(item)])
          : undefined,
        mode: input.mode,
        revision: 0,
        status: "active",
        messages: [],
        known: {},
        tried: [],
        memoryEpoch: epoch(db, actor),
        createdAt: at,
        updatedAt: at,
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      };
      db.prepare("INSERT INTO agent_sessions VALUES (?,?,?,?,?,?,?)").run(
        session.id,
        actor,
        item?.id || null,
        0,
        JSON.stringify(session),
        0,
        session.expiresAt,
      );
    }
    session.memoryEpoch = epoch(db, actor);
    db.prepare("UPDATE agent_sessions SET lease_until=? WHERE id=?").run(
      Date.now() + 90000,
      session.id,
    );
    db.prepare("INSERT INTO agent_requests VALUES (?,?,?,?,NULL)").run(
      actor,
      input.requestId,
      hash,
      session.id,
    );
    db.exec("COMMIT");
    return { session, cached: undefined };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function commitTurn(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  input: TurnInput,
  result: TurnResult,
) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = readSession(db, read(), actor, result.session.id);
    if (
      current.revision !== result.session.revision ||
      epoch(db, actor) !== result.session.memoryEpoch
    )
      throw new AgentError("资料或记忆授权刚刚发生变化，请重新提问", 409);
    result.session.updatedAt = new Date().toISOString();
    if (
      input.mode === "story" &&
      result.session.itemId &&
      isStoryNarration(input.question)
    ) {
      const state = read();
      state.memories.push({
        id: input.requestId,
        itemId: result.session.itemId,
        author: actor,
        text: input.question,
        at: result.session.updatedAt,
        shared: false,
        sourceSessionId: result.session.id,
      });
      db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
        JSON.stringify(state),
      );
      captureWorkspace(db, state, actor);
    }
    captureTurn(
      db,
      read(),
      actor,
      result.session,
      input.requestId,
      input.question,
    );
    result.session.revision++;
    result.session.updatedAt = new Date().toISOString();
    db.prepare(
      "UPDATE agent_sessions SET body=?,revision=?,lease_until=0 WHERE id=?",
    ).run(
      JSON.stringify(result.session),
      result.session.revision,
      result.session.id,
    );
    db.prepare(
      "UPDATE agent_requests SET result=? WHERE owner=? AND request_id=?",
    ).run(JSON.stringify(result), actor, input.requestId);
    const thread = actor + ":" + result.session.id;
    db.prepare(
      "DELETE FROM graph_checkpoints WHERE thread_id=? AND id NOT IN (SELECT id FROM graph_checkpoints WHERE thread_id=? ORDER BY id DESC LIMIT 3)",
    ).run(thread, thread);
    db.prepare(
      "DELETE FROM graph_writes WHERE thread_id=? AND checkpoint_id NOT IN (SELECT id FROM graph_checkpoints WHERE thread_id=?)",
    ).run(thread, thread);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function releaseTurn(
  db: DatabaseSync,
  actor: Person,
  input: TurnInput,
  sessionId: string,
) {
  db.prepare(
    "UPDATE agent_sessions SET lease_until=0 WHERE id=? AND owner=?",
  ).run(sessionId, actor);
  db.prepare(
    "DELETE FROM agent_requests WHERE owner=? AND request_id=? AND result IS NULL",
  ).run(actor, input.requestId);
}
export function recordSessionFeedback(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  input: {
    sessionId: string;
    requestId: string;
    outcome: string;
    reason?: string;
    stepId?: string;
  },
) {
  if (!["completed", "unresolved", "tried"].includes(input.outcome))
    throw new AgentError("反馈状态无效");
  db.exec("BEGIN IMMEDIATE");
  try {
    const session = readSession(db, read(), actor, input.sessionId);
    const lease = db
      .prepare("SELECT lease_until FROM agent_sessions WHERE id=?")
      .get(session.id) as { lease_until: number };
    if (lease.lease_until > Date.now())
      throw new AgentError("请等本次回答完成后再记录结果", 409);
    const previous = db
      .prepare("SELECT body FROM agent_feedback WHERE owner=? AND request_id=?")
      .get(actor, input.requestId) as { body: string } | undefined;
    const body = {
      outcome: input.outcome,
      reason: (input.reason || "").slice(0, 500),
      stepId: input.stepId || null,
    };
    if (previous) {
      if (previous.body !== JSON.stringify(body))
        throw new AgentError("重复请求内容不一致", 409);
      db.exec("COMMIT");
      return session;
    }
    const at = new Date().toISOString();
    db.prepare("INSERT INTO agent_feedback VALUES (?,?,?,?,?)").run(
      crypto.randomUUID(),
      session.id,
      actor,
      input.requestId,
      JSON.stringify(body),
    );
    if (input.outcome === "completed")
      session.expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    session.known.lastOutcome = input.outcome;
    if (input.outcome === "unresolved")
      session.known.unresolvedReason = body.reason;
    session.status =
      input.outcome === "completed" ? "user_resolved" : "waiting_user";
    if (input.stepId && !session.tried.includes(input.stepId))
      session.tried.push(input.stepId);
    if (
      input.stepId &&
      !session.messages.some((m) =>
        m.reply?.steps.some((step) => step.id === input.stepId),
      )
    )
      throw new AgentError("该步骤不属于当前会话");
    session.messages.push({
      id: crypto.randomUUID(),
      role: "feedback",
      text:
        input.outcome === "completed"
          ? "我确认解决了问题。"
          : `我试过了，还需要帮助。${body.reason}`,
      at,
    });
    session.messages = session.messages.slice(-30);
    session.revision++;
    session.updatedAt = at;
    captureFeedback(db, read(), actor, session, input.outcome, body.reason);
    db.prepare(
      "UPDATE agent_sessions SET body=?,revision=?,expires_at=? WHERE id=?",
    ).run(
      JSON.stringify(session),
      session.revision,
      session.expiresAt,
      session.id,
    );
    db.exec("COMMIT");
    return session;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function closeSession(
  db: DatabaseSync,
  state: State,
  actor: Person,
  id: string,
) {
  readSession(db, state, actor, id);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM graph_writes WHERE thread_id=?").run(
      actor + ":" + id,
    );
    db.prepare("DELETE FROM graph_checkpoints WHERE thread_id=?").run(
      actor + ":" + id,
    );
    db.prepare("UPDATE agent_requests SET result=NULL WHERE session_id=?").run(
      id,
    );
    db.prepare("DELETE FROM agent_feedback WHERE session_id=?").run(id);
    const derived = db
      .prepare(
        "SELECT id,body FROM personal_memories WHERE owner=? AND status!='deleted'",
      )
      .all(actor) as { id: string; body: string }[];
    let erased = false;
    for (const row of derived)
      if (JSON.parse(row.body).provenance?.sessionId === id) {
        db.prepare(
          "UPDATE personal_memories SET body='{}',status='deleted',version=version+1 WHERE id=?",
        ).run(row.id);
        db.prepare(
          "UPDATE memory_capture_slots SET locked=1 WHERE owner=? AND memory_id=?",
        ).run(actor, row.id);
        erased = true;
      }
    if (erased) clearOwnerContext(db, actor, true);
    const s = readSession(db, state, actor, id);
    s.messages = [];
    s.known = {};
    s.tried = [];
    s.status = "closed";
    s.revision++;
    db.prepare("UPDATE agent_sessions SET body=?,revision=? WHERE id=?").run(
      JSON.stringify(s),
      s.revision,
      id,
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function attachSession(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  id: string,
  itemId: string,
  revision: number,
) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const s = readSession(db, read(), actor, id);
    if (s.revision !== revision)
      throw new AgentError("会话已更新，请先等本次回答完成", 409);
    if (s.itemId && s.itemId !== itemId)
      throw new AgentError("已关联物品的会话不能换成另一件物品", 409);
    const item = read().items.find((i) => i.id === itemId && canRead(i, actor));
    if (!item) throw new AgentError("物品不存在或没有访问权限", 403);
    const lease = db
      .prepare("SELECT lease_until FROM agent_sessions WHERE id=?")
      .get(id) as { lease_until: number };
    if (lease.lease_until > Date.now())
      throw new AgentError("请等本次回答完成后再关联物品", 409);
    s.itemId = itemId;
    s.identity = JSON.stringify([item.owner, identity(item)]);
    s.revision++;
    s.updatedAt = new Date().toISOString();
    db.prepare(
      "UPDATE agent_sessions SET item_id=?,body=?,revision=? WHERE id=?",
    ).run(itemId, JSON.stringify(s), s.revision, id);
    db.prepare("UPDATE agent_requests SET result=NULL WHERE session_id=?").run(
      id,
    );
    db.prepare("DELETE FROM graph_writes WHERE thread_id=?").run(
      actor + ":" + id,
    );
    db.prepare("DELETE FROM graph_checkpoints WHERE thread_id=?").run(
      actor + ":" + id,
    );
    db.exec("COMMIT");
    return s;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
