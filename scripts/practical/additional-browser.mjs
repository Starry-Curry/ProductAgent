import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { ADDITIONAL_ROOT as dir } from "./gateway.mjs";
import { observeAssistant, createUIItem, ask } from "./browser-helpers.mjs";
const stage =
  process.argv.find((a) => a.startsWith("--stage="))?.slice(8) ||
  "unknown-r10-v1";
if (!/^[a-z0-9-]+$/.test(stage) || fs.existsSync(dir + "/" + stage + ".json"))
  throw Error("unique_stage_required");
const ledger = () =>
    JSON.parse(fs.readFileSync(dir + "/model-calls.json")).attempts,
  before = ledger().length,
  report = {
    at: new Date().toISOString(),
    syntheticOwnership: true,
    physicalTests: 0,
    noUserProvidedURL: true,
    responses: [],
    checks: [],
    errors: [],
  };
const browser = await chromium.launch({
    executablePath:
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
  }),
  context = await browser.newContext({
    storageState: ".runtime/practical-browser-state.json",
    viewport: { width: 1440, height: 1000 },
  });
await observeAssistant(context);
const page = await context.newPage();
page.on("pageerror", (e) => report.errors.push(e.message));
try {
  const auth = page.waitForResponse(
    (r) => r.url().endsWith("/api/account") && r.request().method() === "GET",
  );
  await page.goto("http://127.0.0.1:3232/");
  if (!(await (await auth).json()).account) {
    const login = JSON.parse(
      fs.readFileSync(".runtime/continuation-fixture-login.json"),
    );
    await page.getByLabel("用户名", { exact: true }).fill(login.name);
    await page.getByLabel("口令", { exact: true }).fill(login.password);
    await page
      .getByRole("button", { name: "进入我的物间", exact: true })
      .click();
  }
  await page.getByRole("button", { name: "生活首页", exact: true }).waitFor();
  await context.storageState({ path: ".runtime/practical-browser-state.json" });
  const item = await createUIItem(
    page,
    { name: "[模拟持有]新录入的R10相机", brand: "Canon", model: "EOS R10" },
    report,
  );
  report.item = {
    id: item.id,
    model: item.model,
    supportUrl: item.supportUrl || null,
  };
  fs.writeFileSync(
    ".runtime/additional-items.json",
    JSON.stringify({ cameraId: item.id }),
  );
  const r = await ask(
    page,
    "EOS R10怎样开始和停止拍短片？能把照片快门直接当录像键吗？请从实际取得的官方手册回答，也说明这份手册适用的固件版本；按钮图示无法识别的部分保留未知。",
    report,
  );
  report.checks.push({
    name: "没有用户URL或预置SKU链接，实际取得匹配型号的官方手册章节",
    passed:
      !item.supportUrl &&
      r.reply.citations.some(
        (c) =>
          c.url.includes("cam.start.canon") && !c.url.endsWith("index.html"),
      ) &&
      r.trace.some((t) => t.stage === "practical_knowledge"),
  });
  await page.locator(".assistant-prose").last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/" + stage + "-desktop.png" });
  if (r.reply.outcome !== "answered" || report.checks.some((c) => !c.passed))
    throw Error("unknown_product_journey_incomplete");
  const follow = await ask(
    page,
    "还是这台EOS R10。我只有相机和未知型号的镜头，没有三脚架，不再买东西，想给爸爸录做饭。请给一个短片段的操作和回放检查方法；不知道当前固件，不能把手册版本当作我的版本。",
    report,
  );
  report.checks.push({
    name: "同物品同会话追问且实际展示文字",
    passed:
      follow.session.id === r.session.id &&
      follow.reply.usedItems.some((i) => i.id === item.id),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".assistant-prose").last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/" + stage + "-mobile.png" });
  report.mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 2,
  );
  if (report.mobileOverflow) throw Error("mobile_overflow");
  await context.storageState({ path: ".runtime/practical-browser-state.json" });
} catch (e) {
  report.errors.push(e.message);
  await page
    .screenshot({ path: dir + "/" + stage + "-failure.png" })
    .catch(() => {});
  fs.writeFileSync(
    ".runtime/" + stage + "-dom.txt",
    await page
      .locator("body")
      .innerText()
      .catch(() => ""),
  );
  process.exitCode = 1;
} finally {
  report.upstreamRequests = ledger().length - before;
  const a = JSON.parse(fs.readFileSync(dir + "/authorization.json"));
  report.oldLedgerUnchanged =
    createHash("sha256")
      .update(
        fs.readFileSync(
          "docs/engineering/practical-agent-2026-10-31/evidence/model-calls.json",
        ),
      )
      .digest("hex") === a.previousRound.sha256;
  fs.writeFileSync(
    dir + "/" + stage + ".json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
  console.log(
    JSON.stringify({
      checks: report.checks,
      errors: report.errors,
      upstreamRequests: report.upstreamRequests,
      oldLedgerUnchanged: report.oldLedgerUnchanged,
    }),
  );
}
