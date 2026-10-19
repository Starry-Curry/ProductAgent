import { installHouseholdCases } from "./demo/install.ts";
import { captureWorkspace } from "./memory/ambient.ts";
import { assertLocalDemo } from "./auth.ts";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { lifeDataDirectory } from "./life/data-directory.ts";
import { migrateLife } from "./life/schema.ts";
import { seed, mutate, type State, type Person } from "./domain";
import { migrate } from "./migrations";
let connection: DatabaseSync | undefined;
export function database() {
  if (connection) return connection;
  const dir = lifeDataDirectory();
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "demo.sqlite"));
  db.exec(
    "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
  );
  db.prepare("INSERT OR IGNORE INTO workspace VALUES (1,?)").run(
    JSON.stringify(seed()),
  );
  db.exec("PRAGMA foreign_keys=ON");
  migrate(db, path.join(dir, "demo.sqlite"));
  installHouseholdCases(db);
  migrateLife(db, path.join(dir, "demo.sqlite"));
  connection = db;
  return db;
}
export function read(): State {
  return JSON.parse(
    (
      database().prepare("SELECT body FROM workspace WHERE id=1").get() as {
        body: string;
      }
    ).body,
  );
}
export function write(a: Person, action: string, p: Record<string, unknown>) {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const s = mutate(read(), a, action, p);
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(JSON.stringify(s));
    captureWorkspace(db, s, a, new Date().toISOString());
    db.exec("COMMIT");
    return s;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function actor(r: Request): Person {
  const a = r.headers.get("x-demo-actor");
  if (a === "lin" || a === "dad" || a === "friend") return a;
  throw new Error("请选择演示角色");
}
export function localOnly(r: Request) {
  assertLocalDemo(r);
}
