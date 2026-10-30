import { publicDemo, visitorContext, CloudError } from "./cloud/runtime.ts";
import { installHouseholdCases } from "./demo/install.ts";
import { captureWorkspace } from "./memory/ambient.ts";
import { assertLocalDemo } from "./auth.ts";
import { accountContext } from "./accounts.ts";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { lifeDataDirectory } from "./life/data-directory.ts";
import { migrateLife } from "./life/schema.ts";
import { installLifeDemo } from "./life/demo.ts";
import { seed, mutate, type State, type Person } from "./domain";
import { migrate } from "./migrations";
import { migrateUnified } from "./foundation/schema.ts";
let connection: DatabaseSync | undefined;
export function database() {
  const scope = visitorContext.getStore();
  if (publicDemo() && !scope)
    throw new CloudError("session_required", "请先进入演示空间", 401);
  if (scope?.database) return scope.database;
  if (!scope && connection) return connection;
  const dir = scope?.directory || lifeDataDirectory();
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
  migrateUnified(db, path.join(dir, "demo.sqlite"));
  // The visitor consented to an isolated demonstration space, never a real user's database.
  if (scope) installLifeDemo(db);
  if (scope) {
    scope.database = db;
    scope.close = () => {
      db.close();
    };
  } else connection = db;
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
  if (process.env.AUTH_MODE === "authenticated") {
    const account = accountContext.getStore();
    if (!account) throw new Error("请先登录自己的账号");
    return account.id;
  }
  if (publicDemo()) {
    if (!visitorContext.getStore())
      throw new CloudError("session_required", "请先进入演示空间", 401);
    return "lin";
  }
  const a = r.headers.get("x-demo-actor");
  if (a === "lin" || a === "dad" || a === "friend") return a;
  throw new Error("请选择演示角色");
}
export function localOnly(r: Request) {
  if (process.env.AUTH_MODE === "authenticated") {
    if (!accountContext.getStore()) throw new Error("请先登录自己的账号");
    return;
  }
  if (publicDemo()) {
    if (!visitorContext.getStore())
      throw new CloudError("session_required", "请先进入演示空间", 401);
    return;
  }
  assertLocalDemo(r);
}
