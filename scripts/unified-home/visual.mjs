import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const dir = "artifacts/continuous-experience",
  browser = await chromium.launch({
    executablePath:
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
  });
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let generationRequests = 0;
page.on("request", (r) => {
  if (
    r.method() === "POST" &&
    (r.url().endsWith("/api/assistant") ||
      r.postDataJSON()?.action === "discover")
  )
    generationRequests++;
});
try {
  await page.goto("http://127.0.0.1:3204/#home");
  await expect(page.locator(".apartment-item")).toHaveCount(8);
  await expect(page.locator("#home-question")).toHaveValue("");
  const positions = await page.evaluate(() => ({
    input: document.querySelector("#home-question").getBoundingClientRect().top,
    items: document.querySelector(".apartment-items").getBoundingClientRect()
      .top,
  }));
  expect(positions.input).toBeLessThan(positions.items);
  await page.screenshot({ path: dir + "/home-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: dir + "/home-mobile.png", fullPage: true });
  await page.screenshot({ path: dir + "/home-mobile-viewport.png" });
  await page.locator(".apartment-item").filter({ hasText: "SAMLA" }).click();
  await page
    .getByRole("button", { name: "让它多一种可能", exact: true })
    .click();
  await page.getByRole("button", { name: "我的收藏", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "盒体微倾抽签法", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", {
      name: "盒体微倾抽签法 的尝试结果",
      exact: true,
    }),
  ).toHaveValue("不感兴趣");
  await page.screenshot({
    path: dir + "/recreation-mobile.png",
    fullPage: true,
  });
  await page.locator(".object-reimagine").scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/exploration-mobile-viewport.png" });
  const size = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(size.width).toBeLessThanOrEqual(size.viewport + 1);
  expect(errors).toEqual([]);
  expect(generationRequests).toBe(0);
  fs.writeFileSync(
    dir + "/visual-final.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        positions,
        size,
        errors,
        generationRequests,
        modelMode:
          "disabled; prior genuine history and synthetic household remain visible",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
