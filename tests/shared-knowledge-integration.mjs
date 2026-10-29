import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_BASE_URL;
if (!base)
  throw Error("Use verify-local.mjs with an isolated synthetic database");
async function api(route, body, method = body ? "POST" : "GET", actor = "lin") {
  const r = await fetch(base + route, {
    method,
    headers: { "Content-Type": "application/json", "x-demo-actor": actor },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, 200, JSON.stringify(data));
  return data;
}
const painting = (
  await api("/api/life", {
    action: "createItem",
    input: {
      name: "验收赠画 V2",
      category: "装饰",
      lifecycle: "长期耐用",
      availability: "available",
      attributes: { quantity: 1 },
    },
  })
).item;
await api("/api/life", {
  action: "createItem",
  input: {
    name: "验收旧纸盒 V2",
    category: "手工",
    lifecycle: "可重复使用",
    availability: "available",
    attributes: {
      material: "纸质（用户报告）",
      dimensions: "20×15×10厘米",
      quantity: 1,
    },
  },
});
mkdirSync("artifacts/shared-knowledge", { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.EDGE_PATH ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [],
  replies = [];
page.on("pageerror", (e) => errors.push(e.message));
async function openItem(name) {
  await page.goto(base);
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "物品展柜", exact: true })
    .click();
  await page.getByRole("textbox", { name: "搜索物品", exact: true }).fill(name);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(
    page.getByRole("textbox", { name: "对物间说", exact: true }),
  ).toBeVisible();
}
async function send(question) {
  await page
    .getByRole("textbox", { name: "对物间说", exact: true })
    .fill(question);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/assistant") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const r = await response;
  assert.equal(r.status(), 200);
  const data = await r.json();
  replies.push({ question, sessionId: data.session.id, reply: data.reply });
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeEnabled();
  return data;
}
async function freshQuestion() {
  await page.locator(".conversation-options > summary").click();
  await page.locator(".conversation-options select").first().selectOption("");
}
try {
  await openItem("验收赠画 V2");
  const saved = await send("记住：朋友小夏送给我这幅画。");
  assert.match(saved.reply.answer, /已记下/);
  const memory = (await api("/api/memories")).memories.find(
    (m) => m.id === saved.reply.memoryIds[0],
  );
  assert.equal(memory.text, "朋友小夏送给我这幅画。");
  assert.equal(memory.allowCloud, false);
  await openItem("验收赠画 V2");
  await freshQuestion();
  const recalled = await send("你还记得这幅画的来历吗？");
  assert.notEqual(recalled.session.id, saved.session.id);
  assert.match(recalled.reply.answer, /小夏/);
  assert(!/生日|旅行/.test(recalled.reply.answer));
  assert(!recalled.reply.source.startsWith("model-"));
  await page.screenshot({
    path: "artifacts/shared-knowledge/painting-cross-session.png",
    fullPage: true,
  });
  const other = await fetch(base + "/api/life?itemId=" + painting.id, {
    headers: { "x-demo-actor": "dad" },
  });
  assert.equal(other.status, 403);
  await api("/api/memories", { id: memory.id }, "DELETE");
  await openItem("验收赠画 V2");
  await freshQuestion();
  const forgotten = await send("你还记得这幅画的来历吗？");
  assert(!forgotten.reply.answer.includes("小夏"));
  await openItem("验收旧纸盒 V2");
  const idea = await send(
    "只用我登记的物品，旧纸盒有什么具体新用途？我喜欢安静的手工和讲故事，不买东西、不加热、不碰水、不裁切。",
  );
  assert.equal(idea.reply.route.intent, "plan");
  assert(!idea.reply.source.startsWith("model-"));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "artifacts/shared-knowledge/box-offline-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  writeFileSync(
    "artifacts/shared-knowledge/result.json",
    JSON.stringify(
      {
        passed: true,
        checks: [
          "explicit save defaults local",
          "new session recalls exact gift fact",
          "other actor denied",
          "forgotten fact absent in new session",
          "box goal enters planning",
          "offline source not represented as model",
          "390px no horizontal overflow",
          "no pageerror",
        ],
        replies,
        realModelCalls: 0,
        physicalTests: 0,
        creativeQualityPassed: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "共享物品浏览器验收通过：显式记住、跨会话召回、遗忘、越权与离线创意入口；0真实模型请求。",
  );
} finally {
  await browser.close();
}
