import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3101";
const started = Date.now();
async function api(path, body, actor = "lin", method = body ? "POST" : "GET") {
  const r = await fetch(base + path, {
    method,
    headers: { "x-demo-actor": actor, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
async function okay(path, body, actor = "lin", method) {
  const r = await api(path, body, actor, method);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
const first = await okay("/api/assistant", {
  question: "鼠标双击速度怎么调",
  requestId: crypto.randomUUID(),
});
assert.equal(first.reply.outcome, "needs_info");
const second = await okay("/api/assistant", {
  question: "Windows 11",
  sessionId: first.session.id,
  expectedRevision: first.session.revision,
  requestId: crypto.randomUUID(),
});
assert.equal(second.reply.steps.length, 3);
assert.equal(
  (await api("/api/assistant?sessionId=" + first.session.id, null, "dad"))
    .status,
  403,
);
const privateMemory = (
  await okay("/api/memories", {
    requestId: crypto.randomUUID(),
    memory: { kind: "story", text: "API_PRIVATE_113", allowCloud: false },
  })
).memory;
assert.equal(
  (await api("/api/memories", { id: privateMemory.id }, "dad", "DELETE"))
    .status,
  403,
);
await okay("/api/memories", { id: privateMemory.id }, "lin", "DELETE");
mkdirSync("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.EDGE_PATH ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function askIn(container, text) {
  await container
    .getByRole("textbox", { name: /写下你的问题|讲讲你与这件物品/ })
    .fill(text);
  await container.getByRole("button", { name: /^(发送问题|发送)$/ }).click();
  await expect(
    container.getByRole("button", { name: /^(发送问题|发送)$/ }),
  ).toBeEnabled({ timeout: 30000 });
}
async function home() {
  await page.goto(base);
  await page
    .getByText("记忆与陪伴 · 看看它记下了什么", { exact: true })
    .waitFor();
}
try {
  await home();
  await page.getByRole("button", { name: "试试分步帮助", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "遇到什么问题？" }),
  ).toHaveValue("Windows 11 双击速度怎么调");
  await page.getByRole("button", { name: "帮我解决", exact: true }).click();
  let conversation = page.getByRole("region", {
    name: "连续使用帮助",
    exact: true,
  });
  await expect(
    conversation
      .locator(".conversation-message.assistant")
      .last()
      .locator("li"),
  ).toHaveCount(3, { timeout: 30000 });
  await conversation
    .getByRole("button", { name: "这步试过了", exact: true })
    .first()
    .click();
  await expect(
    conversation.getByRole("button", { name: "已试过", exact: true }),
  ).toHaveCount(1);
  await askIn(conversation, "还是不行");
  await expect(
    conversation
      .locator(".conversation-message.assistant")
      .last()
      .locator("li"),
  ).toHaveCount(2);
  await page.getByLabel("这是家里的哪件物品？").selectOption("lamp");
  conversation = page.getByRole("region", {
    name: "连续使用帮助",
    exact: true,
  });
  await expect(
    conversation
      .locator(".conversation-message.assistant")
      .last()
      .locator("li"),
  ).toHaveCount(2);
  await conversation
    .getByRole("button", { name: "请家人帮我", exact: true })
    .click();
  await conversation
    .getByLabel("家人将看到这段求助摘要")
    .fill("请帮我找到双击设置（已试第一步）");
  await conversation
    .getByRole("button", { name: "确认摘要并交给家人", exact: true })
    .click();
  await expect(
    conversation.getByRole("button", { name: "已交给家人", exact: true }),
  ).toBeVisible();
  const workspace = await okay("/api/workspace");
  assert.ok(
    workspace.tasks.some(
      (t) =>
        t.title.includes("已试第一步") &&
        t.serviceContext?.attemptedSteps === 1,
    ),
  );
  await conversation
    .getByRole("button", { name: "解决了", exact: true })
    .click();
  await expect(
    conversation.getByText("已按自动整理设置处理本轮方法", { exact: false }),
  ).toBeVisible();
  const saved = await okay("/api/memories");
  assert.ok(
    saved.memories.some(
      (m) =>
        m.kind === "method" &&
        m.allowCloud === false &&
        !m.text.includes("打开“设置 → 蓝牙和设备 → 鼠标”。"),
    ),
  );
  await page.screenshot({
    path: "artifacts/foundation-help-desktop.png",
    fullPage: true,
  });
  await home();
  await page.locator(".item-card").filter({ hasText: "木质相框" }).click();
  await page.getByRole("button", { name: "故事与记录", exact: true }).click();
  let storyConversation = page.getByRole("region", {
    name: "与物品讲故事",
    exact: true,
  });
  await askIn(storyConversation, "我喜欢手工和拼豆");
  await expect(
    page.locator(".timeline").filter({ hasText: "我喜欢手工和拼豆" }),
  ).toBeVisible();
  const automatic = await okay("/api/memories");
  assert.ok(
    automatic.memories.some(
      (m) =>
        m.kind === "interest" &&
        m.text === "我喜欢手工" &&
        m.source === "automatic" &&
        !m.allowCloud,
    ),
  );
  await home();
  const center = page.locator(".memory-center");
  await center.locator("> summary").click();
  await expect(center.getByLabel("纠正或补充内容")).toHaveCount(0);
  await page.getByRole("button", { name: "发现", exact: true }).click();
  await page.getByText("结合我记下的兴趣，找点灵感", { exact: true }).click();
  const ideas = page.getByRole("region", {
    name: "结合我的物品找灵感",
    exact: true,
  });
  await askIn(ideas, "用家里的东西找点灵感");
  await expect(
    ideas.locator(".conversation-message.assistant").last(),
  ).toContainText("装进相框");
  await askIn(ideas, "今天不想手工，换个方向");
  await expect(
    ideas.locator(".conversation-message.assistant").last(),
  ).toContainText("生活照");
  await home();
  await page.locator(".item-card").filter({ hasText: "木质相框" }).click();
  await page.getByRole("button", { name: "故事与记录", exact: true }).click();
  storyConversation = page.getByRole("region", {
    name: "与物品讲故事",
    exact: true,
  });
  await askIn(storyConversation, "青色相框是毕业那天妈妈送的");
  await askIn(storyConversation, "聊聊以前的故事");
  await expect(
    storyConversation.locator(".conversation-message.assistant").last(),
  ).toContainText("毕业那天妈妈送的");
  await page.screenshot({
    path: "artifacts/ambient-item-story-desktop.png",
    fullPage: true,
  });
  await home();
  await center.locator("> summary").click();
  await expect(
    center.locator(".source-card").filter({ hasText: "毕业那天" }),
  ).toBeVisible();
  await center.getByText("可选陪伴的交流方式", { exact: true }).click();
  const scopeResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/api/memories?itemId=frame") &&
      r.request().method() === "GET",
  );
  await center.getByLabel("应用范围").selectOption("frame");
  await scopeResponse;
  await center.getByLabel("开启我选择的陪伴交流").check();
  await center.getByLabel("称呼", { exact: true }).fill("小物");
  await center
    .getByRole("button", { name: "保存交流方式", exact: true })
    .click();
  const companion = page.getByRole("region", {
    name: "可选陪伴对话",
    exact: true,
  });
  await expect(companion).toBeVisible();
  await askIn(companion, "聊聊以前的故事");
  await expect(
    companion.locator(".conversation-message.assistant").last(),
  ).toContainText("毕业那天妈妈送的");
  await center
    .locator(".source-card")
    .filter({ hasText: "毕业那天妈妈送的" })
    .getByRole("button", { name: "忘记", exact: true })
    .click();
  await expect(
    center.locator(".source-card").filter({ hasText: "毕业那天妈妈送的" }),
  ).toHaveCount(0);
  await expect(companion).not.toContainText("毕业那天妈妈送的");
  await askIn(companion, "还记得以前的故事吗");
  await expect(companion).not.toContainText("毕业那天妈妈送的");
  const afterForget = await okay("/api/memories");
  assert.ok(
    !afterForget.memories.some((m) => m.text.includes("毕业那天妈妈送的")),
  );
  await center
    .getByRole("button", { name: "暂停自动整理", exact: true })
    .click();
  await expect(
    center.getByText("自动整理已暂停", { exact: false }),
  ).toBeVisible();
  assert.equal((await okay("/api/memories")).capture.enabled, false);
  await center
    .getByRole("button", { name: "恢复自动整理", exact: true })
    .click();
  await expect(
    center.getByText("自动整理已开启", { exact: false }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "artifacts/foundation-memory-mobile.png",
    fullPage: true,
  });
  await page.getByLabel("界面版本").selectOption("elder");
  await expect(
    page.getByRole("heading", { name: "不会用？在这里问。" }),
  ).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "artifacts/foundation-elder-mobile.png",
    fullPage: true,
  });
  await page.goto(base + "/guide");
  await expect(
    page.getByRole("heading", {
      name: "物间可以做什么，怎么开始？",
      exact: true,
    }),
  ).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "artifacts/ambient-guide-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "artifacts/ambient-guide-desktop.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
} catch (e) {
  await page.screenshot({
    path: "artifacts/foundation-failure.png",
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
}
const report = {
  kind: "isolated-api-and-edge-browser",
  passed: true,
  realModelCalls: 0,
  elapsedMs: Date.now() - started,
  checks: [
    "API scope/forget authorization",
    "persistent clarification",
    "tried-step feedback without repeat",
    "attach unregistered session without losing attempts",
    "previewed family summary with source context",
    "automatically extract latest useful method from feedback",
    "item story automatically extracts interest; present intent takes precedence",
    "optional companion grounded in own story",
    "forget removes old rendered and resumed story",
    "missing provider is explicit",
    "desktop/mobile/elder layout",
  ],
};
writeFileSync(
  "artifacts/foundation-integration.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
