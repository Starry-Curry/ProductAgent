import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
export function migrateFoundation(db: DatabaseSync, filename: string) {
  const current = Number(
    (
      db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as {
        v: number;
      }
    ).v,
  );
  if (current >= 3) return;
  const backup = `${filename}.before-v2-to-v3.sqlite`;
  if (!existsSync(backup))
    db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=3").get()) {
      db.exec("COMMIT");
      return;
    }
    db.exec(`
      CREATE TABLE agent_sessions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,item_id TEXT,revision INTEGER NOT NULL,body TEXT NOT NULL,lease_until INTEGER NOT NULL DEFAULT 0,expires_at TEXT NOT NULL);
      CREATE INDEX agent_sessions_owner ON agent_sessions(owner,item_id);
      CREATE TABLE agent_requests(owner TEXT NOT NULL,request_id TEXT NOT NULL,request_hash TEXT NOT NULL,session_id TEXT NOT NULL,result TEXT,PRIMARY KEY(owner,request_id));
      CREATE TABLE agent_feedback(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES agent_sessions(id),owner TEXT NOT NULL,request_id TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(owner,request_id));
      CREATE TABLE personal_memories(id TEXT PRIMARY KEY,owner TEXT NOT NULL,item_id TEXT,body TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL);
      CREATE INDEX personal_memories_owner ON personal_memories(owner,status);
      CREATE TABLE memory_events(id TEXT PRIMARY KEY,memory_id TEXT NOT NULL,owner TEXT NOT NULL,kind TEXT NOT NULL,at TEXT NOT NULL);
      CREATE TABLE action_receipts(owner TEXT NOT NULL,request_id TEXT NOT NULL,hash TEXT NOT NULL,target_id TEXT NOT NULL,PRIMARY KEY(owner,request_id));
      CREATE TABLE memory_epochs(owner TEXT PRIMARY KEY,version INTEGER NOT NULL);
      CREATE TABLE persona_profiles(owner TEXT NOT NULL,scope TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,scope));
      CREATE TABLE graph_checkpoints(thread_id TEXT NOT NULL,ns TEXT NOT NULL,id TEXT NOT NULL,parent TEXT,cp_type TEXT NOT NULL,cp BLOB NOT NULL,meta_type TEXT NOT NULL,meta BLOB NOT NULL,PRIMARY KEY(thread_id,ns,id));
      CREATE TABLE graph_writes(thread_id TEXT NOT NULL,ns TEXT NOT NULL,checkpoint_id TEXT NOT NULL,task_id TEXT NOT NULL,idx INTEGER NOT NULL,channel TEXT NOT NULL,type TEXT NOT NULL,body BLOB NOT NULL,path TEXT NOT NULL,PRIMARY KEY(thread_id,ns,checkpoint_id,task_id,idx));
    `);
    db.prepare("INSERT INTO schema_migrations VALUES (3,?)").run(
      new Date().toISOString(),
    );
    db.prepare("INSERT INTO migration_audit VALUES (3,?,?)").run(
      backup,
      "Additive Agent/session/memory schema; existing workspace, stories and service records preserved.",
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
