import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3204",
  dir = "artifacts/unified-home";
fs.mkdirSync(dir, { recursive: true });
if(fs.existsSync(dir+"/browser-live.json")){const h=dir+"/browser-run-history.json";const history=fs.existsSync(h)?JSON.parse(fs.readFileSync(h,"utf8")):[];history.push(JSON.parse(fs.readFileSync(dir+"/browser-live.json","utf8")));fs.writeFileSync(h,JSON.stringify(history,null,2));}
const records = [],
  errors = [];
const browser = await chromium.launch({
  executablePath:
    process.env.EDGE_PATH ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } });
page.on("pageerror", (e) => errors.push(e.message));
function save() {
  fs.writeFileSync(
    dir + "/browser-live.json",
    JSON.stringify({ at: new Date().toISOString(), records, errors }, null, 2),
  );
}
async function answer(action, label) {
  const wait = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/assistant") &&
      r.request().method() === "POST" &&
      r.request().postDataJSON()?.question,
    { timeout: 140000 },
  );
  await action();
  const r = await wait,
    d = await r.json();
  records.push({
    case: label,
    status: r.status(),
    input: r.request().postDataJSON()?.question,
    result: d,
  });
  save();
  if (!r.ok()) throw Error(JSON.stringify(d));
  await expect(
    page
      .getByRole("region", { name: "物间统一对话", exact: true })
      .getByRole("button", { name: "发送", exact: true }),
  ).toBeEnabled({ timeout: 10000 });
  return d;
}
async function send(text, label = text) {
  return answer(async () => {
    const region = page.getByRole("region", {
      name: "物间统一对话",
      exact: true,
    });
    await region
      .getByRole("textbox", { name: "对物间说", exact: true })
      .fill(text);
    await region.getByRole("button", { name: "发送", exact: true }).click();
  }, label);
}
try {
  await page.goto(base + "/#home");
  await expect(
    page.getByRole("heading", { name: /把生活交给一句话/ }),
  ).toBeVisible();
  if (
    await page
      .getByRole("button", { name: "打开模拟家庭", exact: false })
      .count()
  ) {
    await page
      .getByLabel("允许云端模型使用这套模拟家庭", { exact: false })
      .check();
    await page
      .getByRole("button", { name: "打开模拟家庭", exact: false })
      .click();
    await page
      .locator(".apartment-progress")
      .filter({ hasText: "本轮官网获取完成" })
      .waitFor({ timeout: 150000 });
  }
  await expect(page.locator(".apartment-item")).toHaveCount(8);
  await page.screenshot({ path: dir + "/home-desktop.png", fullPage: true });
  if(!process.argv.includes("--from-b")){
  const a = await answer(
    () => page.getByRole("button", { name: /今晚，写一页旅行手账/ }).click(),
    "A-quiet-journaling-layout",
  );
  await page.screenshot({
    path: dir + "/journey-a-desktop.png",
    fullPage: true,
  });
  if (!a.reply.usedItems?.some((i) => i.model === "803.542.81"))
    throw Error("A did not use exact MICKE");
  if(!process.argv.includes("--primary-only")){
  await send(
    "延续刚才的安静手账安排。我想调亮一点、色温也调暖些，台灯旋钮具体怎么操作？请区分官方说明和我的模拟状态。",
    "A-lamp-follow-up",
  );
  await page.screenshot({
    path: dir + "/journey-a-followup.png",
    fullPage: true,
  });

  }
  }
  if (process.argv.includes("--a-only")) process.exitCode = 0;
  else {
    await page.getByRole("button", { name: "生活首页", exact: true }).click();
    const b = await answer(
      () =>
        page.getByRole("button", { name: /给那幅画，找一个新位置/ }).click(),
      "B-gift-and-layout",
    );
    if (!b.reply.answer.includes("小夏"))
      throw Error("B failed current gift memory");
    if ((b.reply.task?.parts.length || 0) < 2)
      throw Error("B did not represent both subgoals");
    await page.screenshot({
      path: dir + "/journey-b-desktop.png",
      fullPage: true,
    });
    await page
      .locator(".home-used-items button")
      .filter({ hasText: "远山" })
      .last()
      .click();
    await expect(
      page.getByRole("heading", { name: "远山 · 朋友送的画", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "返回原任务 ↗", exact: true }),
    ).toBeVisible();
    await page.getByLabel("为它启用数字分身", { exact: true }).check();
    await page
      .getByRole("button", { name: "保存分身设置", exact: true })
      .click();
    await expect(
      page.getByText("分身设置已保存；故事授权仍独立。", { exact: false }),
    ).toBeVisible();
    await page.getByLabel("用数字分身的口吻交流", { exact: true }).check();
    await page
      .getByRole("button", { name: "让山山加入原来的生活任务 ↗", exact: true })
      .click();
    if(!process.argv.includes("--primary-only")){
    const persona = await send(
      "请用这幅画的分身身份继续刚才的布置任务。你叫什么？我没有支架，也不想买东西或粘贴。",
      "B-persona-in-original-task",
    );
    if (!persona.reply.answer.includes("山山"))
      throw Error("Persona name missing");
    await page.screenshot({
      path: dir + "/journey-b-persona.png",
      fullPage: true,
    });

    }
    await page.getByRole("button", { name: "生活首页", exact: true }).click();
    await answer(
      () => page.getByRole("button", { name: /把台灯，用得更顺手/ }).click(),
      "C-lamp-operations-and-network",
    );
    await page.screenshot({
      path: dir + "/journey-c-desktop.png",
      fullPage: true,
    });
    if(!process.argv.includes("--primary-only")){
    await send(
      "我的手机只看到5GHz网络，米家里还没有添加这盏灯。接下来先检查什么？不要恢复出厂设置，也不要声称你已经控制了灯。",
      "C-network-troubleshooting",
    );
    await page.screenshot({
      path: dir + "/journey-c-followup.png",
      fullPage: true,
    });

    }
    const region = page.getByRole("region", {
      name: "物间统一对话",
      exact: true,
    });
    const feedback = region
      .getByRole("button", { name: "这步试过了", exact: true })
      .first();
    if (await feedback.count()) {
      await feedback.click();
      await expect(
        region.getByRole("button", { name: "已试过", exact: true }).first(),
      ).toBeDisabled();
      records.push({
        case: "C-user-reported-step-feedback",
        status: "passed",
        kind: "user-report-not-device-verification",
      });
      save();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "生活首页", exact: true }).click();
  await expect(page.locator(".apartment-item")).toHaveCount(8);
  await page.screenshot({ path: dir + "/home-mobile.png", fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 2,
  );
  if (overflow) throw Error("Mobile horizontal overflow");
  records.push({ case: "mobile-390-home-and-navigation", status: "passed" });
  console.log(
    JSON.stringify({
      cases: records.map((r) => ({
        case: r.case,
        status: r.status,
        modelCalls: r.result?.modelCalls,
      })),
      errors,
    }),
  );
} catch (e) {
  records.push({ case: "browser-stopped", error: e.message });
  await page
    .screenshot({ path: dir + "/browser-failure.png", fullPage: true })
    .catch(() => {});
  throw e;
} finally {
  save();
  await browser.close();
}
