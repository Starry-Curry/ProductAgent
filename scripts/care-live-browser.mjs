import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
if (!process.argv.includes("--run") || !process.argv.includes("--authorized=30"))
  throw Error("Explicit current-task live-test authorization required");
process.loadEnvFile(".env.local");
if (!process.env.AI_API_KEY?.trim() || new URL(process.env.AI_BASE_URL).origin !== "https://dashscope.aliyuncs.com")
  throw Error("Intended provider configuration missing");
const directory = path.resolve(".runtime/care-live-20261021");
const ledgerFile = path.join(directory, "ledger.json");
const previous = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
assert.ok(previous.requests.length < 30, "No remaining live-test requests");
const lock = path.join(directory, "live.lock"), fd = fs.openSync(lock, "wx");
const data = fs.mkdtempSync(path.join(directory, "browser-"));
const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const base = "http://127.0.0.1:" + port;
const child = spawn(process.execPath, ["--import", pathToFileURL(path.resolve("scripts/care-live-meter.mjs")).href, "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  stdio: "ignore", env: { ...process.env, AUTH_MODE: "local-demo", WUJIAN_BUILD_DIR: ".next-live-care", PRODUCT_AGENT_DATA_DIR: data, AI_ALLOW_PAID_CALLS: "true", WUJIAN_ALLOW_PAID_CALLS: "true", CARE_LIVE_BROWSER_APPROVED: "30-synthetic-only", WUJIAN_ALLOW_PUBLIC_FETCH: "false", WUJIAN_ALLOW_SEARCH: "false", LANGSMITH_TRACING: "false", LANGCHAIN_TRACING_V2: "false", NEXT_TELEMETRY_DISABLED: "1" },
});
let browser;
const record = { scenario: "browser-care-files", evaluation: "pending-human-review", at: new Date().toISOString(), turns: [] };
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw Error("Isolated server exited");
    try { const r = await fetch(base + "/api/workspace", { headers: { "x-demo-actor": "lin" } }); if (r.ok) { ready = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready);
  browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByLabel("界面版本", { exact: true }).selectOption("elder");
  const chat = page.getByRole("region", { name: "物间统一对话" });
  const question = "我用 Windows 11，文件夹已经建好了，但还没选中或复制文件。请教我把桌面文件放进去，每次只说一步。";
  await chat.getByLabel("对物间说", { exact: true }).fill(question);
  const pending = page.waitForResponse((r) => r.url().endsWith("/api/assistant") && r.request().method() === "POST", { timeout: 120000 });
  await chat.getByRole("button", { name: "发送", exact: true }).click();
  const response = await pending;
  const result = await response.json();
  assert.equal(response.status(), 200);
  await expect(chat.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
  record.turns.push({ question, reply: result.reply, modelCalls: result.modelCalls, trace: result.trace });
  fs.mkdirSync("artifacts/care-live", { recursive: true });
  await page.screenshot({ path: "artifacts/care-live/real-browser-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: "artifacts/care-live/real-browser-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  record.uiPassed = true;
} catch (error) {
  record.error = { type: error.name, message: String(error.message).replaceAll(process.env.AI_API_KEY, "[REDACTED]") };
  process.exitCode = 1;
} finally {
  await browser?.close();
  child.kill();
  await new Promise((r) => child.exitCode !== null ? r() : child.once("exit", r));
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  record.requestIds = ledger.requests.slice(previous.requests.length).map((r) => r.number);
  ledger.cases.push(record);
  fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2), { mode: 0o600 });
  fs.closeSync(fd); fs.unlinkSync(lock);
  console.log(JSON.stringify({ realRequests: record.requestIds.length, totalRequests: ledger.requests.length, uiPassed: record.uiPassed || false, outcome: record.turns[0]?.reply.outcome, errorCode: record.turns[0]?.reply.errorCode || null, evaluation: record.evaluation }));
}
