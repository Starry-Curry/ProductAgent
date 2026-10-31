import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import {assistantResponse} from './helpers/assistant-response.mjs';
const base = process.env.TEST_BASE_URL;
if (!base) throw Error("Isolated test URL required");
const live = process.env.ALPHA_LIVE === "true",
  out = "artifacts/intelligence-alpha/" + (live ? "live" : "offline");
mkdirSync(out, { recursive: true });
async function api(route, body, actor = "lin", method = body ? "POST" : "GET") {
  const r = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json", "x-demo-actor": actor },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  return d;
}
const painting = (
  await api("/api/life", {
    action: "createItem",
    input: {
      name: "Alpha验收赠画",
      category: "装饰",
      lifecycle: "长期耐用",
      availability: "available",
      attributes: { quantity: 1 },
    },
  })
).item;
const box = (
  await api("/api/life", {
    action: "createItem",
    input: {
      name: "Alpha验收旧纸盒",
      category: "手工材料",
      lifecycle: "可重复使用",
      availability: "available",
      attributes: {
        material: "纸板（用户报告）",
        dimensions: "20×15×10厘米",
        quantity: 1,
      },
    },
  })
).item;
const paper = (
  await api("/api/life", {
    action: "createItem",
    input: {
      name: "Alpha验收白纸",
      category: "手工材料",
      lifecycle: "消耗型",
      availability: "available",
      attributes: { material: "普通纸", quantity: 20, quantityUnit: "张" },
    },
  })
).item;
const pen = (
  await api("/api/life", {
    action: "createItem",
    input: {
      name: "Alpha验收铅笔",
      category: "文具",
      lifecycle: "可重复使用",
      availability: "available",
      attributes: { quantity: 1, capabilities: ["在纸上书写"] },
    },
  })
).item;
const browser = await chromium.launch({
  executablePath:
    process.env.EDGE_PATH ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [],
  records = [];
page.on("pageerror", (e) => errors.push(e.message));
const nav = (name) =>
  page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name, exact: true });
