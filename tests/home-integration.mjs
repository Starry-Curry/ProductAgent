import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_BASE_URL;
if (!base)
  throw Error(
    "Run through scripts/verify-local.mjs with an isolated database.",
  );
async function api(route, body, actor = "lin") {
  const r = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: { "x-demo-actor": actor, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  return d;
}
const browser = await chromium.launch({
  executablePath:
    process.env.EDGE_PATH ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const chat = () =>
  page.getByRole("region", { name: "物间统一对话", exact: true });
async function send(text) {
  await chat()
    .getByRole("textbox", { name: "对物间说", exact: true })
    .fill(text);
  await chat().getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    chat().getByRole("button", { name: "发送", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
}
async function home() {
  await page.goto(base + "/legacy");
  await page
    .getByRole("heading", { name: "家里的每一件，都有话想说", exact: true })
    .waitFor();
  await expect(page.locator(".scene-item").first()).toBeVisible();
}
async function choose(name, demo = false) {
  await page
    .getByRole("button", {
      name: `和${name}对话${demo ? "，演示物品" : ""}`,
      exact: true,
    })
    .click();
  await expect(page.locator(".home-dialogue-heading")).toContainText(
    name.replace(/^\[示例\]\s*/, ""),
  );
  await expect(
    chat().getByRole("textbox", { name: "对物间说", exact: true }),
  ).toBeVisible();
}
try {
  await home();
  assert.equal(
    await page.locator(".legacy-home-tools").evaluate((e) => e.open),
    false,
  );
  await expect(
    page.locator(".home-scene-board .item-character").first(),
  ).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "artifacts/home-companions-desktop.png",
    fullPage: true,
  });
  let workspace = await api("/api/workspace");
  const demo = workspace.items.find((i) => i.demo && i.icon === "table");
  assert.ok(demo);
  await choose(demo.name, true);
  await send(demo.demo.questions.find((q) => !q.includes("故事")));
  await expect(
    chat().locator(".conversation-message.assistant").last(),
  ).toContainText("使用帮助");
  const story = "毕业那天妈妈送我这张边桌，我喜欢阅读";
  await send(story);
  await expect(
    chat().locator(".conversation-message.assistant").last(),
  ).toContainText("私人故事");
  await send("聊聊以前的故事");
  await expect(
    chat().locator(".conversation-message.assistant").last(),
  ).toContainText("毕业那天妈妈");
  const recalledMessage = chat()
    .locator(".conversation-message.assistant")
    .last();
  await expect(recalledMessage).not.toContainText("案例中记录了");
  await expect(recalledMessage).not.toContainText("可以接着讲它与你的近况");
  const recallText = await recalledMessage.locator("p").first().textContent();
  assert.ok(recallText.split("\n").filter(Boolean).length <= 2);
  await page.screenshot({
    path: "artifacts/home-companions-story.png",
    fullPage: true,
  });
  const beforeMore = await api("/api/workspace");
  await send("还有呢");
  await expect(
    chat().locator(".conversation-message.assistant").last(),
  ).not.toContainText("毕业那天妈妈");
  assert.equal(
    (await api("/api/workspace")).memories.length,
    beforeMore.memories.length,
  );
  await page.getByRole("button", { name: "返回全屋对话", exact: true }).click();
  await send("帮我准备周末野餐");
  let before = await api("/api/workspace");
  const planCount = before.plans.length;
  await chat()
    .getByRole("button", { name: "保存这份计划", exact: true })
    .last()
    .click();
  await expect(
    chat().getByText("计划已保存，待你执行", { exact: true }).last(),
  ).toBeVisible();
  assert.equal((await api("/api/workspace")).plans.length, planCount + 1);
  workspace = await api("/api/workspace", {
    action: "createItem",
    name: "合成验收阅读书架",
    location: "客厅",
  });
  const own = workspace.items.at(-1);
  await api("/api/workspace", {
    action: "updateItem",
    itemId: own.id,
    shared: true,
  });
  await home();
  await choose(own.name);
  await send("请爸爸帮我固定这件书架");
  const taskCount = (await api("/api/workspace")).tasks.length;
  await chat()
    .getByRole("button", { name: "确认交给家人", exact: true })
    .click();
  await expect(
    chat().getByText("已创建家庭事项，等待处理", { exact: true }),
  ).toBeVisible();
  assert.equal((await api("/api/workspace")).tasks.length, taskCount + 1);
  await page.getByRole("button", { name: "家庭事项", exact: true }).click();
  await expect(
    page.getByText("请爸爸帮我固定这件书架", { exact: true }).first(),
  ).toBeVisible();
  await home();
  await choose(own.name);
  await page.getByRole("button", { name: "调整摆放", exact: true }).click();
  await page
    .getByRole("combobox", { name: "物品所在房间", exact: true })
    .selectOption("study");
  await expect(
    page.getByRole("status").filter({ hasText: "位置已保存" }).first(),
  ).toBeVisible();
  assert.equal(
    (await api("/api/workspace")).items.find((i) => i.id === own.id).location,
    "书房",
  );
  const slider = page.getByRole("slider", { name: "左右位置", exact: true });
  await slider.focus();
  await slider.press("ArrowRight");
  await slider.press("ArrowRight");
  await page.getByRole("button", { name: "保存摆放", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存摆放", exact: true }),
  ).toBeEnabled();
  const placed = (await api("/api/home")).placements.find(
    (p) => p.itemId === own.id,
  );
  assert.equal(placed.roomId, "study");
  assert.ok(placed.saved);
  await home();
  await page.getByRole("tab", { name: /^书房/ }).click();
  await choose(own.name);
  assert.deepEqual(
    (await api("/api/home")).placements.find((p) => p.itemId === own.id),
    placed,
  );
  await page.locator(".home-character-options > summary").click();
  await page.getByRole("checkbox", { name: /开启轻柔动画/ }).uncheck();
  await expect(
    page.locator(".home-dialogue-heading .item-character"),
  ).toHaveClass(/is-still/);
  await page.reload();
  await page.locator(".home-character-options > summary").click();
  await expect(
    page.getByRole("checkbox", { name: /开启轻柔动画/ }),
  ).not.toBeChecked();
  await page.getByRole("checkbox", { name: /开启轻柔动画/ }).check();
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".home-dialogue-heading .character-body")
      .evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await home();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await choose(demo.name, true);
  await send("今天很累，陪我聊聊");
  await expect(
    chat().locator(".conversation-message.assistant").last(),
  ).toContainText("本地简短回应");
  await page.screenshot({
    path: "artifacts/home-companions-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    kind: "isolated-edge-home-scene-and-dialogue",
    realModelCalls: 0,
    checks: [
      "room and object characters",
      "help/story/recall in one session",
      "plan confirmed into existing module",
      "family preview and task creation",
      "owner placement and keyboard controls persisted",
      "animation toggle persisted",
      "OS reduced motion",
      "390px no overflow",
      "existing navigation retained",
      "no browser errors",
    ],
  };
  writeFileSync(
    "artifacts/home-companions-integration.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    "Home scene and item companions browser acceptance passed; realModelCalls=0.",
  );
} catch (e) {
  await page.screenshot({
    path: "artifacts/home-companions-failure.png",
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
}
