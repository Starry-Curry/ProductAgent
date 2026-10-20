import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_BASE_URL;
if (!base)
  throw Error("Set TEST_BASE_URL to the isolated life acceptance server");
const actor = "lin";
async function api(action, input = {}, who = actor) {
  const top = ["demo", "code", "lookup", "fetchSource"].includes(action);
  const r = await fetch(base + "/api/life", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-demo-actor": who },
    body: JSON.stringify(top ? { action, ...input } : { action, input }),
  });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  return d;
}
async function call(route, body, who = actor, method = body ? "POST" : "GET") {
  const r = await fetch(base + route, {
    method,
    headers: { "Content-Type": "application/json", "x-demo-actor": who },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
async function upload(bytes, name, kind, type) {
  const f = new FormData();
  f.set("kind", kind);
  f.set("file", new File([bytes], name, { type }));
  const r = await fetch(base + "/api/life", {
    method: "POST",
    headers: { "x-demo-actor": actor },
    body: f,
  });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  return d;
}
const checks = [];
await api("demo", { confirmed: true });
const initial = (await call("/api/life")).data;
assert.equal(initial.stats.items, 25);
assert.equal(initial.stats.packs, 11);
assert.equal(initial.stats.facts, 33);
const pixels = await sharp({
  create: { width: 180, height: 130, channels: 3, background: "#899b72" },
})
  .jpeg()
  .toBuffer();
const photo = await upload(
  pixels,
  "synthetic-photo.jpg",
  "photo",
  "image/jpeg",
);
const item = (
  await api("createItem", {
    name: "验收新台灯",
    brand: "测试品牌",
    model: "用户测试 · 型号未知",
    category: "照明",
    lifecycle: "长期耐用",
    availability: "available",
    attributes: { quantity: 1, capabilities: ["照明"] },
    mediaId: photo.id,
  })
).item;
const frame = (
  await api("createItem", {
    name: "验收相框",
    brand: "",
    model: "无型号",
    category: "相框",
    lifecycle: "可重复使用",
    availability: "available",
    attributes: { quantity: 1 },
  })
).item;
const mouse = (
  await api("createItem", {
    name: "验收 M185",
    brand: "Logitech",
    model: "M-R0061",
    category: "电子设备",
    lifecycle: "长期耐用",
    availability: "available",
    packId: "logitech-m185-m-r0061",
    confirmed: true,
  })
).item;
checks.push("A: 新建照片物品、类别/能力/状态与确认型号绑定");
const manual = await upload(
  new TextEncoder().encode(
    "清洁要求：请先断开电源，再使用干燥软布擦拭外表。只适用于测试说明书。",
  ),
  "synthetic-manual.txt",
  "manual",
  "text/plain",
);
await api("source", {
  itemId: item.id,
  title: manual.title,
  text: manual.text,
  kind: manual.kind,
});
const sourceAnswer = await call("/api/assistant", {
  itemId: item.id,
  question: "清洁要求",
  mode: "service",
  memoryPolicy: "off",
  requestId: crypto.randomUUID(),
});
assert.equal(sourceAnswer.status, 200);
assert.match(sourceAnswer.data.reply.answer, /干燥软布/);
assert.equal(sourceAnswer.data.reply.citations[0].kind, "user_report");
const answer = await call("/api/assistant", {
  itemId: mouse.id,
  question: "电池规格是什么",
  mode: "service",
  memoryPolicy: "off",
  requestId: crypto.randomUUID(),
});
assert.equal(answer.status, 200);
assert.match(answer.data.reply.answer, /AA/);
assert.equal(answer.data.modelCalls, 0);
const feedback = await call("/api/assistant", {
  action: "feedback",
  input: {
    sessionId: answer.data.session.id,
    requestId: crypto.randomUUID(),
    outcome: "completed",
  },
});
assert.equal(feedback.status, 200);
checks.push("B: 官方 AA 电池资料、用户说明书摘录与本人结果反馈（0 模型调用）");
const ideas = (
  await api("discover", {
    goal: "安静摄影",
    itemId: item.id,
    minutes: 20,
    includeSynthetic: false,
  })
).ideas;
assert.ok(ideas.length > 0);
assert.ok(ideas[0].itemIds.includes(item.id));
await api("ideaFeedback", {
  id: ideas[0].id,
  saved: true,
  outcome: "准备尝试",
  note: "合成测试，尚未实物验证",
});
await api("updateItem", { itemId: item.id, availability: "loaned" });
const changed = await call("/api/life", {
  action: "ideaFeedback",
  input: { id: ideas[0].id, saved: true, outcome: "用户报告有效" },
});
assert.equal(changed.status, 409);
await api("updateItem", { itemId: item.id, availability: "available" });
checks.push("C: 新物品参与组合、收藏与尝试、状态变化阻止旧方案执行");
const storyPhoto = await upload(
  pixels,
  "synthetic-story.jpg",
  "photo",
  "image/jpeg",
);
const fragment = (
  await api("fragment", {
    text: "合成验收：第一次给相框拍生活照",
    itemIds: [item.id, frame.id],
    mediaId: storyPhoto.id,
  })
).fragment;
for (const id of [item.id, frame.id])
  assert.equal(
    (await call(`/api/life?itemId=${id}`)).data.fragments[0].id,
    fragment.id,
  );
assert.equal(
  (await fetch(base + `/api/life/media/${storyPhoto.id}?actor=dad`)).status,
  403,
);
const corrected = (
  await api("fragment", {
    id: fragment.id,
    revision: fragment.revision,
    text: "合成验收：更正后的生活照",
    itemIds: [frame.id],
    mediaId: storyPhoto.id,
  })
).fragment;
assert.equal(
  (await call(`/api/life?itemId=${item.id}`)).data.fragments.length,
  0,
);
const gift = (
  await api("gift", {
    itemId: frame.id,
    message: "合成验收礼物",
    fragmentIds: [fragment.id],
  })
).gift;
assert.equal(gift.storySnapshots[0].author, "lin");
await api("deleteFragment", { id: fragment.id, revision: corrected.revision });
assert.equal(
  (await fetch(base + `/api/life/media/${storyPhoto.id}?actor=lin`)).status,
  403,
);
checks.push("D: 图文保存、双物品唯一原文、编辑解除关联、越权拒绝及删除照片");
await api("updateItem", { itemId: item.id, shared: true });
const task = await call("/api/workspace", {
  action: "quickTask",
  itemId: item.id,
  title: "合成验收：擦拭台灯",
  kind: "clean",
  assignee: "dad",
  requestId: crypto.randomUUID(),
});
assert.equal(task.status, 200);
const taskId = task.data.tasks.at(-1).id;
assert.equal(
  (
    await call(
      "/api/workspace",
      { action: "task", taskId, status: "进行中", text: "已接手（合成验收）" },
      "dad",
    )
  ).status,
  200,
);
checks.push("E: 共享物品、创建家庭事项、另一演示成员实际接手");
mkdirSync("artifacts/life", { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.EDGE_PATH ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--disable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base);
  await expect(page.getByRole("heading", { name: /物有所用/ })).toBeVisible();
  await page.screenshot({
    path: "artifacts/life/home-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "物品展柜", exact: true })
    .click();
  await page.getByRole("textbox", { name: "搜索物品" }).fill("验收 M185");
  await page.getByRole("button", { name: /验收 M185/ }).click();
  await page
    .getByRole("textbox", { name: "对物间说", exact: true })
    .fill("电池规格是什么");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText("电源为一节可更换 AA 电池。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "在问物间继续", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "问物间", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("电源为一节可更换 AA 电池。", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "对物间说", exact: true })
    .fill("电池规格是什么");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText("电源为一节可更换 AA 电池。", { exact: true }),
  ).toHaveCount(2);
  await page.locator(".life-ai-settings > summary").click();
  await page.getByLabel("使用自定义称呼与交流风格").check();
  await page.getByLabel("物间的称呼", { exact: true }).fill("测试小间");
  await page.getByLabel("个人记忆引用", { exact: true }).selectOption("off");
  await page.getByRole("button", { name: "保存交流设置", exact: true }).click();
  await expect(page.getByText(/交流设置已保存/)).toBeVisible();
  await page
    .getByRole("button", { name: "切换到普通聊天", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "对物间说", exact: true })
    .fill("你好");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText("我在。想聊什么都可以，也可以一起解决手边的问题。", {
      exact: true,
    }),
  ).toBeVisible();
  checks.push(
    "统一入口保留物品会话并连续问答；Persona保存保留历史，可切换普通聊天",
  );
  await page.screenshot({
    path: "artifacts/life/item-help-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "生活故事", exact: true })
    .click();
  await page
    .getByLabel("留下一句话", { exact: true })
    .fill("浏览器合成验收：一段生活片段");
  await page.getByRole("button", { name: "保存生活片段", exact: true }).click();
  await expect(
    page.getByText("浏览器合成验收：一段生活片段", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "生活故事", exact: true })
    .click();
  await expect(
    page.getByText("浏览器合成验收：一段生活片段", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "发现新玩法", exact: true })
    .click();
  await expect(page.getByLabel("包含合成演示物品")).not.toBeChecked();
  await page.locator(".composer-toolbar > details > summary").click();
  await page.getByLabel("包含合成演示物品").check();
  await page.locator(".composer-toolbar > details > summary").click();
  await page.getByRole("button", { name: "找点新灵感", exact: true }).click();
  await expect(
    page.getByText("本地创意候选 · 未实物验证").first(),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/life/discovery-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "更有趣一点", exact: true }).click();
  await expect(page.locator(".discovery-thread .goal-message")).toHaveCount(2);
  await page.getByRole("button", { name: "家庭", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "家里的事，一起接着做", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "礼物与故事传递", exact: true }),
  ).toHaveCount(0);
  const task = page
    .locator(".life-family .simple-task")
    .filter({
      has: page.getByRole("button", { name: "我已完成", exact: true }),
    })
    .first();
  const title = await task.locator("h3").innerText();
  await task.getByRole("button", { name: "我已完成", exact: true }).click();
  await page.getByRole("button", { name: "已完成", exact: true }).click();
  await expect(
    page.locator(".completed-tasks").getByText(title, { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/life/family-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "社交", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "礼物与故事传递", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/life/social-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "生活首页", exact: true }).click();
  await page
    .getByRole("textbox", { name: "随时问物间", exact: true })
    .fill("这个App怎么用");
  await page.getByRole("button", { name: "开始对话", exact: true }).click();
  await expect(
    page.getByText(/家庭页管理共享事项；社交页查看礼物/),
  ).toBeVisible();
  checks.push(
    "新版产品路径：目标对话连续修改、家庭完成状态、社交礼物独立、首页提问App指南",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: /物有所用/ })).toBeVisible();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile horizontal overflow",
  );
  await page.screenshot({
    path: "artifacts/life/home-mobile.png",
    fullPage: true,
  });
  for (const name of ["发现新玩法", "家庭", "社交", "生活故事"]) {
    await page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name, exact: true })
      .click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      name + " mobile overflow",
    );
  }
  assert.deepEqual(errors, []);
  checks.push("浏览器：展柜→物品问答、故事保存刷新、创意生成、390px 无横溢出");
} finally {
  await browser.close();
}
const report = {
  passed: true,
  measuredAt: new Date().toISOString(),
  kind: "isolated-api-and-edge-acceptance",
  checks,
  baseline: initial.stats,
  createdItems: 3,
  realModelCalls: 0,
  limits:
    "所有新增数据为合成验收数据；规则候选不是模型或实物验证。未进行付费模型、视觉识物、真人研究或真实家庭同步。",
};
writeFileSync(
  "artifacts/life/acceptance.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