async function send(text) {
  await page.getByRole("textbox", { name: "对物间说", exact: true }).fill(text);
  const pending = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/assistant") && r.request().method() === "POST",
    { timeout: 120000 },
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const r = await pending;
  assert.equal(r.status(), 200);
  const d = await assistantResponse(r);
  records.push({ input: text, result: d });
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeEnabled({ timeout: 120000 });
  return d;
}
try {
  await page.goto(base);
  await nav("发现新玩法").click();
  await page
    .getByText("真实商品知识实验 · 2 款测试商品", { exact: true })
    .click();
  await expect(
    page.getByText("SAMLA 萨姆拉附盖储物盒 · 194.408.48", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "添加合成测试记录并用于探索", exact: true })
    .click();
  await expect(
    page.getByText("已添加测试商品。", { exact: false }),
  ).toBeVisible();
  const samples = (await api("/api/life")).workspace.items.filter((i) =>
    i.id.startsWith("alpha-test-"),
  );
  assert.equal(samples.length, 2);
  assert(samples.every((i) => i.synthetic && !i.shared));
  await page.screenshot({
    path: out + "/products-desktop.png",
    fullPage: true,
  });
  await nav("问物间").click();
  await page.getByRole("checkbox", { name: /允许从这段对话建议记忆/ }).check();
  const text = live
    ? "我最近在学水彩，想把每天看到的东西编成小故事。"
    : "我喜欢安静的故事";
  await send(text);
  let memories = (await api("/api/memories")).memories;
  const candidate = memories.find(
    (m) => m.status === "candidate" && text.includes(m.text),
  );
  assert(candidate, "Natural statement must produce source-anchored candidate");
  assert.equal(candidate.allowCloud, false);
  const card = page
    .locator("article.source-card")
    .filter({ has: page.getByText(candidate.text, { exact: true }) });
  await expect(card.getByText(/待你确认/)).toBeVisible();
  await card.getByRole("button", { name: "确认保留", exact: true }).click();
  await expect(card.getByText(/待你确认/)).toHaveCount(0);
  memories = (await api("/api/memories")).memories;
  assert.equal(memories.find((m) => m.id === candidate.id).status, "active");
  assert.equal(memories.find((m) => m.id === candidate.id).allowCloud, false);
  await card
    .getByRole("button", { name: "纠正 / 调整授权", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "纠正内容", exact: true })
    .fill("我现在更喜欢无声的图像故事，不再使用原来的兴趣记录");
  await page.getByRole("button", { name: "保存纠正", exact: true }).click();
  await expect(
    page.getByText("我现在更喜欢无声的图像故事，不再使用原来的兴趣记录", {
      exact: true,
    }),
  ).toBeVisible();
  assert.equal(
    (await api("/api/memories", undefined, "dad")).memories.some(
      (m) => m.id === candidate.id,
    ),
    false,
  );
  await page.screenshot({ path: out + "/memory-desktop.png", fullPage: true });
  // Backend flow uses the same public API; browser above exercised confirmation/correction controls.
  const giftText = "这幅画是朋友小夏送我的，我把它带到了新住处。";
  const gift = await api("/api/assistant", {
    mode: "auto",
    itemId: painting.id,
    question: giftText,
    memoryPolicy: "candidates",
    requestId: crypto.randomUUID(),
    uiContext: { page: "assistant" },
  });
  records.push({ input: giftText, result: gift });
  const giftCandidate = (await api("/api/memories")).memories.find(
    (m) =>
      m.kind === "relationship" &&
      m.status === "candidate" &&
      m.itemId === painting.id,
  );
  if (live) {
    assert(
      giftCandidate,
      "Gift story needs an explicit relationship candidate",
    );
    await api("/api/memories", {
      id: giftCandidate.id,
      requestId: crypto.randomUUID(),
      memory: {
        kind: giftCandidate.kind,
        text: giftCandidate.text,
        itemId: painting.id,
        status: "active",
        allowCloud: true,
      },
    });
    const recalled = await api("/api/assistant", {
      mode: "story",
      itemId: painting.id,
      question: "你还记得这幅画是谁送给我的吗？不要补充日期。",
      memoryPolicy: "off",
      requestId: crypto.randomUUID(),
    });
    records.push({ case: "cross-session", result: recalled });
    assert.match(recalled.reply.answer, /小夏/);
    assert.notEqual(recalled.session.id, gift.session.id);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await nav("发现新玩法").click();
  if (live) {
    await page
      .locator(".discovery-options")
      .locator("..")
      .locator("summary")
      .click();
    for (const item of [box, paper, pen])
      await page.getByRole("checkbox", { name: new RegExp(item.name) }).check();
    await page
      .getByRole("textbox", { name: "这次想怎样度过？", exact: true })
      .fill(
        "只用登记的旧纸盒、白纸和铅笔，为安静练习口述故事设计一个具体新用途。不裁切不粘贴不加热，不增加材料，不要只有观察。",
      );
    const pending = page.waitForResponse(
      (r) => r.url().endsWith("/api/life") && r.request().method() === "POST",
      { timeout: 150000 },
    );
    await page.getByRole("button", { name: "找点新灵感", exact: true }).click();
    const d = await (await pending).json();
    records.push({ case: "mobile-creative", result: d });
    if (d.ideas?.length) {
      assert(d.ideas.some((i) => i.reasoning));
      await expect(
        page.getByText("你会得到：", { exact: true }).first(),
      ).toBeVisible();
      const first = page.locator("article.life-idea").first();
      await first.getByRole("button", { name: /收藏/ }).first().click();
    } else {
      assert(d.failure, "No ideas must have an honest explicit failure");
      await expect(
        page.getByText(d.failure.message, { exact: true }),
      ).toBeVisible();
    }
  }
  await page.screenshot({ path: out + "/creative-mobile.png", fullPage: true });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    out + "/result.json",
    JSON.stringify(
      {
        passed: true,
        live,
        records,
        checks: [
          "official test-product panel",
          "private explicit synthetic import",
          "natural source-backed memory candidate",
          "confirmation and correction UI",
          "other actor isolation",
          "390px layout",
          "no pageerror",
        ],
        physicalTests: 0,
        humanCreativeJudgment: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Alpha browser passed " + (live ? "live" : "offline"));
} catch (e) {
  await page.screenshot({ path: out + "/failure.png", fullPage: true });
  writeFileSync(
    out + "/failure.json",
    JSON.stringify({ error: e.message, records, errors }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
}
