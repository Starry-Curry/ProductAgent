import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
export function migrate(db: DatabaseSync, filename: string) {
  const has = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get();
  const current = has
    ? Number(
        (
          db
            .prepare("SELECT MAX(version) AS version FROM schema_migrations")
            .get() as { version: number }
        ).version || 0,
      )
    : 0;
  if (current > 2) throw Error("数据库版本比当前程序新，拒绝写入");
  if (current === 2) return;
  // VACUUM INTO includes committed WAL data. Every upgrade has its own backup.
  const backup = `${filename}.before-v${current}-to-v2.sqlite`;
  if (!existsSync(backup))
    db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS service_runs(id TEXT PRIMARY KEY,actor TEXT NOT NULL,item_id TEXT NOT NULL,body TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS service_runs_scope ON service_runs(actor,item_id);
 CREATE TABLE IF NOT EXISTS service_feedback(run_id TEXT PRIMARY KEY REFERENCES service_runs(id),outcome TEXT NOT NULL CHECK(outcome IN ('completed','unresolved')),at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS migration_audit(version INTEGER PRIMARY KEY,backup_path TEXT NOT NULL,notes TEXT NOT NULL);`);
    const row = db.prepare("SELECT body FROM workspace WHERE id=1").get() as
      { body: string } | undefined;
    if (row) {
      const state = JSON.parse(row.body);
      for (const gift of state.gifts || []) {
        if (!gift.storySnapshots) {
          gift.storySnapshots = (gift.stories || []).map((text: string) => ({
            memoryId: null,
            author: null,
            text,
            at: null,
          }));
          if (gift.claimedBy)
            for (const m of state.memories || []) {
              if (
                m.itemId === gift.itemId &&
                m.author === gift.claimedBy &&
                (gift.stories || []).includes(m.text) &&
                !m.origin
              ) {
                m.owner = gift.claimedBy;
                m.author = null;
                m.origin = {
                  giftId: gift.id,
                  memoryId: null,
                  at: null,
                  attribution: "legacy-unknown",
                };
              }
            }
        }
      }
      db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
        JSON.stringify(state),
      );
    }
    db.prepare("INSERT OR IGNORE INTO schema_migrations VALUES(1,?)").run(
      new Date().toISOString(),
    );
    db.prepare("INSERT INTO schema_migrations VALUES(2,?)").run(
      new Date().toISOString(),
    );
    db.prepare("INSERT INTO migration_audit VALUES(2,?,?)").run(
      backup,
      "Only additive schema and explicit unknown attribution; original preserved in backup.",
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
