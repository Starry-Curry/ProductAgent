import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd(), false, {
  info() {},
  warn() {},
  error() {},
});
if (
  process.env.LIVE_SYSTEM_APPROVED !== "public-fixtures" ||
  process.env.AI_ALLOW_PAID_CALLS !== "true"
)
  throw Error("Live system test is not authorized.");
if (!process.env.AI_API_KEY?.trim())
  throw Error("No credential is available to the application.");
const root = process.cwd();
mkdirSync(path.join(root, ".runtime"), { recursive: true });
mkdirSync(path.join(root, "artifacts"), { recursive: true });
const data = mkdtempSync(path.join(root, ".runtime", "live-system-"));
const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const base = "http://127.0.0.1:" + port;
const env = {
  ...process.env,
  AUTH_MODE: "local-demo",
  PRODUCT_AGENT_DATA_DIR: data,
  NEXT_TELEMETRY_DISABLED: "1",
  LANGSMITH_TRACING: "false",
  LANGCHAIN_TRACING_V2: "false",
};
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { cwd: root, env, windowsHide: true, stdio: "ignore" },
);
const report = {
  kind: "live-model-and-isolated-system",
  startedAt: new Date().toISOString(),
  provider: "Beijing Model Studio",
  model: process.env.AI_MODEL,
  passed: false,
  maxNewModelCalls: 12,
  modelCalls: 0,
  tokens: { input: 0, output: 0 },
  cases: [],
  physicalDeviceTests: 0,
  cost: null,
  notes: [
    "Only public questions and synthetic memory fixtures were used.",
    "Credentials, authorization headers and upstream response bodies are not logged.",
    "Token usage is reported; actual fees must be checked in the provider bill.",
  ],
};
async function api(route, body) {
  const r = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: { "x-demo-actor": "lin", "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  assert.equal(r.status, 200, "Application request failed: " + r.status);
  return d;
}
function record(name, result, ms) {
  report.modelCalls += result.modelCalls;
  if (result.tokens) {
    report.tokens.input += result.tokens.input;
    report.tokens.output += result.tokens.output;
  }
  const row = {
    name,
    modelCalls: result.modelCalls,
    outcome: result.reply.outcome,
    source: result.reply.source,
    errorCode: result.reply.errorCode || null,
    elapsedMs: ms,
    toolStages: result.trace
      .filter((t) => t.stage === "tool_completed")
      .map((t) => t.detail),
    evidenceIds: result.reply.evidenceIds,
    tokens: result.tokens,
  };
  report.cases.push(row);
  console.log(JSON.stringify(row));
  assert.ok(report.modelCalls <= report.maxNewModelCalls, "Budget exceeded");
  assert.ok(result.modelCalls > 0, "Expected a real model call");
  assert.equal(result.reply.errorCode, undefined, "Provider failed");
  return row;
}
async function turn(name, input) {
  assert.ok(
    report.modelCalls + 3 <= report.maxNewModelCalls,
    "Not enough remaining call budget",
  );
  const start = Date.now();
  const r = await api("/api/assistant", {
    requestId: crypto.randomUUID(),
    ...input,
  });
  record(name, r, Date.now() - start);
  return r;
}
let browser;
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw Error("Isolated server exited");
    try {
      const r = await fetch(base + "/api/workspace", {
        headers: { "x-demo-actor": "lin" },
      });
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, "Isolated server was not ready");
  const general = await turn("natural-help", {
    question:
      "请帮我把“整理桌面”变成一个容易开始的小目标，用一句自然的话回答，不介绍商品参数。",
  });
  assert.equal(general.reply.outcome, "answered");
  let workspace = await api("/api/workspace", {
    action: "createItem",
    name: "在线验收用 M185（合成测试）",
  });
  const itemId = workspace.items.at(-1).id;
  await api("/api/workspace", {
    action: "bindProduct",
    itemId,
    packId: "logitech-m185-m-r0061",
    confirmed: true,
  });
  const evidence = await turn("model-selects-confirmed-fact", {
    itemId,
    question: "如何依据已核对的资料说明这只鼠标的电池规格？",
  });
  assert.equal(evidence.reply.outcome, "answered");
  assert.ok(evidence.reply.evidenceIds.includes("M-R0061:battery"));
  const privateFixture = "SYNTHETIC_LOCAL_ONLY_MEMORY_8347";
  const hidden = (
    await api("/api/memories", {
      requestId: crypto.randomUUID(),
      memory: { kind: "preference", text: privateFixture, allowCloud: false },
    })
  ).memory;
  const granted = (
    await api("/api/memories", {
      requestId: crypto.randomUUID(),
      memory: {
        kind: "preference",
        text: "【合成测试数据】我喜欢把目标拆成简短的小步骤。",
        allowCloud: true,
      },
    })
  ).memory;
  await api("/api/memories", {
    action: "persona",
    input: { enabled: true, nickname: "小物测试", style: "warm" },
  });
  const companion = await turn("companion-with-real-item-tool", {
    mode: "companion",
    question:
      "先看看我当前可访问的物品有哪些，再结合我喜欢简短步骤的偏好，选一件推荐一个温和的小目标，不编造共同经历。",
  });
  assert.equal(companion.reply.outcome, "answered");
  assert.ok(
    companion.trace.some(
      (t) =>
        t.stage === "tool_completed" && t.detail === "list_accessible_items",
    ),
    "Expected real tool round-trip",
  );
  assert.ok(!companion.reply.memoryIds.includes(hidden.id));
  assert.ok(companion.reply.memoryIds.includes(granted.id));
  assert.ok(!JSON.stringify(companion.reply).includes(privateFixture));
  browser = await chromium.launch({
    executablePath:
      process.env.EDGE_PATH ||
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  let pageErrors = 0;
  page.on("pageerror", () => pageErrors++);
  await page.goto(base);
  await page
    .getByRole("textbox", { name: "遇到什么问题？" })
    .fill("帮我把“先把桌上的纸张归到一处”变成一句不催促人的行动建议。");
  assert.ok(
    report.modelCalls + 3 <= report.maxNewModelCalls,
    "Not enough remaining browser call budget",
  );
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/assistant") && r.request().method() === "POST",
    { timeout: 55000 },
  );
  const start = Date.now();
  await page.getByRole("button", { name: "帮我解决", exact: true }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  const result = await response.json();
  record("browser-shows-real-model-answer", result, Date.now() - start);
  assert.equal(result.reply.outcome, "answered");
  const region = page.getByRole("region", {
    name: "连续使用帮助",
    exact: true,
  });
  await expect(
    region.locator(".conversation-message.assistant").last(),
  ).toContainText(result.reply.answer);
  await expect(region).toContainText("AI 一般帮助");
  assert.equal(pageErrors, 0);
  await page.screenshot({
    path: "artifacts/live-model-desktop.png",
    fullPage: true,
  });
  report.passed = true;
} catch (e) {
  report.error =
    e instanceof assert.AssertionError
      ? e.message
      : "Live test did not complete; check per-case error codes.";
  process.exitCode = 1;
  console.log(JSON.stringify({ passed: false, error: report.error }));
} finally {
  if (browser) await browser.close();
  server.kill();
  report.finishedAt = new Date().toISOString();
  writeFileSync("artifacts/live-system.json", JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      passed: report.passed,
      modelCalls: report.modelCalls,
      tokens: report.tokens,
      report: "artifacts/live-system.json",
    }),
  );
}
