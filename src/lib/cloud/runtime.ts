import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { lifeDataDirectory } from "../life/data-directory.ts";

export class CloudError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 403) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function isTimeoutLike(error: unknown) {
  let e = error as
    { name?: string; code?: string; cause?: unknown } | undefined;
  for (let i = 0; e && i < 5; i++) {
    if (
      e.name === "AbortError" ||
      /timeout|timedout/i.test(`${e.name || ""} ${e.code || ""}`)
    )
      return true;
    e = e.cause as typeof e;
  }
  return false;
}
export type VisitorScope = {
  id: string;
  directory: string;
  database?: DatabaseSync;
  close?: () => void;
};
export const visitorContext = new AsyncLocalStorage<VisitorScope>();
export const publicDemo = (
  env: Record<string, string | undefined> = process.env,
) => env.AUTH_MODE === "public-demo";
export const limit = (key: string, fallback: number, max = 1000000000) => {
  const n = Number(process.env[key]);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
};
export function publicOrigin() {
  const u = new URL(process.env.APP_PUBLIC_ORIGIN || "https://invalid.invalid");
  if (
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    u.hostname === "invalid.invalid" ||
    (u.protocol !== "https:" &&
      !(
        process.env.DEMO_ALLOW_LOCAL_HTTP === "true" &&
        u.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(u.hostname)
      ))
  )
    throw new CloudError("configuration", "演示服务配置尚未完成", 503);
  return u.origin;
}
export function assertPublicRequest(r: Request) {
  const origin = publicOrigin();
  // In ModelScope, the platform proxy can rewrite Host before forwarding the request.
  // Only the dedicated ModelScope image enables this exception; keep strict HTTPS
  // Origin checks and reject browser cross-site requests in either deployment mode.
  const platformProxy = process.env.WUJIAN_MODELSCOPE_PROXY === "true";
  if (
    (!platformProxy && r.headers.get("host") !== new URL(origin).host) ||
    r.headers.get("sec-fetch-site") === "cross-site" ||
    (r.headers.get("origin") && r.headers.get("origin") !== origin) ||
    (!["GET", "HEAD"].includes(r.method) && r.headers.get("origin") !== origin)
  )
    throw new CloudError("forbidden_origin", "不允许跨来源访问", 403);
}
export function registry() {
  const root = lifeDataDirectory();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(root, "visitors.sqlite"));
  db.exec(
    "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS visitors(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,expires INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS counters(bucket TEXT PRIMARY KEY,n INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS model_requests(id TEXT PRIMARY KEY,visitor TEXT NOT NULL,at INTEGER NOT NULL,reserved INTEGER NOT NULL,status TEXT NOT NULL);",
  );
  return db;
}
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export const visitorCookie = "wujian_visitor";
export function readVisitor(r: Request): VisitorScope {
  const token = r.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(visitorCookie + "="))
    ?.slice(visitorCookie.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new CloudError("session_required", "请先进入自己的演示空间", 401);
  const db = registry();
  try {
    const row = db
      .prepare("SELECT id,expires FROM visitors WHERE token_hash=?")
      .get(digest(token)) as { id: string; expires: number } | undefined;
    if (!row || row.expires <= Date.now())
      throw new CloudError(
        "session_expired",
        "演示空间已到期，请重新进入",
        401,
      );
    return {
      id: row.id,
      directory: path.join(lifeDataDirectory(), "visitors", row.id),
    };
  } finally {
    db.close();
  }
}
function increment(db: DatabaseSync, key: string, max: number, n = 1) {
  const old = Number(
    (
      db.prepare("SELECT n FROM counters WHERE bucket=?").get(key) as
        { n: number } | undefined
    )?.n || 0,
  );
  if (old + n > max)
    throw new CloudError("rate_limited", "演示额度已达到限制，请稍后再试", 429);
  db.prepare(
    "INSERT INTO counters VALUES(?,?) ON CONFLICT(bucket) DO UPDATE SET n=excluded.n",
  ).run(key, old + n);
}
export function issueVisitor() {
  if (
    directoryBytes(lifeDataDirectory()) >
    limit("DEMO_GLOBAL_STORAGE_BYTES", 512 * 1024 * 1024)
  )
    throw new CloudError("capacity", "演示存储暂时已满，请稍后再试", 503);
  const db = registry();
  try {
    db.exec("BEGIN IMMEDIATE");
    increment(
      db,
      `create:${Math.floor(Date.now() / 60000)}`,
      limit("DEMO_CREATIONS_PER_MINUTE", 5),
    );
    const active = Number(
      db
        .prepare("SELECT count(*) n FROM visitors WHERE expires>?")
        .get(Date.now())!.n,
    );
    if (Number(db.prepare("SELECT count(*) n FROM visitors").get()!.n) >= 60)
      throw new CloudError("capacity", "演示空间需要维护，请稍后再试", 503);
    if (active >= limit("DEMO_MAX_VISITORS", 30, 1000))
      throw new CloudError("capacity", "演示空间暂时已满，请稍后再试", 503);
    const id = randomBytes(16).toString("hex"),
      token = randomBytes(32).toString("hex"),
      expires = Date.now() + limit("DEMO_TTL_HOURS", 24, 168) * 3600000;
    db.prepare("INSERT INTO visitors VALUES(?,?,?)").run(
      id,
      digest(token),
      expires,
    );
    db.exec("COMMIT");
    return { token, expires };
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  } finally {
    db.close();
  }
}
/** Bound invitation guessing as well as successful space creation. Shared across restarts. */
export function reserveEntryAttempt() {
  const db = registry();
  try {
    db.exec("BEGIN IMMEDIATE");
    increment(db, `entry:${Math.floor(Date.now() / 60000)}`, 30);
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
const active = new Map<string, number>();
export function enterRequest(scope: VisitorScope) {
  if (
    (active.get(scope.id) || 0) >= 4 ||
    [...active.values()].reduce((a, b) => a + b, 0) >= 24
  )
    throw new CloudError("busy", "服务繁忙，请稍后再试", 429);
  const db = registry();
  try {
    db.exec("BEGIN IMMEDIATE");
    increment(
      db,
      `http:${scope.id}:${Math.floor(Date.now() / 60000)}`,
      limit("DEMO_REQUESTS_PER_MINUTE", 90, 300),
    );
    db.exec("COMMIT");
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  } finally {
    db.close();
  }
  active.set(scope.id, (active.get(scope.id) || 0) + 1);
  return () => {
    const n = (active.get(scope.id) || 1) - 1;
    if (n) active.set(scope.id, n);
    else active.delete(scope.id);
  };
}
const uploads = new Set<string>();
export function enterUpload() {
  const scope = visitorContext.getStore();
  if (!scope) return () => {};
  if (uploads.size >= 2 || uploads.has(scope.id))
    throw new CloudError("busy", "正在处理上传，请稍后再试", 429);
  uploads.add(scope.id);
  return () => {
    uploads.delete(scope.id);
  };
}
export function directoryBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).reduce((n, e) => {
    const f = path.join(dir, e.name);
    if (e.isSymbolicLink())
      throw new CloudError("storage", "演示存储状态异常", 503);
    return n + (e.isDirectory() ? directoryBytes(f) : statSync(f).size);
  }, 0);
}
export function checkStorage() {
  const scope = visitorContext.getStore();
  if (
    scope &&
    directoryBytes(lifeDataDirectory()) >
      limit("DEMO_GLOBAL_STORAGE_BYTES", 512 * 1024 * 1024)
  )
    throw new CloudError(
      "storage_quota",
      "演示存储总量已达到限制，请联系维护者",
      413,
    );
  if (
    scope &&
    directoryBytes(scope.directory) >
      limit("DEMO_STORAGE_BYTES", 50 * 1024 * 1024, 200 * 1024 * 1024)
  )
    throw new CloudError(
      "storage_quota",
      "演示存储已满，可删除不需要的内容",
      413,
    );
}
export function reserveUpload(bytes: number) {
  const scope = visitorContext.getStore();
  if (!scope) return;
  checkStorage();
  const db = registry();
  try {
    db.exec("BEGIN IMMEDIATE");
    increment(
      db,
      `upload:${scope.id}`,
      limit("DEMO_UPLOAD_BYTES", 20 * 1024 * 1024, 100 * 1024 * 1024),
      bytes,
    );
    db.exec("COMMIT");
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  } finally {
    db.close();
  }
}
export function reservePublicFetch(host: string) {
  if (!publicDemo()) return;
  if (process.env.WUJIAN_ALLOW_PUBLIC_FETCH === "false")
    throw new CloudError("source_disabled", "公开资料联网暂未开放", 403);
  const scope = visitorContext.getStore();
  if (!scope) throw new CloudError("session_required", "未授权资料读取", 401);
  const allowed = (
    process.env.DEMO_SOURCE_HOSTS ||
    "mi.com,mi-img.com,mi-fds.com,xiaomi.com,sony.com,sony.net,sony-asia.com,ikea.com,ikea.cn,jbl.com,jellycat.com,lego.com,philips.com,philips.com.cn,patagonia.com,logitech.com,logi.com,loc.gov,first8studios.org,en.wikibooks.org,openfoodfacts.org,openlibrary.org"
  )
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.some((h) => host === h || host.endsWith("." + h)))
    throw new CloudError(
      "source_not_allowed",
      "此公开来源尚未开放，可上传有权使用的相关片段",
      403,
    );
  const db = registry();
  try {
    db.exec("BEGIN IMMEDIATE");
    increment(db, `fetch:${scope.id}:${Math.floor(Date.now() / 3600000)}`, 12);
    increment(db, `fetch:global:${Math.floor(Date.now() / 86400000)}`, 200);
    db.exec("COMMIT");
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  } finally {
    db.close();
  }
}
const modelActive = new Set<string>();
export function cloudBudgetState(
  env: Record<string, string | undefined> = process.env,
) {
  if (!publicDemo(env)) return { ready: true, state: "ready", message: "" };
  if (
    env.DEMO_AI_ENABLED !== "true" ||
    existsSync(path.join(lifeDataDirectory(), "AI_STOP"))
  )
    return {
      ready: false,
      state: "disabled",
      message: "云端AI暂未开放，资料和故事仍可使用",
    };
  const db = registry();
  try {
    const day = Math.floor(Date.now() / 86400000),
      scope = visitorContext.getStore();
    const rows = db
      .prepare(
        "SELECT count(*) n,coalesce(sum(reserved),0) tokens FROM model_requests WHERE at>=?",
      )
      .get(day * 86400000) as { n: number; tokens: number };
    const personal = scope
      ? Number(
          db
            .prepare(
              "SELECT count(*) n FROM model_requests WHERE visitor=? AND at>=?",
            )
            .get(scope.id, day * 86400000)!.n,
        )
      : 0;
    if (
      rows.n >= limit("DEMO_GLOBAL_MODEL_CALLS", 40, 1000) ||
      rows.tokens >= limit("DEMO_DAILY_TOKEN_BUDGET", 500000, 10000000) ||
      personal >= limit("DEMO_VISITOR_MODEL_CALLS", 6, 50)
    )
      return {
        ready: false,
        state: "budget_exhausted",
        message: "今天的AI演示额度已用完，仍可查看资料、记录故事或使用离线建议",
      };
    return {
      ready: true,
      state: "ready",
      message: "云端AI已开放（演示额度内）",
    };
  } finally {
    db.close();
  }
}
/** Every HTTP attempt is reserved before transmission, including tools and failures. No refunds or silent retries. */
export function governedModelFetch(
  request: typeof fetch,
  env: Record<string, string | undefined>,
): typeof fetch {
  if (!publicDemo(env)) return request;
  return async (url, init) => {
    const scope = visitorContext.getStore();
    if (!scope) throw new CloudError("session_required", "未授权模型请求", 401);
    const gate = cloudBudgetState(env);
    if (!gate.ready) throw new CloudError(gate.state, gate.message, 503);
    if (
      env.AI_ALLOW_PAID_CALLS !== "true" ||
      env.WUJIAN_ALLOW_PAID_CALLS !== "true"
    )
      throw new CloudError("payment_not_authorized", "云端调用未开启", 503);
    const target = new URL(String(url));
    if (
      target.hostname !== "dashscope.aliyuncs.com" ||
      target.protocol !== "https:" ||
      target.pathname !== "/compatible-mode/v1/chat/completions"
    )
      throw new CloudError(
        "configuration",
        "公开演示仅启用已配置的百炼文字接口",
        503,
      );
    if (
      modelActive.has(scope.id) ||
      modelActive.size >= limit("DEMO_MODEL_CONCURRENCY", 2, 4)
    )
      throw new CloudError("busy", "AI正在处理其他请求，请稍后再试", 429);
    const body = JSON.parse(String(init?.body));
    if (
      JSON.stringify(body).includes('"image_url"') &&
      env.DEMO_ALLOW_VISION !== "true"
    )
      throw new CloudError(
        "vision_disabled",
        "当前演示未开放云端照片识别",
        403,
      );
    const input = Buffer.byteLength(JSON.stringify(body));
    if (input > limit("DEMO_MODEL_INPUT_BYTES", 60000, 120000))
      throw new CloudError(
        "input_limit",
        "本次上下文过长，请缩短问题或资料",
        413,
      );
    body.max_tokens = Math.min(
      Number(body.max_tokens) || 1500,
      limit("DEMO_MAX_OUTPUT_TOKENS", 1800, 4000),
    );
    const reserved = input + 256 + body.max_tokens;
    const id = randomBytes(16).toString("hex"),
      db = registry();
    try {
      db.exec("BEGIN IMMEDIATE");
      const state = cloudBudgetState(env);
      if (!state.ready) throw new CloudError(state.state, state.message, 503);
      const used = Number(
        db
          .prepare(
            "SELECT coalesce(sum(reserved),0) n FROM model_requests WHERE at>=?",
          )
          .get(Math.floor(Date.now() / 86400000) * 86400000)!.n,
      );
      if (used + reserved > limit("DEMO_DAILY_TOKEN_BUDGET", 500000, 10000000))
        throw new CloudError("budget_exhausted", "今日AI演示预算不足", 503);
      db.prepare("INSERT INTO model_requests VALUES(?,?,?,?,?)").run(
        id,
        scope.id,
        Date.now(),
        reserved,
        "reserved",
      );
      db.exec("COMMIT");
    } catch (e) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw e;
    } finally {
      db.close();
    }
    modelActive.add(scope.id);
    let status = "network";
    const start = Date.now();
    try {
      const response = await request(url, {
        ...init,
        body: JSON.stringify(body),
      });
      status = String(response.status);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 1_000_000)
        throw new CloudError("invalid_response", "模型响应过大", 502);
      return new Response(bytes.byteLength ? bytes : null, {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      if (status === "network")
        status = isTimeoutLike(error) ? "timeout" : "network";
      throw error;
    } finally {
      modelActive.delete(scope.id);
      const db = registry();
      try {
        db.prepare("UPDATE model_requests SET status=? WHERE id=?").run(
          status,
          id,
        );
      } finally {
        db.close();
      }
      console.info(
        JSON.stringify({
          event: "model_request",
          request: id,
          status,
          elapsedMs: Date.now() - start,
          reservedTokens: reserved,
        }),
      );
    }
  };
}
