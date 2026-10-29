import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3204",
  dir = "artifacts/continuous-experience";
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } }),
  records = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const stamp = Date.now();
const save = () =>
  fs.writeFileSync(
    `${dir}/browser-${stamp}.json`,
    JSON.stringify({ at: new Date().toISOString(), records, errors }, null, 2),
  );
async function api(action, run, label) {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r
        .url()
        .endsWith(action === "assistant" ? "/api/assistant" : "/api/life") &&
      (action === "assistant"
        ? !!r.request().postDataJSON()?.question
        : r.request().postDataJSON()?.action === action),
    { timeout: 150000 },
  );
  await run();
  const r = await response,
    d = await r.json();
  records.push({
    label,
    status: r.status(),
    input: r.request().postDataJSON(),
    result: d,
  });
  save();
  if (!r.ok()) throw Error(d.error || `http_${r.status()}`);
  return d;
}
async function send(q, label) {
  const region = page.getByRole("region", {
    name: "物间统一对话",
    exact: true,
  });
  return api(
    "assistant",
    async () => {
      await region
        .getByRole("textbox", { name: "对物间说", exact: true })
        .fill(q);
      await region.getByRole("button", { name: "发送", exact: true }).click();
    },
    label,
  );
}
try {
  await page.goto(base + "/#home");
  await expect(page.locator(".apartment-item")).toHaveCount(8);
  await page.screenshot({ path: dir + "/home-desktop.png", fullPage: true });
  let a, b;
  if (process.argv.includes("--recreation-only")) {
    a = await api(
      "assistant",
      () => page.getByRole("button", { name: /今晚，写一页旅行手账/ }).click(),
      "life-goal-retry",
    );
    b = a;
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeEnabled({ timeout: 10000 });
  } else {
    a = await api(
      "assistant",
      () => page.getByRole("button", { name: /今晚，写一页旅行手账/ }).click(),
      "life-goal",
    );
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeEnabled({ timeout: 10000 });
    b = await send(
      "先不写手账了，改成只整理旅行票据。不要用台灯、不买东西，请调整计划，别重复原来的灯光建议。",
      "goal-change",
    );
  }
  if (a.session.id !== b.session.id) throw Error("goal_change_lost_session");
  await page.screenshot({
    path: dir + "/goal-change-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "生活首页", exact: true })
    .click();
  await page.locator(".apartment-item").filter({ hasText: "SAMLA" }).click();
  await page
    .getByRole("button", { name: "让它多一种可能", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "这件物品的新可能" }),
  ).toBeVisible();
  const q =
    "我喜欢安静地写旅行手账，但每晚总不知道从哪段回忆开始。SAMLA盒里已有旅行纸质纪念品，希望这个盒子能帮助我做出选择，而不是继续收纳或纯观察。不购买、不裁切、不粘贴，不用纸笔或手机等未登记材料，不依赖投影、自动识别和设备自动化。可以只用一部分已有物品。";
  await page
    .getByRole("textbox", { name: "这次想怎样度过？", exact: true })
    .fill(q);
  const d = await api(
    "discover",
    () => page.getByRole("button", { name: "找点新灵感", exact: true }).click(),
    "object-recreation",
  );
  await page.screenshot({
    path: dir + "/recreation-desktop.png",
    fullPage: true,
  });
  if (!d.ideas?.length) throw Error("real_model_returned_no_publishable_idea");
  const idea = d.ideas[0],
    card = page.locator(".life-idea").filter({
      has: page.getByRole("heading", { name: idea.title, exact: true }),
    });
  await api(
    "ideaFeedback",
    () =>
      card.getByRole("button", { name: "收藏这个想法", exact: true }).click(),
    "save-idea",
  );
  await api(
    "ideaFeedback",
    () =>
      card
        .getByRole("combobox", {
          name: idea.title + " 的尝试结果",
          exact: true,
        })
        .selectOption("准备尝试"),
    "intend-to-try-not-physical-proof",
  );
  await card.locator("details.idea-feedback > summary").click();
  const feedback = card.getByRole("textbox", {
    name: idea.title + " 的反馈内容",
    exact: true,
  });
  await feedback.fill(
    "模拟反馈：我还想减少桌面占用，请不要再增加其他物品。本次只完成软件体验，尚未实物尝试。",
  );
  await api("ideaFeedback", () => feedback.blur(), "user-feedback");
  await card
    .locator("details")
    .filter({
      has: page.locator("summary").filter({ hasText: "为什么这样用" }),
    })
    .first()
    .locator("summary")
    .click();
  await page.screenshot({
    path: dir + "/recreation-with-feedback-desktop.png",
    fullPage: true,
  });
  await page
    .getByLabel("本次允许把这些方案的反馈备注用于接下来的云端探索和对话")
    .check();
  const continued = await api(
    "assistant",
    () =>
      page
        .getByRole("button", {
          name: "带着目标与方案，继续问物间",
          exact: true,
        })
        .click(),
    "creative-plan-to-unified-task",
  );
  if (continued.session.id !== b.session.id)
    throw Error("creative_handoff_lost_original_mission");
  records.push({
    label: "plan-handoff",
    usedItemIds: continued.reply.usedItems?.map((i) => i.id),
    answer: continued.reply.answer,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: dir + "/unified-mobile.png", fullPage: true });
  await page.goto(base + "/#home");
  await expect(page.locator(".apartment-item")).toHaveCount(8);
  await page.screenshot({ path: dir + "/home-mobile.png", fullPage: true });
  await page.locator(".apartment-item").filter({ hasText: "SAMLA" }).click();
  await page
    .getByRole("button", { name: "让它多一种可能", exact: true })
    .click();
  await page.getByRole("button", { name: "我的收藏", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: idea.title, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: dir + "/recreation-mobile.png",
    fullPage: true,
  });
  const size = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
  }));
  records.push({ label: "mobile-layout", ...size });
  expect(size.width).toBeLessThanOrEqual(size.viewport + 1);
  expect(errors).toEqual([]);
} catch (e) {
  records.push({ failure: e.message });
  await page.screenshot({ path: dir + "/browser-failure.png", fullPage: true });
  process.exitCode = 1;
} finally {
  save();
  await browser.close();
}
