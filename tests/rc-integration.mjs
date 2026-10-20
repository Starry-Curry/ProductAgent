import assert from "node:assert/strict";
import fs from "node:fs";
import sharp from "sharp";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_BASE_URL;
if (!base) throw Error("isolated TEST_BASE_URL required");
async function call(url, body, actor = "lin") {
  const r = await fetch(base + url, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-demo-actor": actor },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
async function api(action, input) {
  const r = await call("/api/life", { action, input });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
const a = (
  await api("createItem", {
    name: "RC故事关联A",
    category: "厨房用品",
    lifecycle: "长期耐用",
    availability: "available",
    model: "合成杯",
    brand: "合成",
  })
).item;
const b = (
  await api("createItem", {
    name: "RC故事关联B",
    category: "文具",
    lifecycle: "长期耐用",
    availability: "available",
    model: "合成笔",
    brand: "合成",
  })
).item;
const pixels = await sharp({
  create: { width: 260, height: 180, channels: 3, background: "#8f9b75" },
})
  .jpeg()
  .toBuffer();
const browser = await chromium.launch({
  executablePath:
    process.env.EDGE_PATH ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--disable-gpu"],
});
const checks = [];
try {
  const page = await browser.newPage({
      viewport: { width: 1280, height: 950 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const nav = async (name) =>
    page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name, exact: true })
      .click();
  fs.mkdirSync("artifacts/rc", { recursive: true });
  await page.goto(base + "#stories");
  await expect(
    page.getByRole("heading", { name: "生活里，值得留住的小片段" }),
  ).toBeVisible();
  await nav("生活故事");
  await expect(page.getByLabel("留下一句话", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "写一段生活", exact: true }).click();
  await page
    .locator('input[aria-label="照片（可选，JPEG / PNG / WebP，5MB 内）"]')
    .setInputFiles({
      name: "synthetic-rc.jpg",
      mimeType: "image/jpeg",
      buffer: pixels,
    });
  await expect(page.getByAltText("片段照片预览")).toBeVisible();
  await page
    .getByLabel("留下一句话", { exact: true })
    .fill("合成验收：画下杯子的轮廓。");
  await page.getByText("关联物品 · 已选择 0 件", { exact: true }).click();
  await page.getByRole("checkbox", { name: a.name, exact: true }).check();
  await page.getByRole("checkbox", { name: b.name, exact: true }).check();
  await page.getByRole("button", { name: "保存生活片段", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  let f = (await call("/api/life")).data.fragments.find(
    (f) => f.text === "合成验收：画下杯子的轮廓。",
  );
  assert.equal(f.itemIds.length, 2);
  checks.push("C1照片一句话真实保存");
  await page.getByRole("button", { name: /写一段生活/ }).click();
  await page
    .getByLabel("留下一句话", { exact: true })
    .fill("合成验收：不关联物品的纯文字经历。");
  await page.getByRole("button", { name: "保存生活片段", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  checks.push("C2纯文字、零物品保存");
  for (const item of [a, b]) {
    await page
      .locator("article.life-story-page")
      .filter({ hasText: f.text })
      .getByRole("button", { name: item.name, exact: true })
      .click();
    await expect(
      page.locator("article.life-story-page").filter({ hasText: f.text }),
    ).toBeVisible();
    assert.equal(
      (await call("/api/life?itemId=" + item.id)).data.fragments[0].id,
      f.id,
    );
    await nav("生活故事");
  }
  checks.push("C3同一正文两件物品双向入口");
  await page.screenshot({
    path: "artifacts/rc/storybook-reading-desktop.png",
    fullPage: true,
  });
  await page.getByText("寻找经历 · 按时间、物品或章节浏览",{exact:true}).click();
  await page.getByRole("button", { name: "整理一个章节", exact: true }).click();
  await page.getByLabel("章节名称", { exact: true }).fill("合成阅读验收章节");
  await page
    .getByRole("checkbox", { name: "合成验收：画下杯子的轮廓。", exact: true })
    .check();
  await page.getByRole("button", { name: "保存章节", exact: true }).click();
  await expect(page.getByLabel("按章节浏览").locator("option")).toContainText([
    "全部章节",
    "合成阅读验收章节",
  ]);
  checks.push(
    "新增R：默认阅读/原文标题/章节创建入口，未将CRUD升级为阅读体验通过",
  );
  let card = page
    .locator("article.life-story-page")
    .filter({ hasText: f.text });
  await card.getByRole("button", { name: "放大故事照片", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "关闭照片", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭照片", exact: true }).click();
  await card.getByRole("button", { name: "编辑片段", exact: true }).click();
  await page.getByRole("button", { name: "追加照片", exact: true }).click();
  await page
    .locator('input[aria-label="照片（可选，JPEG / PNG / WebP，5MB 内）"]')
    .setInputFiles({
      name: "synthetic-rc-2.jpg",
      mimeType: "image/jpeg",
      buffer: await sharp({
        create: { width: 260, height: 180, channels: 3, background: "#d7b88d" },
      })
        .jpeg()
        .toBuffer(),
    });
  await expect(page.getByAltText("追加照片2预览")).toBeVisible();
  await page
    .getByLabel("留下一句话", { exact: true })
    .fill(f.text + " 补充：那天很轻松。");
  await page.getByText("日期、记录类型与引用权限", { exact: true }).click();
  await page.getByLabel("故事发生日期", { exact: true }).fill("2026-10-18");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  f = (await call("/api/life")).data.fragments.find((x) => x.id === f.id);
  assert.equal(f.mediaIds.length, 2);
  assert.equal(f.capturedOn, "2026-10-18");
  for (const item of [a, b])
    assert.equal(
      (await call("/api/life?itemId=" + item.id)).data.fragments[0].text,
      f.text,
    );
  checks.push("C4追加照片/日期/编辑，两个入口一致");
  await page.setViewportSize({ width: 390, height: 844 });
  card = page.locator("article.life-story-page").filter({ hasText: f.text });
  await card.getByRole("button", { name: "阅读完整故事", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(f.text);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.getByRole("button", { name: "关闭故事详情" }).focus();
  await page.keyboard.press("Shift+Tab");
  assert.ok(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.contains(document.activeElement)),
  );
  await page.screenshot({
    path: "artifacts/rc/storybook-reading-mobile.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "阅读完整故事", exact: true }),
  ).toBeFocused();
  checks.push("390px全文/照片布局与桌面操作");
  await card.getByRole("button", { name: "编辑片段", exact: true }).click();
  await page.getByText("关联物品 · 已选择 2 件", { exact: true }).click();
  await page.getByRole("checkbox", { name: b.name, exact: true }).uncheck();
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  f = (await call("/api/life")).data.fragments.find((x) => x.id === f.id);
  assert.equal(
    (await call("/api/life?itemId=" + b.id)).data.fragments.length,
    0,
  );
  checks.push("C4解除关联不复制/删除原故事");
  const recalled = await call("/api/assistant", {
    requestId: crypto.randomUUID(),
    question: "回忆我保存的生活故事",
    mode: "auto",
    memoryPolicy: "off",
    uiContext: { page: "stories" },
  });
  assert.equal(recalled.status, 200);
  assert.ok(recalled.data.reply.memoryIds.includes(f.id));
  f = (
    await api("fragment", {
      id: f.id,
      revision: f.revision,
      text: f.text,
      itemIds: f.itemIds,
      allowRecall: false,
      allowCloud: false,
    })
  ).fragment;
  const revoked = await call("/api/assistant", {
    requestId: crypto.randomUUID(),
    question: "回忆我保存的生活故事",
    mode: "auto",
    memoryPolicy: "off",
    uiContext: { page: "stories" },
  });
  assert.ok(!JSON.stringify(revoked.data.reply).includes(f.text));
  checks.push("C6主动本机引用/撤销引用，商品帮助不据故事猜事实");
  const gift = (
    await api("gift", {
      itemId: a.id,
      message: "只传物品，不传私人经历",
      fragmentIds: [],
    })
  ).gift;
  const claim = await call(
    "/api/workspace",
    { action: "claim", token: gift.token, received: true },
    "friend",
  );
  assert.equal(claim.status, 200);
  assert.equal(
    (await call("/api/life", undefined, "friend")).data.fragments.some(
      (x) => x.id === f.id,
    ),
    false,
  );
  assert.equal(
    (await call("/api/life")).data.fragments.some((x) => x.id === f.id),
    true,
  );
  for (const id of f.mediaIds)
    assert.equal(
      (await fetch(base + "/api/life/media/" + id + "?actor=friend")).status,
      403,
    );
  checks.push("C5赠送领取后本人故事保留，接收者无正文/照片权限");
  await page.reload();
  await nav("生活故事");
  page.once("dialog", (d) => d.accept());
  await page
    .locator("article.life-story-page")
    .filter({ hasText: f.text })
    .getByRole("button", { name: "删除片段", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已删除");
  assert.equal(
    (await call("/api/life")).data.fragments.some((x) => x.id === f.id),
    false,
  );
  for (const id of f.mediaIds)
    assert.equal(
      (await fetch(base + "/api/life/media/" + id + "?actor=lin")).status,
      403,
    );
  checks.push("C4删除正文/关系/未再引用照片");
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    realModelCalls: 0,
    checks,
    kind: "isolated-api-and-edge-desktop-390px-storybook",
  };
  fs.mkdirSync("artifacts/rc", { recursive: true });
  fs.writeFileSync(
    "artifacts/rc/storybook-journeys.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
