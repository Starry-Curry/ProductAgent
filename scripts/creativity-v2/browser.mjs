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
    dir + "/browser.json",
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
async function api(action, run, label) {
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
  const consent = await page.request.post(base + "/api/life", {
    headers: { "x-demo-actor": "lin" },
    data: { action: "setVirtualHomeCloud", input: { allowCloud: true } },
  });
  if (!consent.ok()) throw Error("synthetic_home_consent_failed");
  await page.goto(base + "/#home");
  await expect(page.locator(".apartment-item")).toHaveCount(8);
  await page.locator(".apartment-item").filter({ hasText: "SAMLA" }).click();
  await page
    .getByRole("button", { name: "让它多一种可能", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /参考有出处的社区原理/ }),
  ).not.toBeChecked();
  const goal =
    "我想让这个SAMLA盒子变成旅行回忆的启发器。我喜欢安静写旅行手账，里面已有旅行纸质纪念品（这是模拟设定）。请自由探索不同于普通收纳的用法，不购买、不裁切、不粘贴，不假设自动弹出或识别功能，也不用额外纸笔手机。";
  await page
    .getByRole("textbox", { name: "这次想怎样度过？", exact: true })
    .fill(goal);
  const d = await api(
    "discover",
    () => page.getByRole("button", { name: "找点新灵感", exact: true }).click(),
    "open-exploration-real-plus",
  );
  if (!d.ideas?.length || !d.ideas[0].exploration)
    throw Error("missing_open_exploration");
  if (d.modelCalls !== 1) throw Error("unexpected_first_stage_call_count");
  let idea = d.ideas[0];
  let card = page
    .locator(".life-idea")
    .filter({
      has: page.getByRole("heading", { name: idea.title, exact: true }),
    });
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/explore-desktop.png" });
  await api(
    "ideaFeedback",
    () =>
      card.getByRole("button", { name: "收藏这个想法", exact: true }).click(),
    "save-exploration",
  );
  await api(
    "ideaFeedback",
    () =>
      card
        .getByRole("combobox", {
          name: idea.title + " 的尝试结果",
          exact: true,
        })
        .selectOption("不感兴趣"),
    "reject-direction-not-physical-trial",
  );
  await card.locator("details.idea-feedback > summary").click();
  const note = card.getByRole("textbox", {
    name: idea.title + " 的反馈内容",
    exact: true,
  });
  await note.fill(
    "合成反馈：不要再用随机抽签，改为按不同旅行地点串联纪念品，不新增材料。没有实物尝试。",
  );
  await api("ideaFeedback", () => note.blur(), "private-feedback-saved");
  // Sharing remains an explicit user action; no hidden opt-in.
  await page
    .getByRole("checkbox", {
      name: "本次允许把这些方案的反馈备注用于接下来的云端探索和对话",
      exact: true,
    })
    .check();
  const next = await api(
    "discover",
    () =>
      card
        .getByRole("button", { name: "按这条反馈重新探索", exact: true })
        .click(),
    "explicit-feedback-new-path",
  );
  if (!next.ideas?.length) throw Error("feedback_produced_no_direction");
  idea = next.ideas[0];
  card = page
    .locator(".life-idea")
    .filter({
      has: page.getByRole("heading", { name: idea.title, exact: true }),
    });
  await card.scrollIntoViewIfNeeded();
  await page.setViewportSize({ width: 390, height: 844 });
  await card
    .getByRole("heading", { name: idea.title, exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/explore-mobile.png" });
  const size = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
  }));
  records.push({ label: "mobile-layout", ...size });
  save();
  expect(size.width).toBeLessThanOrEqual(size.viewport + 1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const deeper = await api(
    "discover",
    () =>
      card
        .getByRole("button", { name: "深入这个方向 · 核对条件", exact: true })
        .click(),
    "selected-direction-conditions",
  );
  if (!deeper.ideas?.length || !deeper.ideas[0].assessment)
    throw Error("missing_selected_condition_result");
  const deep = deeper.ideas[0];
  card = page
    .locator(".life-idea")
    .filter({
      has: page.getByRole("heading", { name: deep.title, exact: true }),
    });
  if (deep.assessment.level === "concept") expect(deep.steps).toEqual([]);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/conditions-desktop.png" });
  // Only one selected direction is handed back; no implicit all-items requirement.
  const continued = await api(
    "assistant",
    () =>
      card.getByRole("button", { name: "带这个想法继续", exact: true }).click(),
    "back-to-unified-home",
  );
  await expect(
    page.getByRole("region", { name: "物间统一对话", exact: true }),
  ).toBeVisible();
  records.push({
    label: "returned-to-home-task",
    answer: continued.reply.answer,
  });
  await page.screenshot({ path: dir + "/continued-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: dir + "/continued-mobile.png" });
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      passed: true,
      steps: records.map((r) => r.label),
      physicalVerification: false,
    }),
  );
} catch (e) {
  records.push({ label: "failure", error: e.message });
  save();
  await page
    .screenshot({ path: dir + "/browser-failure.png", fullPage: true })
    .catch(() => {});
  process.exitCode = 1;
  console.error(e.message);
} finally {
  save();
  await browser.close();
}
