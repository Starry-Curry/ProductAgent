import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Person, State } from "../domain.ts";
import { AgentError, type MemoryRecord } from "../agent/contracts.ts";
import { listMemories, clearOwnerContext } from "./store.ts";
import { safeForMemory, captureEvent } from "./ambient.ts";
export function introductionStatus(
  db: DatabaseSync,
  state: State,
  actor: Person,
) {
  const row = db
    .prepare("SELECT status FROM memory_introductions WHERE owner=?")
    .get(actor) as { status: string } | undefined;
  return {
    available:
      !row &&
      !listMemories(db, state, actor).some(
        (m) =>
          !m.demo &&
          [
            "interest",
            "preference",
            "experience",
            "story",
            "relationship",
          ].includes(m.kind),
      ),
    status: row?.status || "not_started",
  };
}
export function completeIntroduction(
  db: DatabaseSync,
  state: State,
  actor: Person,
  input: { requestId: string; text?: string; skip?: boolean },
) {
  const text = (input.text || "").trim();
  if (!input.skip && (!text || text.length > 1000 || !safeForMemory(text)))
    throw new AgentError(
      "请用一段简短背景介绍，不要填写密码、密钥或联系方式。",
    );
  const hash = createHash("sha256")
    .update(JSON.stringify({ text, skip: !!input.skip }))
    .digest("hex");
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db
      .prepare("SELECT request_id,hash FROM memory_introductions WHERE owner=?")
      .get(actor) as { request_id: string; hash: string } | undefined;
    if (existing) {
      if (existing.request_id === input.requestId && existing.hash === hash) {
        db.exec("COMMIT");
        return introductionStatus(db, state, actor);
      }
      throw new AgentError(
        "首次介绍已结束。之后请通过物品对话更新理解，或纠正已有记忆。",
        409,
      );
    }
    if (!introductionStatus(db, state, actor).available)
      throw new AgentError("已有记忆，无需重复介绍。请继续与物品对话。", 409);
    const at = new Date().toISOString();
    let id: string | null = null;
    if (!input.skip) {
      id = randomUUID();
      const memory: MemoryRecord = {
        id,
        owner: actor,
        kind: "experience",
        text,
        allowCloud: false,
        status: "active",
        source: "user",
        version: 1,
        createdAt: at,
        updatedAt: at,
        provenance: {
          kind: "chat",
          sourceId: "introduction:" + input.requestId,
          basis: "user_statement",
          at,
          extractor: "introduction-v1",
        },
      };
      db.prepare("INSERT INTO personal_memories VALUES(?,?,?,?,?,?)").run(
        id,
        actor,
        null,
        JSON.stringify(memory),
        "active",
        1,
      );
      db.prepare("INSERT INTO memory_events VALUES(?,?,?,?,?)").run(
        randomUUID(),
        id,
        actor,
        "initial_introduction",
        at,
      );
      captureEvent(db, state, actor, {
        id: "introduction:" + input.requestId,
        kind: "chat",
        text,
        at,
        basis: "user_statement",
      });
      clearOwnerContext(db, actor, false);
    }
    db.prepare("INSERT INTO memory_introductions VALUES(?,?,?,?,?,?)").run(
      actor,
      input.skip ? "skipped" : "saved",
      input.requestId,
      hash,
      id,
      at,
    );
    db.exec("COMMIT");
    return introductionStatus(db, state, actor);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
