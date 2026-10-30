import { AsyncLocalStorage } from "node:async_hooks";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Person } from "./domain.ts";
import { AgentError } from "./agent/contracts.ts";
export type Account = { id: Person; name: string };
export const accountContext = new AsyncLocalStorage<Account>();
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
let connection: DatabaseSync | undefined;
export function accountDB() {
  if (connection) return connection;
  if (!process.env.PRODUCT_AGENT_DATA_DIR)
    throw new AgentError("独立账号服务必须配置数据目录", 503);
  mkdirSync(process.env.PRODUCT_AGENT_DATA_DIR, { recursive: true });
  const db = new DatabaseSync(
    path.join(process.env.PRODUCT_AGENT_DATA_DIR, "accounts.sqlite"),
  );
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_sessions(hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_limits(name TEXT PRIMARY KEY, tries INTEGER NOT NULL, until_at INTEGER NOT NULL);`);
  return (connection = db);
}
export function assertAccountOrigin(r: Request) {
  const url = new URL(r.url),
    origin = r.headers.get("origin");
  const rawHost = r.headers.get("host");
  let supplied: URL;
  try {
    supplied = new URL(`http://${rawHost}`);
  } catch {
    throw new AgentError("请求主机无效", 403);
  }
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !rawHost ||
    !["localhost", "127.0.0.1", "[::1]"].includes(supplied.hostname) ||
    (r.headers.has("x-forwarded-host") &&
      r.headers.get("x-forwarded-host") !== rawHost) ||
    r.headers.has("forwarded") ||
    r.headers.get("sec-fetch-site") === "cross-site" ||
    (origin && origin !== `${url.protocol}//${rawHost}`)
  )
    throw new AgentError("当前独立账号测试服务仅接受同源本机访问", 403);
}
export function readAccount(r: Request): Account {
  const token = r.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith("wujian_account="))
    ?.slice(15);
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new AgentError("请先登录自己的账号", 401);
  const row = accountDB()
    .prepare(
      `SELECT a.id,a.name FROM account_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.hash=? AND s.expires>?`,
    )
    .get(digest(token), Date.now()) as Account | undefined;
  if (!row) throw new AgentError("登录已过期，请重新登录", 401);
  return row;
}
export function login(name: string, password: string, register: boolean) {
  const db = accountDB();
  if (
    !/^[\p{L}\p{N}_-]{2,32}$/u.test(name) ||
    password.length < 12 ||
    password.length > 128
  )
    throw new AgentError("用户名需2—32字，口令需12—128字");
  const limit = db
    .prepare("SELECT tries,until_at FROM login_limits WHERE name=?")
    .get(name) as { tries: number; until_at: number } | undefined;
  if (limit && limit.tries >= 8 && limit.until_at > Date.now())
    throw new AgentError("尝试次数过多，15分钟后再试", 429);
  db.prepare(
    "INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(name) DO UPDATE SET tries=CASE WHEN until_at<? THEN 1 ELSE tries+1 END,until_at=CASE WHEN until_at<? THEN excluded.until_at ELSE until_at END",
  ).run(name, Date.now() + 900000, Date.now(), Date.now());
  if (register) {
    const salt = randomBytes(16).toString("hex");
    try {
      db.prepare("INSERT INTO accounts VALUES(?,?,?,?)").run(
        `u_${randomUUID()}`,
        name,
        salt,
        scryptSync(password, salt, 64).toString("hex"),
      );
    } catch {
      throw new AgentError("该用户名不可用");
    }
  }
  const row = db.prepare("SELECT * FROM accounts WHERE name=?").get(name) as
    { id: Person; name: string; salt: string; hash: string } | undefined;
  const actual = scryptSync(password, row?.salt || "dummy-salt", 64);
  if (!row || !timingSafeEqual(actual, Buffer.from(row.hash, "hex")))
    throw new AgentError("用户名或口令不匹配", 401);
  db.prepare("DELETE FROM login_limits WHERE name=?").run(name);
  db.prepare("DELETE FROM account_sessions WHERE expires<?").run(Date.now());
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO account_sessions VALUES(?,?,?)").run(
    digest(token),
    row.id,
    Date.now() + 8 * 3600000,
  );
  return {
    account: { id: row.id, name: row.name },
    cookie: `wujian_account=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
  };
}
export function logout(r: Request) {
  const token = r.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith("wujian_account="))
    ?.slice(15);
  if (token)
    accountDB()
      .prepare("DELETE FROM account_sessions WHERE hash=?")
      .run(digest(token));
}
export function accountName(id: Person | null) {
  if (!id?.startsWith("u_")) return undefined;
  return (
    accountDB().prepare("SELECT name FROM accounts WHERE id=?").get(id) as
      { name: string } | undefined
  )?.name;
}
