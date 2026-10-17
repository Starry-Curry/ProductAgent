import type { DatabaseSync } from "node:sqlite";
import type { Person } from "../domain.ts";
import { clearOwnerContext } from "../memory/store.ts";
/** Runs on local API access, not a background service. Backups are separately managed. */
export function pruneExpired(db: DatabaseSync, actor: Person) {
  const at = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db
      .prepare("SELECT id FROM agent_sessions WHERE owner=? AND expires_at<=?")
      .all(actor, at) as { id: string }[];
    for (const { id } of rows) {
      db.prepare("DELETE FROM graph_writes WHERE thread_id=?").run(
        actor + ":" + id,
      );
      db.prepare("DELETE FROM graph_checkpoints WHERE thread_id=?").run(
        actor + ":" + id,
      );
      db.prepare("DELETE FROM agent_feedback WHERE session_id=?").run(id);
      db.prepare("DELETE FROM agent_requests WHERE session_id=?").run(id);
      db.prepare("DELETE FROM agent_sessions WHERE id=?").run(id);
    }
    const expired = db
      .prepare(
        "SELECT id,body FROM personal_memories WHERE owner=? AND status!='deleted'",
      )
      .all(actor) as { id: string; body: string }[];
    let changed = false;
    for (const r of expired) {
      const m = JSON.parse(r.body);
      if (m.expiresAt && m.expiresAt <= at) {
        db.prepare(
          "UPDATE personal_memories SET body='{}',status='deleted',version=version+1 WHERE id=?",
        ).run(r.id);
        changed = true;
      }
    }
    if (changed) clearOwnerContext(db, actor, true);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
