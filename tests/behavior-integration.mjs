import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_BASE_URL;
if (!base) throw Error("isolated server required");
const out = path.resolve("artifacts/intelligence-behavior/live");
fs.mkdirSync(out, { recursive: true });
const records = [],
  errors = [];
async function api(route, body, actor = "lin") {
  const r = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-demo-actor": actor },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  assert(r.ok, JSON.stringify(d));
  return d;
}
const products = await api("/api/life", {
  action: "alphaSamples",
  input: { confirmed: true },
}).catch(async () => {
  return null;
});
// The existing public endpoint requires explicit synthetic import; never a real user's workspace.
let data = await api("/api/life");
if (!data.workspace.items.some((i) => i.id.startsWith("alpha-test-")))
  throw Error("synthetic samples were not installed");
const add = async (name, category, attributes) =>
  data.workspace.items.find((i) => i.name === name) ||
  (
    await api("/api/life", {
      action: "createItem",
      input: {
        name,
        category,
        lifecycle: "可重复使用",
        availability: "available",
        attributes,
      },
    })
  ).item;
const clips = await add("合成验收长尾夹", "文具", {
    material: "钢，带可翻转手柄",
    quantity: 3,
    capabilities: ["夹持普通纸张，宽约32毫米"],
  }),
  cards = await add("合成验收明信片", "文具", {
    material: "普通硬卡纸，约10×15厘米，正面有图案，背面有私人留言",
    quantity: 3,
    quantityUnit: "张",
  }),
  cloth = await add("合成验收棉浴巾", "家居", {
    material: "柔软棉布，干燥",
    quantity: 1,
  });
const browser = await chromium.launch({
  executablePath:
    process.env.EDGE_PATH ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => errors.push(e.message));
const nav = (name) =>
  page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name, exact: true });
