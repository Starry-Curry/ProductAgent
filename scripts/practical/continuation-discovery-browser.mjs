import { chromium } from "@playwright/test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { observeAssistant, createUIItem, ask } from "./browser-helpers.mjs";
const dir = "docs/engineering/practical-continuation-2026-11-01/evidence",
  stage =
    process.argv.find((a) => a.startsWith("--stage="))?.slice(8) ||
    "discovery-v1";
if (!/^[a-z0-9-]+$/.test(stage) || fs.existsSync(dir + "/" + stage + ".json"))
  throw Error("unique_stage_required");
const ledger = () =>
    JSON.parse(
      fs.readFileSync(
        "docs/engineering/practical-agent-2026-10-31/evidence/model-calls.json",
      ),
    ).attempts,
  before = ledger().length;
const report = {
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
  const item = await createUIItem(
    page,
    { name: "[模拟持有]新的小音箱", brand: "Sony", model: "SRS-XB100" },
    report,
  );
  report.item = {
    id: item.id,
    model: item.model,
    supportUrl: item.supportUrl || null,
  };
  const r = await ask(
    page,
    "SRS-XB100怎样连接手机、播放或暂停音乐和调整音量？请按这个型号实际取得的官方资料回答，按钮图示看不清就说明。",
    report,
  );
  report.checks.push({
    name: "未输入官方URL，实际走未知型号官方发现",
    passed:
      !item.supportUrl && r.trace.some((t) => t.stage === "practical_search"),
  });
  report.checks.push({
    name: "真实取得该型号官方原文并返回来源",
    passed:
      r.reply.citations.some((c) => c.url.includes("sony.net")) ||
      r.reply.citations.some((c) => c.url.includes("sony.com")),
  });
  await page.locator(".assistant-prose").last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/" + stage + "-desktop.png" });
  if (report.checks.some((c) => !c.passed))
    throw Error("official_discovery_not_completed_no_followup_spend");
  await ask(
    page,
    "如果我把音量调到最低，暂停音乐和关闭电源是一回事吗？你能从当前官方资料确认哪些，哪些按钮图示还没读出来？",
    report,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".assistant-prose").last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/" + stage + "-mobile.png" });
  fs.writeFileSync(
    ".runtime/continuation-items.json",
    JSON.stringify({ speakerId: item.id }),
  );
  if (report.checks.some((c) => !c.passed))
    throw Error("discovery_check_failed");
} catch (e) {
  report.errors.push(e.message);
  await page
    .screenshot({ path: dir + "/" + stage + "-failure.png" })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  report.upstreamRequests = ledger().length - before;
  report.attempts = ledger()
    .slice(before)
    .map((a) => ({ number: a.number, kind: a.kind, status: a.status }));
  const initial = JSON.parse(fs.readFileSync(dir + "/start.json"));
  report.previousAttemptsUnchanged =
    createHash("sha256")
      .update(JSON.stringify(ledger().slice(0, initial.previousRequests)))
      .digest("hex") === initial.previousAttemptsHash;
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
      previousAttemptsUnchanged: report.previousAttemptsUnchanged,
    }),
  );
}
