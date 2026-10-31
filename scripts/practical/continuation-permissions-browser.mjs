import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
const dir = "docs/engineering/practical-continuation-2026-11-01/evidence",
  file = dir + "/experience-permissions.json";
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
    basis: "real_browser_business_operations_with_synthetic_report_no_model",
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
page.on("pageerror", (e) => report.errors.push(e.message));
const action = (name) =>
  page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/foundation") &&
      r.request().method() === "POST" &&
      r.request().postDataJSON()?.action === name,
  );
const detail = async (taskId) => {
  const r = await page.request.get(
    "http://127.0.0.1:3232/api/foundation?taskId=" + taskId,
  );
  if (!r.ok()) throw Error("read_task_" + r.status());
  return r.json();
};
try {
  await page.goto("http://127.0.0.1:3232/#assistant");
  await page
    .getByRole("region", { name: "物间统一对话", exact: true })
    .waitFor();
  const w = page.getByTestId("task-continuity");
  await w.locator("summary").first().click();
  await w
    .getByRole("button", { name: prior.responses[0].question, exact: true })
    .last()
    .click();
  await w.getByRole("button", { name: "纠正这条经验", exact: true }).click();
  const corrected =
    "[合成更正，未做硬件验证]原报告“可以完成记录”说得过头，实际上只是提出了定点短片段方案，还没有验证拍摄成功。此前边走边拍的合成反馈是画面摇晃；手机不能安装DJI Mimo，不是已经尝试连接后失败。原因未知。";
  await w.getByLabel("纠正后的实际经历", { exact: true }).fill(corrected);
  await w.getByLabel("允许以后参考这条更正", { exact: true }).check();
  await w.getByLabel("允许云端 AI 使用这条更正", { exact: true }).check();
  const amended = action("amend_outcome");
  await w.getByRole("button", { name: "确认更正经验", exact: true }).click();
  const amendedResponse = await amended;
  report.corrected = await amendedResponse.json();
  if (!amendedResponse.ok()) throw Error("amend_failed");
  const after = await detail(prior.nextTaskId);
  const correctedFuture = after.previousOutcomes?.find(
    (o) => o.outcomeId === prior.saved.outcome.outcomeId,
  );
  report.checks.push({
    name: "原生业务纠正后，另一Task的Context只返回更正版本",
    passed: correctedFuture?.notes === corrected,
  });
  await w
    .getByText(corrected, { exact: false })
    .first()
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/experience-corrected-desktop.png" });
  const revoked = action("amend_outcome");
  await w.getByRole("button", { name: "不再复用", exact: true }).click();
  report.revoked = await (await revoked).json();
  const future = await detail(prior.nextTaskId);
  report.checks.push({
    name: "撤销复用后另一Task不再带这条经验",
    passed: !future.previousOutcomes?.some(
      (o) => o.outcomeId === prior.saved.outcome.outcomeId,
    ),
  });
  page.once("dialog", (d) => d.accept());
  const forgotten = action("amend_outcome");
  await w.getByRole("button", { name: "忘记这条经验", exact: true }).click();
  const forgottenResponse = await forgotten;
  const payload = forgottenResponse.request().postDataJSON();
  report.forgotten = await forgottenResponse.json();
  await expect(w.getByText("这条经验已忘记", { exact: true })).toBeVisible();
  const old = await detail(prior.taskId);
  const tombstone = old.outcomes.find(
    (o) => o.outcomeId === prior.saved.outcome.outcomeId,
  );
  report.checks.push({
    name: "遗忘后只留审计墓碑，不返回旧经历正文",
    passed:
      tombstone?.status === "forgotten" &&
      !tombstone.notes &&
      !JSON.stringify(old.outcomes).includes(corrected),
  });
  const replay = await page.evaluate(async (body) => {
    const r = await fetch("/api/foundation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  }, payload);
  report.checks.push({
    name: "重发同一确认请求保持幂等，不重建已忘记经验",
    passed:
      replay.status === 200 &&
      replay.body.outcome?.revision === report.forgotten.outcome?.revision &&
      replay.body.outcome?.status === "forgotten",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await w.getByText("这条经验已忘记", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/experience-forgotten-mobile.png" });
  report.checks.push({
    name: "390px页面无横向溢出",
    passed: await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  });
  const stranger = await browser.newContext(),
    p = await stranger.newPage();
  await p.goto("http://127.0.0.1:3232/");
  await p
    .getByLabel("用户名", { exact: true })
    .fill("合成权限对照" + Date.now());
  await p
    .getByLabel("口令", { exact: true })
    .fill(randomBytes(24).toString("hex"));
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "进入我的物间", exact: true }).click();
  await p.getByRole("button", { name: "生活首页", exact: true }).waitFor();
  const denied = await p.request.get(
    "http://127.0.0.1:3232/api/foundation?taskId=" + prior.taskId,
  );
  report.checks.push({
    name: "另一真实登录测试身份不能读取私有Task和经历",
    passed: [403, 404].includes(denied.status()),
  });
  await stranger.close();
  if (report.checks.some((c) => !c.passed))
    throw Error("permission_regression_failed");
} catch (e) {
  report.errors.push(e.message);
  fs.writeFileSync(
    ".runtime/experience-permissions-dom.txt",
    await page
      .locator("body")
      .innerText()
      .catch(() => ""),
  );
  await page
    .screenshot({ path: dir + "/experience-permissions-failure.png" })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  report.modelRequests = count() - before;
  if (report.modelRequests) {
    report.errors.push("unexpected_paid_request");
    process.exitCode = 1;
  }
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
  console.log(
    JSON.stringify({
      checks: report.checks,
      errors: report.errors,
      modelRequests: report.modelRequests,
    }),
  );
}
