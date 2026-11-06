import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

const base = process.env.TEST_BASE_URL;
if (!base) throw Error("Use the isolated verify-local care server");
async function api(route, body, actor = "lin") {
  const response = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "x-demo-actor": actor },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}
async function task(title, kind, assignee = "dad") {
  await api("/api/workspace", {
    action: "quickTask",
    requestId: crypto.randomUUID(),
    title,
    kind,
    assignee,
  });
}
await task("保温壶还没修好，今天不要用", "notice");
await task("今天记得买垃圾袋", "purchase");
await task("小林自己整理相册", "clean", "lin");
const mouse = (
  await api(
    "/api/life",
    {
      action: "createItem",
      input: {
        name: "爸爸的鼠标",
        brand: "Logitech",
        model: "M-R0061",
        category: "电子设备",
        lifecycle: "长期耐用",
        availability: "available",
        packId: "logitech-m185-m-r0061",
        confirmed: true,
      },
    },
    "dad",
  )
).item;
const before = await api("/api/workspace");
const browser = await chromium.launch({
  executablePath:
    process.env.EDGE_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const shots = "artifacts/care";
mkdirSync(shots, { recursive: true });
try {
  await page.goto(base);
  await page.getByLabel("演示家庭成员").selectOption("dad");
  await page.getByLabel("界面版本", { exact: true }).selectOption("elder");
  await expect(
    page.getByRole("heading", { name: "不会用？在这里问。" }),
  ).toBeVisible();
  const nav = page.getByRole("navigation", { name: "主要导航" });
  await expect(nav.getByRole("button")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "帮我准备周末野餐", exact: true })).toHaveCount(0);
  await expect(page.getByText("设置与 AI 状态", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "录入物品", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("小林自己整理相册", { exact: true })).toHaveCount(
    0,
  );
  const reminder = page
    .locator(".simple-task")
    .filter({ hasText: "保温壶还没修好" });
  await reminder.getByRole("button", { name: "我知道了", exact: true }).click();
  await expect(
    reminder.getByText("已收到，提醒仍然有效。", { exact: true }),
  ).toBeVisible();
  const acknowledged = (
    await api("/api/workspace", undefined, "dad")
  ).tasks.find((t) => t.title.startsWith("保温壶"));
  assert.equal(acknowledged.acknowledged, true);
  assert.notEqual(acknowledged.status, "用户确认完成");
  await page.reload();
  await expect(page.getByLabel("界面版本", { exact: true })).toHaveValue(
    "elder",
  );
  await expect(page.getByLabel("演示家庭成员")).toHaveValue("dad");
  await expect(
    reminder.getByRole("button", { name: "我已知晓", exact: true }),
  ).toBeDisabled();
  const purchase = page
    .locator(".simple-task")
    .filter({ hasText: "今天记得买垃圾袋" });
  await purchase
    .getByRole("button", { name: "还需要帮忙", exact: true })
    .click();
  await expect(purchase.getByText("仍需协助", { exact: true })).toBeVisible();
  await purchase.getByRole("button", { name: "我已完成", exact: true }).click();
  await expect(purchase).toHaveCount(0);
  await task("下午记得清洗杯子", "clean");
  await expect(
    page.getByRole("heading", { name: "下午记得清洗杯子", exact: true }),
  ).toBeVisible({ timeout: 22000 });
  const chat = page.getByRole("region", { name: "物间统一对话" });
  async function send(question) {
    await chat.getByLabel("对物间说", { exact: true }).fill(question);
    await chat.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      chat.getByRole("button", { name: "发送", exact: true }),
    ).toBeEnabled({ timeout: 15000 });
  }
  await send("这个软件怎么用");
  await expect(chat.getByText(/这里只显示/)).toHaveCount(0);
  await expect(chat.getByText(/这里是大字关怀版/)).toBeVisible();
  await send("明天去拍照，帮我准备清单");
  await expect(chat.getByText(/这项计划或管理操作可以切换/)).toBeVisible();
  await expect(
    chat.getByRole("button", { name: "保存这份计划", exact: true }),
  ).toHaveCount(0);
  assert.deepEqual((await api("/api/workspace")).plans, before.plans);
  await page.getByLabel("想问哪件物品", { exact: true }).selectOption(mouse.id);
  await send("电池规格是什么");
  await expect(
    chat.locator(".conversation-message.assistant").last(),
  ).toContainText("AA");
  await page.getByText("联系卖家 / 售后", { exact: true }).click();
  await expect(
    page.getByText("当前不会自动转接客服，也不会自动发送你的问题。", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText("联系卖家 / 售后", { exact: true }).click();
  await page.screenshot({ path: shots + "/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(reminder).toBeVisible();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  assert.ok(
    await page
      .locator(".care-question > p")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 20),
  );
  for (const button of await nav.getByRole("button").all()) {
    assert.ok((await button.boundingBox()).height >= 48);
  }
  await page.screenshot({ path: shots + "/mobile.png", fullPage: true });
  await nav.getByRole("button", { name: "家人交代的事", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "爸爸，家人交代的事" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "物间统一对话" })).toHaveCount(
    0,
  );
  await page.screenshot({ path: shots + "/mobile-tasks.png", fullPage: true });
  await page.getByLabel("界面版本", { exact: true }).selectOption("standard");
  await expect(nav.getByRole("button")).toHaveCount(7);
  await expect(
    page.getByRole("button", { name: "录入物品", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("演示家庭成员")).toHaveValue("dad");
  assert.deepEqual((await api("/api/workspace")).items, before.items);
  const legacy = await browser.newContext();
  await legacy.addInitScript(() => {
    localStorage.setItem("product-agent-mode", "elder");
    localStorage.setItem("product-agent-actor", "dad");
  });
  const old = await legacy.newPage();
  await old.goto(base);
  await expect(old.getByLabel("界面版本", { exact: true })).toHaveValue(
    "elder",
  );
  await expect(old.getByLabel("演示家庭成员")).toHaveValue("dad");
  await legacy.close();
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    realModelCalls: 0,
    checks: [
      "right-corner mode switch and two-entry navigation",
      "actor and version survive reload",
      "legacy preference keys",
      "only assigned tasks",
      "acknowledgement keeps reminder active",
      "ask for help and complete task",
      "incoming task refresh",
      "unified Q&A and no preparation mutation in care",
      "selected item answers from existing product evidence and seller entry",
      "390px large text and buttons",
      "switch back preserves inventory",
    ],
  };
  writeFileSync(shots + "/validation.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
