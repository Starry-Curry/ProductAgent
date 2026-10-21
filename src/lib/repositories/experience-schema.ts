import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
export function migrateExperience(db: DatabaseSync, filename: string) {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=5").get())
    return;
  const backup = filename + ".before-v4-to-v5.sqlite";
  if (!existsSync(backup))
    db.exec("VACUUM INTO '" + backup.replaceAll("'", "''") + "'");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS demo_content_installations(version TEXT PRIMARY KEY,installed_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS memory_introductions(owner TEXT PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('saved','skipped')),request_id TEXT NOT NULL,hash TEXT NOT NULL,memory_id TEXT,updated_at TEXT NOT NULL);",
    );
    db.prepare("INSERT OR IGNORE INTO schema_migrations VALUES(5,?)").run(
      new Date().toISOString(),
    );
    db.prepare("INSERT OR IGNORE INTO migration_audit VALUES(5,?,?)").run(
      backup,
      "Add one-time introductions and versioned demo content receipts; no existing workspace rewrite.",
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
