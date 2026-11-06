import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
export function migrateHome(db: DatabaseSync, filename: string) {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=6").get())
    return;
  const backup = filename + ".before-v5-to-v6.sqlite";
  if (!existsSync(backup))
    db.exec("VACUUM INTO '" + backup.replaceAll("'", "''") + "'");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE home_placements(item_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, revision INTEGER NOT NULL, identity TEXT NOT NULL, location TEXT NOT NULL);
      CREATE TABLE home_place_requests(owner TEXT NOT NULL,request_id TEXT NOT NULL,hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(owner,request_id));
      CREATE TABLE home_proposals(id TEXT PRIMARY KEY,owner TEXT NOT NULL,request_id TEXT NOT NULL,session_id TEXT NOT NULL,action TEXT NOT NULL,identities TEXT NOT NULL,card TEXT NOT NULL,status TEXT NOT NULL,expires_at TEXT NOT NULL,result TEXT,UNIQUE(owner,request_id));`);
    db.prepare("INSERT INTO schema_migrations VALUES(6,?)").run(
      new Date().toISOString(),
    );
    db.prepare("INSERT INTO migration_audit VALUES(6,?,?)").run(
      backup,
      "Add item placements and expiring, authorized, idempotent home proposals. Existing workspace preserved.",
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
