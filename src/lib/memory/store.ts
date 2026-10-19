import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canRead, type State, type Person } from "../domain.ts";
import { isMemoryRecallRequest } from "../skills/memory-storytelling.ts";
import {
  AgentError,
  memorySchema,
  personaSchema,
  type MemoryRecord,
  type Persona,
} from "../agent/contracts.ts";
export function epoch(db: DatabaseSync, actor: string) {
  return Number(
    (
      db
        .prepare("SELECT version FROM memory_epochs WHERE owner=?")
        .get(actor) as { version: number } | undefined
    )?.version ?? 0,
  );
}
export function clearOwnerContext(
  db: DatabaseSync,
  actor: string,
  erase: boolean,
) {
  db.prepare(
    "INSERT INTO memory_epochs VALUES (?,1) ON CONFLICT(owner) DO UPDATE SET version=version+1",
  ).run(actor);
  if (erase) {
    db.prepare("DELETE FROM agent_feedback WHERE owner=?").run(actor);
    const rows = db
      .prepare("SELECT id,body FROM agent_sessions WHERE owner=?")
      .all(actor) as { id: string; body: string }[];
    for (const row of rows) {
      const session = JSON.parse(row.body);
      session.messages = [];
      session.known = {};
      session.tried = [];
      session.revision++;
      session.memoryEpoch = epoch(db, actor);
      session.updatedAt = new Date().toISOString();
      db.prepare("UPDATE agent_sessions SET body=?,revision=? WHERE id=?").run(
        JSON.stringify(session),
        session.revision,
        row.id,
      );
    }
    db.prepare("UPDATE agent_requests SET result=NULL WHERE owner=?").run(
      actor,
    );
  }
  const prefix = actor + ":";
  db.prepare(
    "DELETE FROM graph_writes WHERE substr(thread_id,1,length(?))=?",
  ).run(prefix, prefix);
  db.prepare(
    "DELETE FROM graph_checkpoints WHERE substr(thread_id,1,length(?))=?",
  ).run(prefix, prefix);
}
/** Demo edits revoke only this case's context, preserving unrelated real sessions. */
export function clearDemoContext(
  db: DatabaseSync,
  actor: Person,
  itemId?: string,
) {
  if (!itemId) return;
  const rows = db
    .prepare("SELECT id,body FROM agent_sessions WHERE owner=? AND item_id=?")
    .all(actor, itemId) as { id: string; body: string }[];
  for (const row of rows) {
    const session = JSON.parse(row.body);
    session.messages = [];
    session.known = {};
    session.tried = [];
    session.revision++;
    session.updatedAt = new Date().toISOString();
    db.prepare("UPDATE agent_sessions SET body=?,revision=? WHERE id=?").run(
      JSON.stringify(session),
      session.revision,
      row.id,
    );
    db.prepare(
      "UPDATE agent_requests SET result=NULL WHERE owner=? AND session_id=?",
    ).run(actor, row.id);
    db.prepare("DELETE FROM graph_writes WHERE thread_id=?").run(
      actor + ":" + row.id,
    );
    db.prepare("DELETE FROM graph_checkpoints WHERE thread_id=?").run(
      actor + ":" + row.id,
    );
  }
}
function accessible(
  memory: MemoryRecord & { itemOwner?: string },
  state: State,
  actor: Person,
) {
  if (memory.owner !== actor) return false;
  if (!memory.itemId) return true;
  const item = state.items.find((i) => i.id === memory.itemId);
  // Personal authored records survive gifting. Demo cases keep their original isolation.
  if (!memory.demo) return true;
  return (
    !!item &&
    canRead(item, actor) &&
    (!memory.itemOwner || item.owner === memory.itemOwner)
  );
}
export function listMemories(db: DatabaseSync, state: State, actor: Person) {
  return (
    db
      .prepare(
        "SELECT body FROM personal_memories WHERE owner=? AND status!='deleted' ORDER BY rowid DESC LIMIT 300",
      )
      .all(actor) as { body: string }[]
  )
    .map((r) => {
      const m = JSON.parse(r.body) as MemoryRecord & { itemOwner?: string };
      const item = m.itemId
        ? state.items.find((i) => i.id === m.itemId)
        : undefined;
      return {
        ...m,
        archived:
          !!m.itemId &&
          (!item ||
            !canRead(item, actor) ||
            (!!m.itemOwner && item.owner !== m.itemOwner)),
      };
    })
    .filter(
      (m) =>
        accessible(m, state, actor) &&
        (!m.expiresAt || Date.parse(m.expiresAt) > Date.now()),
    );
}
export function saveMemory(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  input: unknown,
  id?: string,
  requestId?: string,
) {
  let value = memorySchema.parse(input);
  db.exec("BEGIN IMMEDIATE");
  try {
    const hash = createHash("sha256")
      .update(JSON.stringify({ value, id }))
      .digest("hex");
    const receipt = requestId
      ? (db
          .prepare(
            "SELECT hash,target_id FROM action_receipts WHERE owner=? AND request_id=?",
          )
          .get(actor, requestId) as
          { hash: string; target_id: string } | undefined)
      : undefined;
    if (receipt) {
      if (receipt.hash !== hash)
        throw new AgentError("重复保存的内容不同", 409);
      const row = db
        .prepare(
          "SELECT body,status FROM personal_memories WHERE id=? AND owner=?",
        )
        .get(receipt.target_id, actor) as
        { body: string; status: string } | undefined;
      if (!row || row.status === "deleted")
        throw new AgentError("此记忆已忘记", 409);
      db.exec("COMMIT");
      return JSON.parse(row.body) as MemoryRecord;
    }
    const previous = id
      ? (db
          .prepare("SELECT owner,body,status FROM personal_memories WHERE id=?")
          .get(id) as
          { owner: string; body: string; status: string } | undefined)
      : undefined;
    if (
      id &&
      (!previous || previous.owner !== actor || previous.status === "deleted")
    )
      throw new AgentError("记忆不存在或未获授权", 403);
    if (value.status === "candidate" && !value.expiresAt)
      value = {
        ...value,
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      };
    const before = previous
      ? (JSON.parse(previous.body) as MemoryRecord)
      : undefined;
    if (
      value.itemId &&
      !read().items.some((i) => i.id === value.itemId && canRead(i, actor)) &&
      before?.itemId !== value.itemId
    )
      throw new AgentError("物品不存在或没有访问权限", 403);
    if (before?.demo)
      value = { ...value, itemId: before.itemId, allowCloud: false };
    const item = value.itemId
      ? read().items.find((i) => i.id === value.itemId)
      : undefined;
    const memory = {
      ...value,
      id: id || crypto.randomUUID(),
      owner: actor,
      version: (before?.version || 0) + 1,
      source: "user" as const,
      demo: before?.demo || !!item?.demo,
      allowCloud: before?.demo || item?.demo ? false : value.allowCloud,
      provenance: before?.provenance,
      polarity:
        value.kind === "interest" && /不喜欢|不再喜欢/.test(value.text)
          ? ("negative" as const)
          : undefined,
      createdAt: before?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      itemOwner:
        before && before.itemId === value.itemId
          ? (before as MemoryRecord & { itemOwner?: string }).itemOwner ||
            item?.owner
          : item?.owner,
    };
    db.prepare(
      "INSERT INTO personal_memories VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,status=excluded.status,version=excluded.version,item_id=excluded.item_id",
    ).run(
      memory.id,
      actor,
      value.itemId || null,
      JSON.stringify(memory),
      memory.status,
      memory.version,
    );
    db.prepare("INSERT INTO memory_events VALUES (?,?,?,?,?)").run(
      crypto.randomUUID(),
      memory.id,
      actor,
      before ? "corrected" : "explicitly_saved",
      memory.updatedAt,
    );
    if (before)
      db.prepare(
        "UPDATE memory_capture_slots SET locked=1 WHERE owner=? AND memory_id=?",
      ).run(actor, before.id);
    if (memory.demo)
      clearDemoContext(db, actor, before?.itemId || memory.itemId);
    else clearOwnerContext(db, actor, !!before);
    if (requestId)
      db.prepare("INSERT INTO action_receipts VALUES (?,?,?,?)").run(
        actor,
        requestId,
        hash,
        memory.id,
      );
    db.exec("COMMIT");
    return memory;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function forgetMemory(db: DatabaseSync, actor: Person, id: string) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare("SELECT owner,body,status FROM personal_memories WHERE id=?")
      .get(id) as { owner: string; body: string; status: string } | undefined;
    if (!row || row.owner !== actor)
      throw new AgentError("记忆不存在或未获授权", 403);
    if (row.status === "deleted") {
      db.exec("COMMIT");
      return;
    }
    db.prepare(
      "UPDATE memory_capture_slots SET locked=1 WHERE owner=? AND memory_id=?",
    ).run(actor, id);
    // Erase content; the tombstone only retains identity/version for stale-reference rejection.
    db.prepare(
      "UPDATE personal_memories SET status='deleted',body='{}',version=version+1 WHERE id=?",
    ).run(id);
    db.prepare("INSERT INTO memory_events VALUES (?,?,?,?,?)").run(
      crypto.randomUUID(),
      id,
      actor,
      "forgotten",
      new Date().toISOString(),
    );
    const forgotten = JSON.parse(row.body) as MemoryRecord;
    if (forgotten.demo) clearDemoContext(db, actor, forgotten.itemId);
    else clearOwnerContext(db, actor, true);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function getPersona(
  db: DatabaseSync,
  actor: string,
  itemId?: string,
): Persona {
  const row = db
    .prepare("SELECT body FROM persona_profiles WHERE owner=? AND scope=?")
    .get(actor, itemId || "global") as { body: string } | undefined;
  if (!row) return { enabled: false, nickname: "", style: "warm", itemId };
  const saved = JSON.parse(row.body);
  return {
    enabled: saved.enabled,
    nickname: saved.nickname,
    style: saved.style,
    itemId: saved.itemId,
  };
}
export function savePersona(
  db: DatabaseSync,
  state: State,
  actor: Person,
  input: unknown,
) {
  const value = personaSchema.parse(input);
  if (
    value.itemId &&
    !state.items.some((i) => i.id === value.itemId && i.owner === actor)
  )
    throw new AgentError("仅物品所有者可设置角色", 403);
  const item = value.itemId
    ? state.items.find((i) => i.id === value.itemId)
    : undefined;
  const stored = { ...value, itemOwner: item?.owner };
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "INSERT INTO persona_profiles VALUES (?,?,?) ON CONFLICT(owner,scope) DO UPDATE SET body=excluded.body",
    ).run(actor, value.itemId || "global", JSON.stringify(stored));
    if (item?.demo) clearDemoContext(db, actor, item.id);
    else clearOwnerContext(db, actor, true);
    db.exec("COMMIT");
    return value;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function recallMemories(
  db: DatabaseSync,
  state: State,
  actor: Person,
  question: string,
  mode: string,
  itemId?: string,
  sessionId?: string,
) {
  const q = question.toLowerCase();
  const wantsStory = isMemoryRecallRequest(question);
  const pairs = new Set(q.match(/[a-z0-9]+/g) || []);
  for (let i = 0; i < q.length - 1; i++)
    if (/[\u4e00-\u9fff]{2}/.test(q.slice(i, i + 2)))
      pairs.add(q.slice(i, i + 2));
  const excludeInterests =
    /不想.{0,8}(手工|以前|过去)|换个方向|别.{0,4}推荐|不要用.*记录/.test(
      question,
    );
  return listMemories(db, state, actor)
    .filter(
      (m) =>
        (!m.itemId ||
          m.itemId === itemId ||
          (m.archived && wantsStory && !itemId)) &&
        (!m.archived || wantsStory) &&
        m.status === "active" &&
        m.kind !== "fiction" &&
        !(
          ["service", "auto"].includes(mode) &&
          !wantsStory &&
          ["story", "relationship", "experience"].includes(m.kind)
        ) &&
        (!m.demo ||
          (!!itemId &&
            m.itemId === itemId &&
            !!state.items.find((i) => i.id === itemId)?.demo)) &&
        (m.kind !== "requirement" ||
          (!!sessionId && m.provenance?.sessionId === sessionId)) &&
        !(excludeInterests && m.kind === "interest"),
    )
    .map((m) => ({
      m,
      score:
        (m.itemId && m.itemId === itemId ? 8 : 0) +
        (m.kind === "preference" ? 2 : 0) +
        (mode === "ideas" && m.kind === "interest" ? 4 : 0) +
        (mode === "companion" &&
        (m.kind === "story" || m.kind === "relationship")
          ? 4
          : 0) +
        (wantsStory && ["story", "relationship", "experience"].includes(m.kind)
          ? 8
          : 0) +
        [...pairs].filter((p) => m.text.toLowerCase().includes(p)).length,
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((r) => r.m);
}
