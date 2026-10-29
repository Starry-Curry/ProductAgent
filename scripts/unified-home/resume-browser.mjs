import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const dir = "artifacts/continuous-experience",
  base = "http://127.0.0.1:3204";
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } }),
  records = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function change(action, fn) {
  const promise = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.request().postDataJSON()?.action === action,
    { timeout: 15000 },
  );
  await fn();
  const r = await promise;
  const result = await r.json();
  records.push({ action, status: r.status(), result });
  if (!r.ok()) throw Error(result.error);
}
try {
  await page.goto(base + "/#assistant");
  await expect(page.locator(".home-task-caption").first()).toBeVisible();
  const s = await (
    await page.request.get(base + "/api/assistant?mode=auto&scope=all", {
      headers: { "x-demo-actor": "lin" },
    })
  ).json();
  const original = s.sessions.find((s) => s.known.homeId && !s.itemId);
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "生活首页", exact: true })
    .click();
  await page.screenshot({ path: dir + "/home-desktop.png", fullPage: true });
  await page.locator(".apartment-item").filter({ hasText: "SAMLA" }).click();
  await page
    .getByRole("button", { name: "让它多一种可能", exact: true })
    .click();
  await page.getByRole("button", { name: "我的收藏", exact: true }).click();
  const card = page.locator(".life-idea").filter({ hasText: "盒体微倾抽签法" });
  await expect(card).toHaveCount(1);
  await change("ideaFeedback", () =>
    card.getByRole("combobox").selectOption("不感兴趣"),
  );
  await card.locator("details.idea-feedback > summary").click();
  const note = card.getByRole("textbox");
  await note.fill(
    "研发复核：这个方案不采用。盒高14cm，轻抬5–8度不保证纸片越过盒口，聚丙烯也不证明会按步骤回弹。不要重复弹出或旋转盒盖的机制；我宁愿开盖直接挑一件纪念品讲述，不要增加物品。本次未进行实物试验。",
  );
  await change("ideaFeedback", () => note.blur());
  await page
    .getByLabel("本次允许把这些方案的反馈备注用于接下来的云端探索和对话")
    .check();
  await page.screenshot({
    path: dir + "/recreation-reviewed-desktop.png",
    fullPage: true,
  });
  const wait = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/assistant") &&
      r.request().method() === "POST" &&
      r.request().postDataJSON()?.question,
    { timeout: 120000 },
  );
  await card
    .getByRole("button", { name: "带这个想法继续", exact: true })
    .click();
  const r = await wait,
    d = await r.json();
  const input = r.request().postDataJSON();
  records.push({
    case: "explicit-idea-and-rejection-back-to-original-task",
    status: r.status(),
    input,
    result: d,
  });
  expect(r.ok()).toBeTruthy();
  expect(d.session.id).toBe(original.id);
  expect(input.uiContext.planContext.previousIdeaIds).toHaveLength(1);
  expect(input.uiContext.planContext.feedbackIdeaIds).toHaveLength(1);
  expect(JSON.parse(d.session.known.lifeIdeaIds)).toEqual(
    input.uiContext.planContext.previousIdeaIds,
  );
  await page.screenshot({
    path: dir + "/feedback-in-unified-task-desktop.png",
    fullPage: true,
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
    page.getByRole("heading", { name: "盒体微倾抽签法", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: dir + "/recreation-mobile.png",
    fullPage: true,
  });
  const size = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  records.push({ case: "mobile-layout", ...size });
  expect(size.width).toBeLessThanOrEqual(size.viewport + 1);
  expect(errors).toEqual([]);
} catch (e) {
  records.push({ failure: e.message });
  await page.screenshot({ path: dir + "/resume-failure.png", fullPage: true });
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    dir + "/browser-final.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        records,
        errors,
        quality:
          "Software handoff test; the generated physical mechanism was independently rejected, not verified.",
      },
      null,
      2,
    ),
  );
  await browser.close();
}
