import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_BASE_URL;
if (!base) throw Error("Isolated server required");
const live = process.env.ALPHA_LIVE === "true";
const out = path.resolve(
  "artifacts/personal-objects",
  `${live ? "live" : "offline"}-${Date.now()}`,
);
fs.mkdirSync(out, { recursive: true });
const records = [],
  errors = [];
async function api(route, body, actor = "lin", method = body ? "POST" : "GET") {
  const r = await fetch(base + route, {
    method,
    headers: { "Content-Type": "application/json", "x-demo-actor": actor },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  assert(r.ok, JSON.stringify(d));
  return d;
}
const browser = await chromium.launch({
  executablePath:
    process.env.EDGE_PATH ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.on("pageerror", (e) => errors.push(e.message));
async function send(question) {
  const region = page.getByRole("region", {
    name: "物间统一对话",
    exact: true,
  });
  const wait = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/assistant") &&
      r.request().method() === "POST" &&
      !!r.request().postDataJSON()?.question,
    { timeout: 150000 },
  );
  await region
    .getByRole("textbox", { name: "对物间说", exact: true })
    .fill(question);
  await region.getByRole("button", { name: "发送", exact: true }).click();
  const response = await wait,
    d = await response.json();
  records.push({ case: question, status: response.status(), result: d });
  assert(response.ok(), JSON.stringify(d));
  await expect(
    region.getByRole("button", { name: "发送", exact: true }),
  ).toBeEnabled({ timeout: 150000 });
  return d;
}
const photo = await sharp({
  create: { width: 540, height: 400, channels: 3, background: "#dbe6bb" },
})
  .composite([
    {
      input: Buffer.from(
        '<svg width="540" height="400"><rect x="90" y="65" width="360" height="270" rx="8" fill="#a9916e"/><rect x="110" y="85" width="320" height="230" fill="#fbf5da"/><circle cx="260" cy="170" r="50" fill="#dfb177"/><path d="M125 290L235 205L300 260L375 190L425 290Z" fill="#76927c"/></svg>',
      ),
    },
  ])
  .png()
  .toBuffer();
try {
  await page.goto(base);
  await page.getByRole("button", { name: "录入物品", exact: true }).click();
  await page.getByRole("button", { name: "SAMLA 储物盒", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "SAMLA 萨姆拉附盖储物盒", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("仅供室内使用，不可直接接触食物。", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "是这个型号，继续", exact: true })
    .click();
  const claim = page.locator("form.belong-claim");
  await claim
    .getByRole("textbox", { name: "给它一个自己的名字" })
    .fill("测试商品 · 我的旅行盒");
  await claim
    .getByRole("textbox", { name: "现在放在哪里" })
    .fill("新房间书桌右侧");
  await claim
    .getByRole("textbox", { name: "我的状态与备注" })
    .fill("合成测试：盖子有轻微划痕。我想把旅行纪念品放在这里。");
  await claim
    .getByRole("checkbox", { name: "我已核对，实物型号与这份资料一致" })
    .check();
  await claim.getByRole("checkbox", { name: /我确认拥有这件物品/ }).check();
  await claim.getByRole("checkbox", { name: "我确认它现在在手且可用" }).check();
  await claim
    .getByRole("checkbox", { name: "这是体验用测试物品，不代表真实持有" })
    .check();
  await claim.getByRole("button", { name: "让它成为我的物品" }).click();
  await expect(
    page.getByRole("heading", { name: "测试商品 · 我的旅行盒", exact: true }),
  ).toBeVisible();
  let data = await api("/api/life"),
    item = data.workspace.items.find((i) => i.name === "测试商品 · 我的旅行盒");
  assert(item.synthetic && item.productBinding);
  records.push({ case: "A-claimed-real-SKU-with-synthetic-possession", item });
  await send(
    "请完整介绍这件盒子的材质、尺寸和使用限制。我的盖子有划痕，能否据此判断它现在防水？",
  );
  const practical = await send(
    "我常在书桌上写旅行手账，用右手写字。我的书桌宽80厘米，这个旅行盒放在哪里比较顺手？请结合盒子的外尺寸给出建议，桌面深度和其他摆件的位置尚未提供。",
  );
  if (live) {
    assert.notEqual(practical.reply.source, "local-planning");
    assert(practical.modelCalls > 0);
  }
  await page.screenshot({
    path: out + "/A-product-desktop.png",
    fullPage: true,
  });
  // B uses a wholly synthetic private story and a generated test image, never a user's media.
  const mediaForm = new FormData();
  mediaForm.set("kind", "photo");
  mediaForm.set(
    "file",
    new File([photo], "synthetic-painting.png", { type: "image/png" }),
  );
  const mediaResponse = await fetch(base + "/api/life", {
    method: "POST",
    headers: { "x-demo-actor": "lin" },
    body: mediaForm,
  });
  assert(mediaResponse.ok);
  const paintingPhoto = await mediaResponse.json();
  const painting = (
    await api("/api/life", {
      action: "createItem",
      input: {
        name: "测试赠画 · 远山",
        mediaId: paintingPhoto.id,
        category: "画作",
        model: "无商品型号",
        lifecycle: "长期耐用",
        availability: "available",
        synthetic: true,
        attributes: {
          dimensions: "40×30厘米",
          material: "纸本，木质画框；玻璃和挂件状态未知",
        },
        note: "合成体验物品；不代表真实用户历史",
      },
    })
  ).item;
  // Use the existing intake's owned media route for a story photo, not an arbitrary external image URL.
  await page.goto(base + "/#items");
  await page.reload();
  await page
    .getByRole("button", { name: /测试赠画 · 远山/ })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "我和它的故事", exact: true })
    .fill(
      "合成经历：这幅画是朋友小夏送给我的。我搬到新房间时带来了它。没有记录赠送日期或其他情感细节。",
    );
  await page.locator('.belong-story input[type="file"]').setInputFiles({
    name: "synthetic-painting.png",
    mimeType: "image/png",
    buffer: photo,
  });
  await page
    .getByRole("checkbox", { name: "允许在我主动回忆时引用", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "允许云端模型使用这段故事", exact: true })
    .check();
  await page.getByRole("button", { name: "留下这一段", exact: true }).click();
  await page
    .getByRole("button", { name: "确认保留为这件物品的关系记忆", exact: true })
    .click();
  await expect(
    page.getByText("已确认关系记忆；可在新会话中使用。", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "为它启用数字分身", exact: true })
    .check();
  await page
    .getByRole("textbox", { name: "分身的名字", exact: true })
    .fill("山山");
  await page.getByRole("button", { name: "画框形象", exact: true }).click();
  assert(await page.locator(".belong-avatar-choices").evaluate(el=>{const box=el.getBoundingClientRect();return [...el.querySelectorAll("button")].every(b=>b.getBoundingClientRect().right<=box.right+1);}),"Avatar choices must fit inside the sidebar");
  await page.getByRole("button", { name: "保存分身设置", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "用数字分身的口吻交流", exact: true })
    .check();
  const first = await send(
    "新房间书桌宽80厘米，我想把这幅40×30厘米的画放在桌上，尽量不打孔。请结合它的来历给我实际的布置帮助；不知道的支撑条件请说清楚，不编造日期或感情。",
  );
  if (live) {
    assert(first.modelCalls > 0);
    assert(
      first.reply.memoryIds?.length,
      "Authorized relationship must be used",
    );
  }
  await page
    .getByRole("region", { name: "物间统一对话", exact: true })
    .getByRole("button", { name: "开始新问题", exact: true })
    .click();
  const second = await send(
    "这幅画是谁送的？我现在想换到新房间，应该先核对哪些摆放条件？",
  );
  assert.notEqual(first.session.id, second.session.id);
  await page.screenshot({
    path: out + "/B-persona-desktop.png",
    fullPage: true,
  });
  // Correct via the actual UI, then forget via that same UI.
  const memoryCenter = page.locator("details.memory-center");
  if (!(await memoryCenter.getAttribute("open")))
    await memoryCenter.locator("summary").first().click();
  await memoryCenter
    .getByRole("button", { name: "纠正 / 调整授权", exact: true })
    .first()
    .click();
  await memoryCenter
    .getByRole("textbox", { name: "纠正内容", exact: true })
    .fill("合成经历纠正：这幅画是同事阿禾送的，不是小夏。没有记录赠送日期。");
  await memoryCenter
    .getByRole("button", { name: "保存纠正", exact: true })
    .click();
  await send(
    "请核对你现在获准记住的赠送者，不要沿用旧记录。尺寸40×30厘米是本人报告，挂件状态未知。",
  );
  await memoryCenter
    .getByRole("button", { name: "忘记", exact: true })
    .first()
    .click();
  await send(
    "这幅画是谁送的？如果没有已获准的关系记忆，请直接说明不知道，不要根据分身名字猜。",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: out + "/B-persona-mobile.png",
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
    "Mobile horizontal overflow",
  );
  const other = await api(
    `/api/memories?itemId=${painting.id}`,
    undefined,
    "lin",
  );
  assert(
    !other.memories.some(
      (m) => m.status === "active" && m.itemId === painting.id,
    ),
  );
  await api("/api/life", {
    action: "updateItem",
    input: { itemId: painting.id, shared: true },
  });
  const shared = await api(
    `/api/memories?itemId=${painting.id}`,
    undefined,
    "dad",
  );
  assert(!shared.persona.enabled);
  assert(!shared.memories.some((m) => m.itemId === painting.id));
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    out + "/results.json",
    JSON.stringify({ passed: true, live, records, errors }, null, 2),
  );
  console.log(
    JSON.stringify({ passed: true, live, out, turns: records.length - 1 }),
  );
} catch (e) {
  await page
    .screenshot({ path: out + "/failure.png", fullPage: true })
    .catch(() => {});
  fs.writeFileSync(
    out + "/failure.json",
    JSON.stringify({ error: e.stack, records, errors }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
}
