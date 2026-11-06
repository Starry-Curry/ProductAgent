import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_BASE_URL;
if (!base)
  throw Error("Use scripts/verify-local.mjs with an isolated test database.");
async function api(route, actor = "lin") {
  const r = await fetch(base + route, { headers: { "x-demo-actor": actor } });
  assert.equal(r.status, 200);
  return r.json();
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
async function home() {
  await page.goto(base + "/legacy");
  await page.locator(".legacy-home-tools > summary").click();
  await page
    .getByText("记忆与陪伴 · 看看它记下了什么", { exact: true })
    .waitFor();
}
async function send(region, text, story = false) {
  await region
    .getByRole("textbox", {
      name: story ? "讲讲你与这件物品" : "写下你的问题",
      exact: true,
    })
    .fill(text);
  await region
    .getByRole("button", { name: story ? "发送" : "发送问题", exact: true })
    .click();
  await expect(
    region.getByRole("button", {
      name: story ? "发送" : "发送问题",
      exact: true,
    }),
  ).toBeEnabled({ timeout: 30000 });
}
try {
  await home();
  const workspace = await api("/api/workspace");
  assert.equal(workspace.items.filter((i) => i.demo).length, 8);
  assert.equal(workspace.memories.filter((m) => m.demo).length, 16);
  assert.equal(
    workspace.tasks.filter((t) => t.title.startsWith("[示例]")).length,
    4,
  );
  await expect(page.locator(".case-card")).toHaveCount(4);
  await page
    .getByRole("button", { name: "查看全部 8 个案例", exact: true })
    .click();
  await expect(page.locator(".case-card")).toHaveCount(8);
  await expect(
    page.getByRole("button", { name: "手动补充（可选）", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/household-home-desktop.png",
    fullPage: true,
  });
  await page
    .locator(".case-card")
    .filter({ hasText: "早晨给家人泡杯茶" })
    .getByRole("button", { name: "和它聊聊", exact: true })
    .click();
  const story = page.getByRole("region", { name: "与物品讲故事", exact: true });
  await expect(page.locator(".demo-notice")).toContainText("合成内容");
  await expect(page.getByText("直接写下一段记忆", { exact: true })).toHaveCount(
    0,
  );
  await story
    .getByRole("button", { name: "聊聊以前的故事", exact: true })
    .click();
  await expect(
    story.getByRole("textbox", { name: "讲讲你与这件物品", exact: true }),
  ).toHaveValue("聊聊以前的故事");
  await story.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    story.locator(".conversation-message.assistant").last(),
  ).toContainText("给来帮忙的爸爸泡了茶");
  await send(story, "我喜欢园艺", true);
  const memory = await api("/api/memories");
  assert.ok(
    memory.memories.some(
      (m) =>
        m.text === "我喜欢园艺" &&
        m.kind === "interest" &&
        m.demo &&
        m.itemId === "demo-household-kettle",
    ),
  );
  assert.ok(!memory.memories.some((m) => m.text === "我喜欢园艺" && !m.demo));
  const center = page.locator(".memory-center");
  await center.locator("> summary").click();
  await expect(
    center.getByText("第一次见面，可选地介绍一下自己", { exact: true }),
  ).toHaveCount(0);
  await center
    .locator(".source-card")
    .filter({ hasText: "搬家后第一个周末" })
    .getByRole("button", { name: "忘记", exact: true })
    .click();
  assert.ok(
    !(await api("/api/memories")).memories.some(
      (m) => m.demo && m.text.includes("搬家后第一个周末"),
    ),
  );
  await home();
  assert.ok(
    !(await api("/api/memories")).memories.some(
      (m) => m.demo && m.text.includes("搬家后第一个周末"),
    ),
  );
  await page
    .locator(".case-card")
    .filter({ hasText: "早晨给家人泡杯茶" })
    .getByRole("button", { name: "查看资料与帮助", exact: true })
    .click();
  const help = page.getByRole("region", { name: "连续使用帮助", exact: true });
  await help.getByRole("button", { name: "容量是多少？", exact: true }).click();
  await help.getByRole("button", { name: "发送问题", exact: true }).click();
  await expect(
    help.locator(".conversation-message.assistant").last(),
  ).toContainText("1.7 升");
  await expect(help.getByText("精选资料指导", { exact: true })).toBeVisible();
  await page.getByText("查看物品说明 / 型号资料", { exact: true }).click();
  await expect(
    page.getByText("演示资料绑定，尚未核对用户实物", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/household-source-desktop.png",
    fullPage: true,
  });
  await home();
  await page.getByLabel("演示角色 · 非真实账号").selectOption("dad");
  const dadCenter = page.locator(".memory-center");
  await dadCenter.locator("> summary").click();
  await dadCenter
    .getByText("第一次见面，可选地介绍一下自己", { exact: true })
    .click();
  await dadCenter
    .getByLabel("想让我先了解的一点背景")
    .fill("我喜欢散步，希望留下旧物与家人的故事");
  await dadCenter
    .getByRole("button", { name: "保存这次介绍", exact: true })
    .click();
  await expect(
    dadCenter.getByText("第一次见面，可选地介绍一下自己", { exact: true }),
  ).toHaveCount(0);
  await home();
  await page.locator(".memory-center > summary").click();
  await expect(
    page.getByText("第一次见面，可选地介绍一下自己", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("演示角色 · 非真实账号").selectOption("friend");
  const friendCenter = page.locator(".memory-center");
  await friendCenter.locator("> summary").click();
  await friendCenter
    .getByText("第一次见面，可选地介绍一下自己", { exact: true })
    .click();
  await friendCenter
    .getByRole("button", { name: "先跳过，以后通过物品聊天", exact: true })
    .click();
  await expect(
    friendCenter.getByText("第一次见面，可选地介绍一下自己", { exact: true }),
  ).toHaveCount(0);
  await home();
  await page.locator(".memory-center > summary").click();
  await expect(
    page.getByText("第一次见面，可选地介绍一下自己", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("演示角色 · 非真实账号").selectOption("lin");
  await home();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".case-card").first()).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "artifacts/household-home-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  writeFileSync(
    "artifacts/household-integration.json",
    JSON.stringify(
      {
        passed: true,
        kind: "isolated-edge-household-cases-and-one-time-introduction",
        realModelCalls: 0,
        checks: [
          "eight cases and synthetic provenance",
          "no repeated memory creation forms",
          "official facts through real API and UI",
          "case-only conversational memory",
          "forgotten case memory stays forgotten",
          "one-time introduction saved or skipped across reload",
          "desktop and 390px layout",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "Household cases and one-time introduction browser acceptance passed; realModelCalls=0.",
  );
} catch (e) {
  await page.screenshot({
    path: "artifacts/household-failure.png",
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
}
