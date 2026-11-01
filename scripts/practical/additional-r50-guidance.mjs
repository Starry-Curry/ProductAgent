import { chromium } from "@playwright/test";
import fs from "node:fs";
import { ADDITIONAL_ROOT as dir } from "./gateway.mjs";
import { observeAssistant, ask } from "./browser-helpers.mjs";
const file = dir + "/r50-operation-v1.json";
if (fs.existsSync(file)) throw Error("preserve_previous_evidence");
const ledger = () =>
    JSON.parse(fs.readFileSync(dir + "/model-calls.json")).attempts,
  before = ledger().length;
if (20 - before < 3) throw Error("insufficient_authorized_rounds");
const report = {
  at: new Date().toISOString(),
  syntheticOwnership: true,
  physicalTests: 0,
  responses: [],
  checks: [],
  errors: [],
};
const id = JSON.parse(
  fs.readFileSync(".runtime/practical-cross-items.json"),
).cameraId;
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
try {
  await page.goto(
    "http://127.0.0.1:3232/?operation=" + Date.now() + "#item/" + id,
  );
  await page
    .getByRole("region", { name: "物间统一对话", exact: true })
    .waitFor();
  const r = await ask(
    page,
    "EOS R50默认怎样开始和停止录制短片？请先查这个型号真正操作手册中的录像启停章节，不要用产品介绍推断，也不要把A+照片模式或未更改设置的照片快门当作默认录像操作。我不知道固件，只回答这一项操作与适用条件，不扩展配置。",
    report,
  );
  report.checks.push({
    name: "实际读取R50官方录像章节而非只引用产品介绍",
    passed:
      r.reply.citations.some(
        (c) =>
          c.url.includes("cam.start.canon") &&
          c.url.includes("/manual/") &&
          !c.url.endsWith("/index.html"),
      ) && r.reply.outcome === "answered",
  });
  await page.locator(".assistant-prose").last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/r50-operation-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".assistant-prose").last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/r50-operation-mobile.png" });
  if (report.checks.some((c) => !c.passed))
    throw Error("operation_not_complete");
} catch (e) {
  report.errors.push(e.message);
  await page
    .screenshot({ path: dir + "/r50-operation-failure.png" })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  report.upstreamRequests = ledger().length - before;
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
  console.log(
    JSON.stringify({
      checks: report.checks,
      errors: report.errors,
      upstreamRequests: report.upstreamRequests,
    }),
  );
}