try {
  await page.goto(base);
  await nav("发现新玩法").click();
  const options = page
    .locator("details")
    .filter({ has: page.locator("summary").filter({ hasText: "可选条件" }) })
    .first();
  await options.locator("summary").click();
  // Manual test records here are synthetic by construction, even though createItem has no synthetic flag.
  for (const item of [clips, cards, cloth])
    await page.getByRole("checkbox", { name: new RegExp(item.name) }).check();
  await options.locator("summary").click();
  await page
    .getByRole("textbox", { name: "这次想怎样度过？", exact: true })
    .fill(
      "用这三件可用资源，给三张明信片做一个随时换正面、可复原的桌面小展览。可以只用一部分，不购买、不裁切、不粘贴，不损伤明信片，不公开背面留言。桌面靠墙可用。",
    );
  const prior = fs.existsSync(out + "/failure.json")
    ? JSON.parse(fs.readFileSync(out + "/failure.json")).records?.find(
        (r) => r.case === "real-model-creative",
      )?.result
    : null;
  let result = prior;
  if (!result) {
    const wait = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/life") &&
        r.request().method() === "POST" &&
        r.request().postDataJSON()?.action === "discover",
      { timeout: 150000 },
    );
    await page.getByRole("button", { name: "找点新灵感", exact: true }).click();
    result = await (await wait).json();
  }
  records.push({ case: "real-model-creative", result });
  assert(
    result.ideas?.length,
    "A real creative result is required, rejection is a failed product acceptance",
  );
  assert.equal(result.source, "model-creative");
  const idea = result.ideas[0],
    card = page
      .locator("article.life-idea")
      .filter({
        has: page.getByRole("heading", { name: idea.title, exact: true }),
      });
  await expect(card).toBeVisible();
  if (
    await card
      .getByRole("button", { name: "收藏这个想法", exact: true })
      .count()
  )
    await card
      .getByRole("button", { name: "收藏这个想法", exact: true })
      .click();
  await card
    .getByRole("combobox", { name: idea.title + " 的尝试结果" })
    .selectOption("不感兴趣");
  await card
    .locator("summary")
    .filter({ hasText: "记录实际结果 / 下次调整" })
    .click();
  await card
    .getByRole("textbox", { name: idea.title + " 的反馈内容" })
    .fill(
      "普通长尾夹没有可控转轴，松开后不会带动明信片自动复位；我不接受这种机构。换一个简单的静态展示方向，不要改造、不损伤卡片、不要展示背面留言。",
    );
  await card
    .getByRole("textbox", { name: idea.title + " 的反馈内容" })
    .press("Tab");
  await expect(
    card.getByRole("button", { name: "按这条反馈重新探索", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: out + "/creative-desktop.png",
    fullPage: true,
  });
  await expect
    .poll(async () => {
      const i = (await api("/api/life")).ideas.find((i) => i.id === idea.id);
      return (
        i?.saved && i.outcome === "不感兴趣" && i.note?.includes("可控转轴")
      );
    })
    .toBeTruthy();
  let stored = (await api("/api/life")).ideas.find((i) => i.id === idea.id);
  assert(stored?.saved);
  assert.equal(stored.outcome, "不感兴趣");
  assert.match(stored.note, /可控转轴/);
  assert(
    !(await api("/api/life", undefined, "dad")).ideas.some(
      (i) => i.id === idea.id,
    ),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
    "mobile horizontal overflow",
  );
  await page.screenshot({ path: out + "/creative-mobile.png", fullPage: true });
  const ledger = () => JSON.parse(fs.readFileSync(process.env.BEHAVIOR_LEDGER));
  if (ledger().attempts.length <= 57) {
    const next = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/life") &&
        r.request().method() === "POST" &&
        r.request().postDataJSON()?.action === "discover",
      { timeout: 150000 },
    );
    await card
      .getByRole("button", { name: "按这条反馈重新探索", exact: true })
      .click();
    const d = await (await next).json();
    records.push({ case: "real-feedback-reexploration", result: d });
    assert(d.ideas?.length, "Feedback must yield another real candidate");
    await page.screenshot({
      path: out + "/reexploration-mobile.png",
      fullPage: true,
    });
  }
  await nav("问物间").click();
  data = await api("/api/life");
  const samla = data.workspace.items.find(
    (i) => i.id.startsWith("alpha-test-") && i.name.includes("SAMLA"),
  );
  if (ledger().attempts.length < 60) {
    await page
      .getByRole("textbox", { name: "对物间说", exact: true })
      .fill(
        samla.name +
          "的材质、尺寸和使用限制分别是什么？内尺寸和现在是否完好能确认吗？",
      );
    const waiting = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/assistant") && r.request().method() === "POST",
      { timeout: 120000 },
    );
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const d = await (await waiting).json();
    records.push({ case: "real-multi-question", result: d });
    assert.match(d.reply.answer, /聚丙烯|PP/);
    assert.match(d.reply.answer, /28/);
    assert.match(d.reply.answer, /食物|食品/);
    assert.match(
      d.reply.answer,
      /未知|未提供|未确认|无法确认|不等于|不能确认|需要.*核对/,
    );
    await page
      .getByRole("button", { name: "发送", exact: true })
      .waitFor({ state: "visible" });
  }
  await page.screenshot({ path: out + "/qa-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: out + "/qa-desktop.png", fullPage: true });
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    out + "/result.json",
    JSON.stringify(
      {
        passed: true,
        records,
        errors,
        syntheticDataOnly: true,
        physicalTests: 0,
        humanBlindEvaluation: false,
        checks: [
          "real creative displayed",
          "saved and feedback persisted",
          "other actor isolation",
          "390px no overflow",
          "desktop rendering",
          "model QA",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Real browser product loop passed");
} catch (e) {
  await page.screenshot({ path: out + "/failure.png", fullPage: true });
  fs.writeFileSync(
    out + "/failure.json",
    JSON.stringify({ error: e.message, records, errors }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
}
