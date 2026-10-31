import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const stage =
  process.argv.find((a) => a.startsWith("--stage="))?.slice(8) ||
  "consent-reset";
if (!/^[a-z0-9-]+$/.test(stage)) throw Error("invalid_stage");
const dir = "docs/engineering/practical-continuation-2026-11-01/evidence",
  file = dir + "/" + stage + ".json";
if (fs.existsSync(file)) throw Error("preserve_previous_evidence");
const prior = JSON.parse(fs.readFileSync(dir + "/cross-loop-v2.json"));
const count = () =>
    JSON.parse(
      fs.readFileSync(
        "docs/engineering/practical-agent-2026-10-31/evidence/model-calls.json",
      ),
    ).attempts.length,
  before = count(),
  report = {
    at: new Date().toISOString(),
    checks: [],
    errors: [],
    modelRequests: 0,
  };
const browser = await chromium.launch({
    executablePath:
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
  }),
  context = await browser.newContext({
    storageState: ".runtime/practical-browser-state.json",
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
try {
  const accountResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/account") && r.request().method() === "GET",
  );
  await page.goto("http://127.0.0.1:3232/#assistant");
  const account = await (await accountResponse).json();
  if (!account.account) {
    const login = JSON.parse(
      fs.readFileSync(".runtime/continuation-fixture-login.json"),
    );
    await page.getByLabel("用户名", { exact: true }).fill(login.name);
    await page.getByLabel("口令", { exact: true }).fill(login.password);
    await page
      .getByRole("button", { name: "进入我的物间", exact: true })
      .click();
    await page.getByRole("button", { name: "生活首页", exact: true }).waitFor();
    await page.goto("http://127.0.0.1:3232/#assistant");
  }
  const w = page.getByTestId("task-continuity");
  await w.locator("summary").first().click();
  await w
    .getByRole("button", { name: prior.responses[0].question, exact: true })
    .first()
    .click();
  await w.getByLabel("实际尝试结果", { exact: true }).waitFor();
  const reuse = w.getByLabel(
      "允许以后同一物品的任务参考这条结果（仍仅自己可见）",
      { exact: true },
    ),
    cloud = w.getByLabel("也允许本条结果交给云端 AI 帮助我（可不选）", {
      exact: true,
    });
  await expect(reuse).not.toBeChecked();
  await reuse.check();
  await cloud.check();
  await reuse.uncheck();
  await expect(cloud).toHaveCount(0);
  await reuse.check();
  await expect(cloud).not.toBeChecked();
  report.checks.push("关闭复用同时清除隐藏的云端同意，重新勾选不会恢复旧同意");
  await cloud.check();
  await w
    .getByRole("button", { name: prior.responses[1].question, exact: true })
    .click();
  await expect(reuse).not.toBeChecked();
  await expect(cloud).toHaveCount(0);
  report.checks.push("切换任务时新报告默认不复用、不传云端");
  await reuse.scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/" + stage + "-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await reuse.scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/" + stage + "-mobile.png" });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 2,
    )
  )
    throw Error("mobile_overflow");
  report.checks.push("390px授权表单可用且无横向溢出");
  await context.storageState({ path: ".runtime/practical-browser-state.json" });
} catch (e) {
  report.errors.push(e.message);
  await page
    .screenshot({ path: dir + "/" + stage + "-failure.png" })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  report.modelRequests = count() - before;
  if (report.modelRequests) process.exitCode = 1;
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
  console.log(JSON.stringify(report));
}
