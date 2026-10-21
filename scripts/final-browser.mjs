/** Authorized final sprint: real Qwen + synthetic browser journey, never the user's 3200 data. */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
if (!process.argv.includes("--run"))
  throw Error("Pass --run for the current authorized real-model sprint");
process.loadEnvFile(".env.local");
const folder = fs.mkdtempSync(
  path.join(process.cwd(), ".runtime", "final-browser-"),
);
const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  AUTH_MODE: "local-demo",
  WUJIAN_BUILD_DIR: ".next-rc",
  PRODUCT_AGENT_DATA_DIR: folder,
  AI_ALLOW_PAID_CALLS: "true",
  WUJIAN_ALLOW_PAID_CALLS: "true",
  AI_ENABLE_THINKING: "false",
  AI_JSON_MODE: "true",
  AI_REQUEST_TIMEOUT_MS: "90000",
  AI_VISION_MODEL: process.env.AI_VISION_MODEL || "qwen3-vl-plus",
  WUJIAN_ALLOW_SEARCH: "false",
  WUJIAN_ALLOW_PUBLIC_FETCH: "true",
  LANGSMITH_TRACING: "false",
  LANGCHAIN_TRACING_V2: "false",
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: `--import=${new URL("../tests/final-provider-ledger.mjs", import.meta.url).href}`,
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
  { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (d) => {
    logs = (logs + d).slice(-8000);
  });
const checks = [],
  cases = [];
let browser;
const report = () =>
  fs.writeFileSync(
    path.join(folder, "browser-validation.json"),
    JSON.stringify({ base, synthetic: true, checks, cases }, null, 2),
  );
