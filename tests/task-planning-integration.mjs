import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_BASE_URL;
if (!base) throw Error("Use the isolated verify-local task-planning server");
async function api(route, body, actor = "lin") {
  const r = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "x-demo-actor": actor },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  return d;
}
const inventory = {};
const originalPlans = (await api("/api/workspace")).plans;
for (const [key, name] of Object.entries({
  camera: "出游相机",
  charger: "相机充电器",
  bag: "背包",
  torch: "手电筒",
})) {
  inventory[key] = (
    await api("/api/life", {
      action: "createItem",
      input: {
        name,
        category: "日常用品",
        lifecycle: "长期耐用",
        availability: "available",
        attributes: { quantity: 1 },
        requestId: crypto.randomUUID(),
      },
    })
  ).item;
}
const browser = await chromium.launch({
  executablePath:
    process.env.EDGE_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shots = "artifacts/task-planning";
mkdirSync(shots, { recursive: true });
try {
  await page.goto(base + "/#assistant");
  const chat = page.getByRole("region", { name: "物间统一对话" });
  async function send(text) {
    await chat.getByLabel("对物间说", { exact: true }).fill(text);
    await chat.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      chat.getByRole("button", { name: "发送", exact: true }),
    ).toBeEnabled();
  }
  await send("明天要去拍照，帮我看看有哪些东西需要准备，不买新的");
  await expect(
    chat.getByRole("button", { name: "保存这份计划", exact: true }),
  ).toBeVisible();
  assert.deepEqual((await api("/api/workspace")).plans, originalPlans);
  await chat.getByRole("button", { name: "保存这份计划", exact: true }).click();
  const plans = page.getByRole("region", { name: "我的准备清单" });
  await expect(plans).toBeVisible();
  const row = (id) => plans.locator(`[data-step-id="${id}"]`);
  await expect(
    row(`pack:${inventory.camera.id}`).getByRole("button", {
      name: "我已确认完成",
      exact: true,
    }),
  ).toBeDisabled();
  await row("scene")
    .getByRole("button", { name: "我已确认完成", exact: true })
    .click();
  await expect(
    row("scene").getByRole("button", { name: "改为待准备", exact: true }),
  ).toBeVisible();
  await row(`check:${inventory.camera.id}`)
    .getByRole("button", { name: "我已确认完成", exact: true })
    .click();
  await expect(
    row(`check:${inventory.camera.id}`).getByRole("button", {
      name: "改为待准备",
      exact: true,
    }),
  ).toBeVisible();
  const initial = (await api("/api/workspace")).plans.find((p) => p.preparation);
  await page.reload();
  await expect(
    row("scene").getByRole("button", { name: "改为待准备", exact: true }),
  ).toBeVisible();
  await expect(
    row(`check:${inventory.camera.id}`).getByRole("button", {
      name: "改为待准备",
      exact: true,
    }),
  ).toBeVisible();
  await send("相机没电了");
  await chat.getByRole("button", { name: "确认更新清单", exact: true }).click();
  await expect(row(`charge:${inventory.camera.id}`)).toBeVisible();
  await expect(
    row(`check:${inventory.camera.id}`).getByRole("button", {
      name: "我已重新核对",
      exact: true,
    }),
  ).toBeDisabled();
  await send("现在只剩10分钟，手电筒也不带了");
  await chat.getByRole("button", { name: "确认更新清单", exact: true }).click();
  await expect(plans.getByText(/准备时间：10 分钟/)).toBeVisible();
  await expect(row(`optional:${inventory.torch.id}`)).toHaveCount(0);
  await expect(
    row("scene").getByRole("button", { name: "改为待准备", exact: true }),
  ).toBeVisible();
  const final = (await api("/api/workspace")).plans.find((p) => p.preparation);
  assert.equal(final.id, initial.id);
  assert.equal(final.preparation.constraints.preparationMinutes, 10);
  assert.deepEqual(
    final.preparation.steps.find((s) => s.id === "scene").completionReport,
    initial.preparation.steps.find((s) => s.id === "scene").completionReport,
  );
  assert.equal((await api("/api/workspace", undefined, "dad")).plans.filter((p) => p.preparation).length, 0);
  await page.screenshot({ path: shots + "/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(plans).toBeVisible();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({ path: shots + "/mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    realModelCalls: 0,
    kind: "isolated-production-browser",
    checks: [
      "goal and explicit save",
      "dependencies and per-step confirmation",
      "reload retains progress",
      "camera power report adds charge dependency",
      "time limit and exclusion preserve completion",
      "owner isolation",
      "390px layout",
    ],
    planId: final.id,
    revision: final.preparation.revision,
  };
  writeFileSync(shots + "/validation.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
