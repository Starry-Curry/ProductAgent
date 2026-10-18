import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
export function migrateAmbient(db: DatabaseSync, filename: string) {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=4").get())
    return;
  const backup = filename + ".before-v3-to-v4.sqlite";
  if (!existsSync(backup))
    db.exec("VACUUM INTO '" + backup.replaceAll("'", "''") + "'");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS memory_capture_settings(owner TEXT PRIMARY KEY,enabled INTEGER NOT NULL,since TEXT NOT NULL,created_at TEXT NOT NULL);" +
        "CREATE TABLE IF NOT EXISTS memory_source_receipts(owner TEXT NOT NULL,source_key TEXT NOT NULL,digest TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(owner,source_key));" +
        "CREATE TABLE IF NOT EXISTS memory_capture_slots(owner TEXT NOT NULL,slot TEXT NOT NULL,memory_id TEXT NOT NULL,locked INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,slot));",
    );
    db.prepare("INSERT OR IGNORE INTO schema_migrations VALUES (4,?)").run(
      new Date().toISOString(),
    );
    db.prepare("INSERT OR IGNORE INTO migration_audit VALUES (4,?,?)").run(
      backup,
      "Add local event extraction, content-free source receipts and correction/forget barriers; preserve existing data.",
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
