import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

export function migrateLife(db: DatabaseSync, filename: string) {
  const table = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='life_schema'",
    )
    .get();
  if (table) {
    const version = Number(
      (
        db.prepare("SELECT MAX(version) AS v FROM life_schema").get() as {
          v: number;
        }
      ).v || 0,
    );
    if (version > 1) throw Error("生活数据版本高于当前程序，拒绝写入");
    if (version === 1) return;
  }
  const backup = filename + ".before-life-v1.sqlite";
  if (!existsSync(backup))
    db.exec("VACUUM INTO '" + backup.replaceAll("'", "''") + "'");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS life_schema(version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS life_media(id TEXT PRIMARY KEY, owner TEXT NOT NULL, mime TEXT NOT NULL, body BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS life_fragments(id TEXT PRIMARY KEY, owner TEXT NOT NULL, text TEXT NOT NULL, media_id TEXT REFERENCES life_media(id), revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS life_fragment_items(fragment_id TEXT NOT NULL REFERENCES life_fragments(id) ON DELETE CASCADE,item_id TEXT NOT NULL,PRIMARY KEY(fragment_id,item_id));
      CREATE TABLE IF NOT EXISTS life_sources(id TEXT PRIMARY KEY,owner TEXT NOT NULL,item_id TEXT NOT NULL,title TEXT NOT NULL,url TEXT,text TEXT NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS life_ideas(id TEXT PRIMARY KEY,owner TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS life_idea_feedback(owner TEXT NOT NULL,idea_id TEXT NOT NULL REFERENCES life_ideas(id),saved INTEGER NOT NULL DEFAULT 0,outcome TEXT NOT NULL DEFAULT '未尝试',note TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,PRIMARY KEY(owner,idea_id));
      CREATE TABLE IF NOT EXISTS life_installations(version TEXT PRIMARY KEY);
      INSERT INTO life_schema VALUES(1);
    `);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
