import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { ensurePrivacyScopes,privacyStamp } from "../memory/context-lifecycle.ts";

/** Additive schema only. Call outside an existing transaction. Legacy body is untouched. */
export function migrateUnified(db: DatabaseSync, filename?: string) {
  const found = db
    .prepare("SELECT 1 FROM sqlite_master WHERE name='foundation_schema'")
    .get();
  if (found) {
    const v = (
      db.prepare("SELECT MAX(version) AS v FROM foundation_schema").get() as {
        v: number;
      }
    ).v;
    if (v !== 1 && v !== 2) throw Error("统一基座版本不兼容，拒绝写入");
    if (v === 1) {
      if (filename && !existsSync(filename + ".before-unified-v2.sqlite"))
        db.exec("VACUUM INTO '" + (filename + ".before-unified-v2.sqlite").replaceAll("'", "''") + "'");
      db.exec("BEGIN IMMEDIATE");
      try {
        ensurePrivacyScopes(db);
        // Preserve only legacy reports that were still reusable under the old epoch rule.
        // Never resurrect reports already made stale by correction/forgetting.
        const rows=db.prepare("SELECT id,actor,body FROM foundation_outcomes").all() as {id:string;actor:string;body:string}[];
        for(const row of rows){
          const o=JSON.parse(row.body),current=(db.prepare("SELECT version FROM memory_epochs WHERE owner=?").get(row.actor) as {version:number}|undefined)?.version||0;
          if(!o.privacyStamp&&o.canReuseForFutureTasks&&o.memoryEpoch===current&&Array.isArray(o.itemInstanceIds))
            db.prepare("UPDATE foundation_outcomes SET body=? WHERE id=?").run(JSON.stringify({...o,privacyStamp:privacyStamp(db,row.actor,o.itemInstanceIds)}),row.id);
        }
        db.exec("INSERT INTO foundation_schema VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))"); db.exec("COMMIT");
      }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    }
    return;
  }
  if (filename && !existsSync(filename + ".before-unified-v1.sqlite"))
    db.exec(
      "VACUUM INTO '" +
        (filename + ".before-unified-v1.sqlite").replaceAll("'", "''") +
        "'",
    );
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE foundation_schema(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
      INSERT INTO foundation_schema VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      CREATE TABLE foundation_grants(id TEXT PRIMARY KEY,issuer TEXT NOT NULL,subject TEXT NOT NULL,resource TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,UNIQUE(issuer,subject,resource));
      CREATE TABLE foundation_tasks(id TEXT PRIMARY KEY,owner TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL);
      CREATE INDEX foundation_tasks_owner ON foundation_tasks(owner);
      CREATE TABLE foundation_runs(id TEXT PRIMARY KEY,task_id TEXT,actor TEXT NOT NULL,request_id TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(actor,request_id));
      CREATE TABLE foundation_outcomes(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,actor TEXT NOT NULL,request_id TEXT NOT NULL,payload TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(actor,request_id));
      CREATE TABLE foundation_links(kind TEXT NOT NULL,ref_id TEXT NOT NULL,task_id TEXT NOT NULL,PRIMARY KEY(kind,ref_id));
    `);
    ensurePrivacyScopes(db);
    db.exec("INSERT INTO foundation_schema VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