async function api(action, input) {
  const r = await fetch(base + "/api/life", {
    method: "POST",
    headers: { "content-type": "application/json", "x-demo-actor": "lin" },
    body: JSON.stringify({ action, input }),
  });
  const d = await r.json();
  assert.equal(r.status, 200, d.error);
  return d;
}
async function data(query = "") {
  return (
    await fetch(base + "/api/life" + query, {
      headers: { "x-demo-actor": "lin" },
    })
  ).json();
}
try {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error("Isolated server exited");
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  const create = (name, category, model = "", brand = "") =>
    api("createItem", {
      name,
      category,
      model,
      brand,
      lifecycle: "长期耐用",
      availability: "available",
    }).then((d) => d.item);
  const maf = await create(
    "Xiaomi Smart Air Fryer 6.5L",
    "厨房用品",
    "MAF10",
    "Xiaomi",
  );
  const camera = await create("验收旅行相机", "电子设备");
  const mouse = await create("验收无线鼠标", "电子设备");
  browser = await chromium.launch({
    executablePath:
      process.env.EDGE_PATH ||
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
    args: ["--disable-gpu"],
  });
  const page = await browser.newPage({
    viewport: { width: 1365, height: 950 },
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const nav = (name) =>
    page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name, exact: true })
      .click();
  await page.goto(base);
  await nav("物品展柜");
  await page.getByRole("textbox", { name: "搜索物品" }).fill(maf.name);
  await page
    .getByRole("button", {
      name: new RegExp(maf.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    })
    .click();
  async function send(question) {
    await page
      .getByRole("textbox", { name: "对物间说", exact: true })
      .fill(question);
    const pending = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/assistant") && r.request().method() === "POST",
      { timeout: 150000 },
    );
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const response = await pending;
    const d = await response.json();
    assert.equal(response.status(), 200, d.error);
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeEnabled({ timeout: 150000 });
    cases.push({ question, result: d });
    report();
    return d;
  }
  const first = await send(
    "我是第一次使用，能带我从准备到完成一次烹饪吗？尚未选食材，不要猜食物参数。",
  );
  assert.equal(first.reply.source, "model-with-evidence");
  assert.ok(
    first.reply.steps.length >= 4,
    "Need useful model-visible guidance, not just HTTP success",
  );
  await expect(
    page.getByText(first.reply.answer, { exact: true }),
  ).toBeVisible();
  const next = await send("第一步已经完成了，接下来呢？");
  assert.ok(next.session.tried.length > 0);
  assert.ok(next.reply.steps.length > 0);
  assert.ok(
    !/清洁|清洗/.test(next.reply.steps[0].text),
    "Should continue after the completed first cleanup",
  );
  checks.push(
    "A: fresh recorded MAF10 -> automatic official knowledge -> real model UI guidance -> natural completion statement -> next step, no model re-question",
  );
  report();
  await nav("生活故事");
  await expect(page.getByLabel("留下一句话", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "写一段生活", exact: true }).click();
  await page
    .locator('input[aria-label="照片（可选，JPEG / PNG / WebP，5MB 内）"]')
    .setInputFiles(
      path.join(process.cwd(), ".runtime/final-20261021/two-objects.jpg"),
    );
  await expect(page.getByAltText("片段照片预览")).toBeVisible();
  const visionResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/life") &&
      r.request().postData()?.includes("storyPhoto"),
    { timeout: 90000 },
  );
  await page
    .getByRole("button", {
      name: "找找照片里的已有物品（需视觉授权）",
      exact: true,
    })
    .click();
  const visual = await (await visionResponse).json();
  cases.push({ name: "real-browser-vision", result: visual });
  report();
  await page.getByRole("checkbox", { name: new RegExp(camera.name) }).check();
  await page.getByRole("checkbox", { name: new RegExp(mouse.name) }).check();
  const text =
    "合成验收：整理旅行相机和鼠标，准备周末出行。我喜欢轻装旅行，喜欢拍建筑细节。";
  await page.getByLabel("留下一句话", { exact: true }).fill(text);
  await page.getByText("日期、记录类型与引用权限", { exact: true }).click();
  await page
    .getByLabel("允许将这段文字交给已授权云端AI聊故事（不含照片）")
    .check();
  await page.getByRole("button", { name: "保存生活片段", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  const f = (await data()).fragments.find((f) => f.text === text);
  assert.ok(f);
  assert.deepEqual(new Set(f.itemIds), new Set([camera.id, mouse.id]));
  for (const i of [camera, mouse])
    assert.ok(
      (await data("?itemId=" + i.id)).fragments.some((x) => x.id === f.id),
    );
  checks.push(
    "C: real Vision -> two owned-instance candidates -> human-style selection -> one original event visible from both items",
  );
  report();
  fs.mkdirSync("artifacts/final", { recursive: true });
  await page.screenshot({
    path: "artifacts/final/storybook-desktop.png",
    fullPage: true,
  });
  await api("fragment", {
    text: "合成验收：再次沿河拍摄桥梁的建筑细节。",
    itemIds: [camera.id],
    capturedOn: "2026-09-18",
    allowRecall: true,
    allowCloud: true,
  });
  await api("storyOrganization", { command: "extract" });
  const org = (await data()).storyOrganization;
  const u = org.understanding.find(
    (u) => u.status === "candidate" && u.text.includes("轻装"),
  );
  assert.ok(u);
  await api("storyOrganization", {
    command: "confirm",
    id: u.id,
    scope: "旅行,摄影,出游",
    allowCloud: true,
  });
  const fragments = (await data()).fragments.filter((x) =>
    x.itemIds.includes(camera.id),
  );
  await api("storyOrganization", {
    command: "chapter",
    name: "合成出行与摄影",
    fragmentIds: fragments.map((x) => x.id),
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "写一段生活", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/final/storybook-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  checks.push(
    "Story default reading, refresh persistence, original words, chapter references and 390px layout",
  );
  report();
  await page.setViewportSize({ width: 1365, height: 950 });
  await nav("问物间");
  const chat = await send("我今天有点累，只想随便聊一句，不用安排任务。");
  assert.equal(chat.reply.outcome, "answered");
  assert.equal(chat.reply.memoryIds.length, 0);
  checks.push("Natural real-model chat without unrelated private story recall");
  assert.deepEqual(errors, []);
  report();
  console.log(
    JSON.stringify({
      passed: true,
      base,
      checks,
      artifacts: "artifacts/final",
      record: path.relative(process.cwd(), folder),
    }),
  );
} catch (e) {
  cases.push({ failure: e.message });
  report();
  console.log(
    JSON.stringify({
      passed: false,
      error: e.message,
      record: path.relative(process.cwd(), folder),
    }),
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await new Promise((r) => {
    if (server.exitCode !== null) r();
    else server.once("exit", r);
  });
}
