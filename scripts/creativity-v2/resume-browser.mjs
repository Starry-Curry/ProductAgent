import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3207",
  dir = "artifacts/creativity-v2";
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  records = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const save = () =>
  fs.writeFileSync(
    dir + "/browser-resume.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        records,
        errors,
        physicalVerification: false,
      },
      null,
      2,
    ) + "\n",
  );
async function act(action, run, label) {
  const wait = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r
        .url()
        .endsWith(action === "assistant" ? "/api/assistant" : "/api/life") &&
      (action === "assistant" || r.request().postDataJSON()?.action === action),
    { timeout: 150000 },
  );
  await run();
  const r = await wait,
    d = await r.json();
  records.push({
    label,
    status: r.status(),
    input: r.request().postDataJSON(),
    result: d,
  });
  save();
  if (!r.ok()) throw Error(d.error || "http_" + r.status());
  return d;
}
try {
  await page.goto(base + "/#home");
  await page.locator(".apartment-item").filter({ hasText: "SAMLA" }).click();
  await page
    .getByRole("button", { name: "让它多一种可能", exact: true })
    .click();
  const current = await (
    await page.request.get(base + "/api/life", {
      headers: { "x-demo-actor": "lin" },
    })
  ).json();
  const direction = current.ideas.find(
    (i) => i.exploration && i.title.includes("地平线折叠"),
  );
  if (!direction) throw Error("recorded_direction_missing");
  let card = page
    .locator(".life-idea")
    .filter({
      has: page.getByRole("heading", { name: direction.title, exact: true }),
    });
  await page
    .getByRole("textbox", { name: "这次想怎样度过？", exact: true })
    .fill(
      "沿已选的地点串联方向，分析已有旅行纪念品的使用，不新增、不粘、不裁切；未知条件不要当成事实。",
    );
  const d = await act(
    "discover",
    () =>
      card
        .getByRole("button", { name: "深入这个方向 · 核对条件", exact: true })
        .click(),
    "selected-direction-after-fix",
  );
  if (!d.ideas?.length || !d.ideas[0].assessment)
    throw Error("no_condition_result");
  const deep = d.ideas[0];
  if (deep.assessment.level === "concept") expect(deep.steps).toEqual([]);
  card = page
    .locator(".life-idea")
    .filter({
      has: page.getByRole("heading", { name: deep.title, exact: true }),
    });
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/conditions-desktop.png" });
  const continued = await act(
    "assistant",
    () =>
      card.getByRole("button", { name: "带这个想法继续", exact: true }).click(),
    "selected-direction-to-unified-home",
  );
  expect(continued.reply.answer).toBeTruthy();
  await page
    .getByRole("region", { name: "物间统一对话", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/continued-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: dir + "/continued-mobile.png" });
  const size = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
  }));
  records.push({ label: "mobile-layout", ...size });
  expect(size.width).toBeLessThanOrEqual(size.viewport + 1);
  expect(errors).toEqual([]);
  records.push({ label: "software-flow-complete-not-creative-quality-proof" });
  console.log(
    JSON.stringify({
      passed: true,
      steps: records.map((r) => r.label),
      physicalVerification: false,
    }),
  );
} catch (e) {
  records.push({ label: "failure", error: e.message });
  process.exitCode = 1;
  console.error(e.message);
  await page.screenshot({ path: dir + "/resume-failure.png" }).catch(() => {});
} finally {
  save();
  await browser.close();
}
