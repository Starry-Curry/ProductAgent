import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { State, Person } from "../domain.ts";
import { AgentError, type MemoryRecord } from "../agent/contracts.ts";
import {
  saveMemory,
  forgetMemory,
  clearOwnerContext,
} from "../memory/store.ts";
import { listFragments } from "./stories.ts";

export type Chapter = {
  id: string;
  name: string;
  fragmentIds: string[];
  revision: number;
  updatedAt: string;
};
export type Understanding = {
  id: string;
  text: string;
  evidence: { id: string; fingerprint: string }[];
  basis: "explicit-statement";
  status: "candidate" | "confirmed" | "rejected" | "withdrawn";
  memoryId?: string;
  scope: string;
  updatedAt: string;
};
const hash = (s: string) =>
  createHash("sha256")
    .update(s.normalize("NFKC").replace(/\s+/g, " ").trim())
    .digest("hex");
export const eventFingerprint = (f: {
  text: string;
  capturedOn?: string | null;
  mediaIds?: string[];
}) => hash(JSON.stringify([f.text, f.capturedOn, f.mediaIds]));
function ready(db: DatabaseSync) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE name='life_understanding'")
    .get();
}
export function storyOrganization(
  db: DatabaseSync,
  state: State,
  actor: Person,
) {
  if (!ready(db))
    return { chapters: [] as Chapter[], understanding: [] as Understanding[] };
  const fragments = listFragments(db, state, actor),
    ids = new Set(fragments.map((f) => f.id));
  const chapters = (
    db
      .prepare(
        "SELECT body FROM life_chapters WHERE owner=? ORDER BY rowid DESC",
      )
      .all(actor) as { body: string }[]
  )
    .map((r) => JSON.parse(r.body) as Chapter)
    .map((c) => ({
      ...c,
      fragmentIds: c.fragmentIds.filter((id) => ids.has(id)),
    }));
  const understanding = (
    db
      .prepare(
        "SELECT body FROM life_understanding WHERE owner=? ORDER BY rowid DESC",
      )
      .all(actor) as { body: string }[]
  ).map((r) => JSON.parse(r.body) as Understanding);
  return {
    chapters,
    understanding: understanding.map((u) =>
      u.status === "confirmed" &&
      (!u.memoryId ||
        !db
          .prepare(
            "SELECT 1 FROM personal_memories WHERE id=? AND owner=? AND status='active'",
          )
          .get(u.memoryId, actor))
        ? { ...u, status: "withdrawn" as const }
        : u,
    ),
  };
}
function putUnderstanding(db: DatabaseSync, actor: Person, u: Understanding) {
  db.prepare("UPDATE life_understanding SET body=? WHERE id=? AND owner=?").run(
    JSON.stringify(u),
    u.id,
    actor,
  );
}
/** Within the caller's transaction: source edits/revocation invalidate the derived context immediately. */
export function invalidateStoryUnderstanding(
  db: DatabaseSync,
  actor: Person,
  fragmentId: string,
) {
  if (!ready(db)) return;
  for (const row of db
    .prepare("SELECT body FROM life_understanding WHERE owner=?")
    .all(actor) as { body: string }[]) {
    const u = JSON.parse(row.body) as Understanding;
    if (
      !u.evidence.some((e) => e.id === fragmentId) ||
      !["confirmed", "candidate"].includes(u.status)
    )
      continue;
    if (u.memoryId)
      db.prepare(
        "UPDATE personal_memories SET body='{}',status='deleted',version=version+1 WHERE id=? AND owner=?",
      ).run(u.memoryId, actor);
    putUnderstanding(db, actor, {
      ...u,
      status: "withdrawn",
      updatedAt: new Date().toISOString(),
    });
  }
}
export function organizeStories(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  input: unknown,
) {
  const v = z
    .object({
      command: z.enum([
        "chapter",
        "deleteChapter",
        "extract",
        "confirm",
        "reject",
        "forget",
      ]),
      id: z.string().uuid().optional(),
      revision: z.number().int().positive().optional(),
      name: z.string().trim().min(1).max(80).optional(),
      fragmentIds: z.array(z.string().uuid()).max(200).optional(),
      text: z.string().trim().min(1).max(600).optional(),
      scope: z.string().trim().min(2).max(80).optional(),
      allowCloud: z.boolean().optional(),
    })
    .strict()
    .parse(input);
  const { chapters, understanding } = storyOrganization(db, read(), actor),
    fragments = listFragments(db, read(), actor),
    at = new Date().toISOString();
  if (v.command === "chapter" || v.command === "deleteChapter") {
    const old = chapters.find((c) => c.id === v.id);
    if (v.id && !old) throw new AgentError("章节不存在或未获授权", 403);
    if (old && old.revision !== v.revision)
      throw new AgentError("章节已更新，请刷新", 409);
    if (v.command === "deleteChapter") {
      if (!old) throw new AgentError("请选择章节");
      db.prepare("DELETE FROM life_chapters WHERE id=? AND owner=?").run(
        old.id,
        actor,
      );
    } else {
      if (!v.name) throw new AgentError("请给章节起一个名字");
      const ids = [...new Set(v.fragmentIds || [])];
      if (ids.some((id) => !fragments.some((f) => f.id === id)))
        throw new AgentError("事件未获授权", 403);
      const c: Chapter = {
        id: old?.id || crypto.randomUUID(),
        name: v.name,
        fragmentIds: ids,
        revision: (old?.revision || 0) + 1,
        updatedAt: at,
      };
      db.prepare(
        "INSERT INTO life_chapters VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      ).run(c.id, actor, JSON.stringify(c));
    }
    clearOwnerContext(db, actor, true);
  } else if (v.command === "extract") {
    // Bounded explicit statements only. Repetition never upgrades an inference to fact.
    for (const f of fragments.filter(
      (f) => !f.demo && f.origin !== "fiction" && f.allowRecall,
    )) {
      for (const sentence of f.text.split(/[。！？\n]/).map((s) => s.trim())) {
        if (
          !/^(?:我(?:一直|更|比较|很|最)?(?:喜欢|偏好|希望|想要|计划)|我的目标是)/.test(
            sentence,
          ) ||
          /疾病|宗教|政治|性取向|抑郁|人格|性格/.test(sentence)
        )
          continue;
        const text = sentence.slice(0, 600),
          signature = hash(text);
        const u: Understanding = {
          id: crypto.randomUUID(),
          text,
          evidence: [{ id: f.id, fingerprint: eventFingerprint(f) }],
          basis: "explicit-statement",
          status: "candidate",
          scope: "待确认适用任务",
          updatedAt: at,
        };
        // Rejected/forgotten and duplicate evidence never resurrect the same statement.
        db.prepare(
          "INSERT OR IGNORE INTO life_understanding VALUES(?,?,?,?)",
        ).run(u.id, actor, signature, JSON.stringify(u));
      }
    }
  } else {
    const u = understanding.find((u) => u.id === v.id);
    if (!u) throw new AgentError("候选不存在或未获授权", 403);
    if (v.command === "confirm") {
      if (!["candidate", "confirmed"].includes(u.status))
        throw new AgentError("已拒绝或失效的证据不能重新确认", 409);
      if (!v.scope)
        throw new AgentError("请填写适用任务，例如旅行、摄影或创意");
      if (
        !u.evidence.every((e) =>
          fragments.some(
            (f) =>
              f.id === e.id &&
              f.allowRecall &&
              f.origin !== "fiction" &&
              eventFingerprint(f) === e.fingerprint,
          ),
        )
      )
        throw new AgentError("原事件已变化，请重新检查", 409);
      if (
        v.allowCloud &&
        !u.evidence.every((e) =>
          fragments.some((f) => f.id === e.id && f.allowCloud),
        )
      )
        throw new AgentError("需先在原事件中授权文字上云", 403);
      const m = saveMemory(
        db,
        read,
        actor,
        {
          kind: "preference",
          text: v.text || u.text,
          allowCloud: !!v.allowCloud,
          status: "active",
        },
        u.memoryId,
      );
      const withSource: MemoryRecord = {
        ...m,
        provenance: {
          kind: "story",
          sourceId: u.id,
          basis: "user_statement",
          at,
          extractor: "confirmed-story-statement-v1",
        },
      };
      db.prepare(
        "UPDATE personal_memories SET body=? WHERE id=? AND owner=?",
      ).run(JSON.stringify(withSource), m.id, actor);
      putUnderstanding(db, actor, {
        ...u,
        text: m.text,
        scope: v.scope,
        memoryId: m.id,
        status: "confirmed",
        updatedAt: at,
      });
    } else {
      if (u.memoryId) forgetMemory(db, actor, u.memoryId);
      putUnderstanding(db, actor, {
        ...u,
        text: v.command === "forget" ? "已遗忘" : u.text,
        status: v.command === "reject" ? "rejected" : "withdrawn",
        updatedAt: at,
      });
      clearOwnerContext(db, actor, true);
    }
  }
  return storyOrganization(db, read(), actor);
}
/** Gate existing Memory retrieval by explicit task scope and live evidence; never a second memory store. */
export function storyMemoryRelevant(
  db: DatabaseSync,
  actor: Person,
  memory: MemoryRecord,
  question: string,
) {
  if (memory.provenance?.extractor !== "confirmed-story-statement-v1")
    return true;
  if (!ready(db)) return false;
  const row = db
    .prepare("SELECT body FROM life_understanding WHERE id=? AND owner=?")
    .get(memory.provenance.sourceId, actor) as { body: string } | undefined;
  if (!row) return false;
  const u = JSON.parse(row.body) as Understanding;
  return (
    u.status === "confirmed" &&
    u.memoryId === memory.id &&
    u.scope
      .split(/[、，,\s/]+/)
      .some(
        (t) =>
          t.length >= 2 && question.toLowerCase().includes(t.toLowerCase()),
      )
  );
}
