import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import { ROOT as dir } from "./gateway.mjs";
import { observeAssistant, ask,createUIItem } from "../practical/browser-helpers.mjs";
process.env.WUJIAN_TEST_URL='http://127.0.0.1:3233';
const stage=process.argv.find(a=>a.startsWith('--stage='))?.slice(8)||'r10-experience-v2';
if(!/^[a-z0-9-]+$/.test(stage))throw Error('invalid_stage');
const file = dir + '/'+stage+'.json';
if (fs.existsSync(file)) throw Error("preserve_previous_evidence");
const count = () =>
    JSON.parse(fs.readFileSync(dir + "/model-calls.json")).attempts.length,
  before = count();
const report = {
  at: new Date().toISOString(),
  basis: "synthetic_confirmed_user_report_not_hardware_verification",
  responses: [],
  checks: [],
  errors: [],
};
const item = {cameraId:''};
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
const action = (name) =>
  page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/foundation") &&
      r.request().method() === "POST" &&
      r.request().postDataJSON()?.action === name,
  );
async function newTask(goal) {
  await page.goto(
    "http://127.0.0.1:3233/?experience=" + Date.now() + "#assistant",
  );
  await page.getByLabel("使用已获准的个人记忆与经历", { exact: false }).check();
  const w = page.getByTestId("task-continuity");
  await w.locator("summary").first().click();
  await w.getByLabel("新任务目标", { exact: true }).fill(goal);
  await w.getByText("选择这次相关的物品（可不选）", { exact: true }).click();
  await w.getByLabel('[模拟持有]经验闭环'+stage, { exact: false }).check();
  const created = action("create");
  await w.getByRole("button", { name: "开始并保留进度", exact: true }).click();
  const d = await (await created).json();
  if (!d.task) throw Error(JSON.stringify(d));
  await page.waitForFunction(
    () => window.__assistantResults.some((r) => r.result?.reply),
    null,
    { timeout: 130000 },
  );
  const r = await page.evaluate(() => window.__assistantResults.at(-1).result);
  report.responses.push({ question: goal, result: r });
  return { w, r, task: d.task };
}
async function openOriginal() {
  await page.goto("http://127.0.0.1:3233/#assistant");
  await page
    .getByRole("region", { name: "物间统一对话", exact: true })
    .waitFor();
  const w = page.getByTestId("task-continuity");
  await w.locator("summary").first().click();
  await w
    .locator('[data-task-id="'+report.taskId+'"]')
    .click();
  return w;
}
try {
  const auth=page.waitForResponse(r=>r.url().endsWith('/api/account')&&r.request().method()==='GET');
  await page.goto('http://127.0.0.1:3233/');
  if(!(await(await auth).json()).account){const login=JSON.parse(fs.readFileSync('.runtime/continuation-fixture-login.json'));await page.getByLabel('用户名',{exact:true}).fill(login.name);await page.getByLabel('口令',{exact:true}).fill(login.password);await page.getByRole('button',{name:'进入我的物间',exact:true}).click();}
  await page.getByRole('button',{name:'生活首页',exact:true}).waitFor();
  const a=await(await page.request.get('http://127.0.0.1:3233/api/account')).json();
  const prior=await page.evaluate(id=>localStorage.getItem('wujian-task:'+id),a.account.id);
  if(prior){const w=page.getByTestId('task-continuity');await w.locator('summary').first().click();await w.getByRole('button',{name:'暂时离开这件事',exact:true}).click();}
  const fresh=await createUIItem(page,{name:'[模拟持有]经验闭环'+stage,brand:'Canon',model:'EOS R10'},report);item.cameraId=fresh.id;report.item={id:fresh.id,model:fresh.model};
  const first = await newTask(
    "想用EOS R10手持给爸爸录十秒做饭片段，没有三脚架，镜头与固件未知。只给开始、停止的下一步操作，不改菜单设置，也不添任何物品。",
  );
  report.taskId = first.task.taskId;
  await first.w
    .getByLabel("实际尝试结果", { exact: true })
    .waitFor({ timeout: 15000 });
  const notes =
    "[合成反馈，未做真实硬件测试]在视频模式直接全按照片快门，没有开始录像；我没有确认短片快门功能是否曾被更改，原因未查明。下次不想再尝试这个失败方法，也不想改菜单，只想用专用短片按钮。固件未知。";
  await first.w.getByLabel("实际尝试结果", { exact: true }).fill(notes);
  await first.w
    .getByLabel("允许以后同一物品的任务参考这条结果（仍仅自己可见）", {
      exact: true,
    })
    .check();
  await first.w
    .getByLabel("也允许本条结果交给云端 AI 帮助我（可不选）", { exact: true })
    .check();
  const saved = action("outcome");
  await first.w
    .getByRole("button", { name: "确认：还没解决", exact: true })
    .click();
  const savedResponse = await saved;
  report.saved = await savedResponse.json();
  if (!savedResponse.ok()) throw Error(JSON.stringify(report.saved));
  await ask(page,'把刚才这条合成操作报告保存为该相机的私人故事，保持原因未知，不供长期检索、不允许云端以后使用。请先给确认卡。',report);
  await page.getByRole('button',{name:'确认保存私人故事',exact:true}).click();
  await expect(page.getByText('私人故事已保存，未授权检索或分享',{exact:true})).toBeVisible();
  report.checks.push({name:'同一Task中把所选报告保存为私人故事，不自动授予检索或云端权限',passed:true});
  const next = await newTask(
    "我又想用这台EOS R10给爸爸录十秒做饭片段，请参考我获准保存的尝试调整下一步，别重复上次失败的方法，也不改菜单、不添物品。只说明下一步怎样开始和停止；不知道原因的部分别替我下结论。",
  );
  report.nextTaskId = next.task.taskId;
  report.checks.push({
    name: "另一Task实际获得获准经历",
    passed: next.r.reply.memoryIds.includes(report.saved.outcome.outcomeId),
  });
  await page.locator(".assistant-prose").last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "/"+stage+"-reused-desktop.png" });
  const w = await openOriginal();
  await w.getByRole("button", { name: "纠正这条经验", exact: true }).click();
  const correction =
    "[合成更正，未做真实硬件测试]专用短片按钮已经成功开始并停止了一个片段，现在没有“不能录像”的问题。原先快门没开始是我的报告，原因仍未验证。下一步只需检查回放画面与声音，固件仍未知。";
  await w.getByLabel("纠正后的实际经历", { exact: true }).fill(correction);
  await w.getByLabel("允许以后参考这条更正", { exact: true }).check();
  await w.getByLabel("允许云端 AI 使用这条更正", { exact: true }).check();
  const corrected = action("amend_outcome");
  await w.getByRole("button", { name: "确认更正经验", exact: true }).click();
  report.corrected = await (await corrected).json();
  const revised = await newTask(
    "这台EOS R10的尝试记录已经更正。请按我获准保存的最新结果决定下一步：如果已经拍到了，先查该型号官方回放章节，指导我检查画面和声音；不要继续排查旧的不能录像问题，也不要假设已经确认固件版本。",
  );
  report.checks.push({
    name: "更正后新任务引用当前有效Outcome",
    passed: revised.r.reply.memoryIds.includes(report.saved.outcome.outcomeId),
  });
  await page.locator(".assistant-prose").last().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: dir + "/"+stage+"-corrected-desktop.png",
  });
  const old = await openOriginal();
  const revoked = action("amend_outcome");
  await old.getByRole("button", { name: "不再复用", exact: true }).click();
  report.revoked = await (await revoked).json();
  page.once("dialog", (d) => d.accept());
  const forgotten = action("amend_outcome");
  await old.getByRole("button", { name: "忘记这条经验", exact: true }).click();
  report.forgotten = await (await forgotten).json();
  await expect(old.getByText("这条经验已忘记", { exact: true })).toBeVisible();
  await page.goto(
    "http://127.0.0.1:3233/?afterForget=" +
      Date.now() +
      "#item/" +
      item.cameraId,
  );
  await page
    .getByRole("region", { name: "物间统一对话", exact: true })
    .waitFor();
  await page
    .getByLabel("使用这件物品已获准的故事与经验", { exact: true })
    .check();
  const after = await ask(
    page,
    "现在有哪些我允许保存和复用的EOS R10尝试经历？没有就说明没有，不要从商品资料猜个人经历。",
    report,
  );
  report.checks.push({
    name: "遗忘后真实模型新会话不再接收这条经历",
    passed: !after.reply.memoryIds.includes(report.saved.outcome.outcomeId),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".assistant-prose").last().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: dir + "/"+stage+"-after-forget-mobile.png",
  });
  if (report.checks.some((c) => !c.passed))
    throw Error("experience_contract_failed");
} catch (e) {
  report.errors.push(e.message);
  await page
    .screenshot({ path: dir + "/"+stage+"-failure.png" })
    .catch(() => {});
  fs.writeFileSync(
    ".runtime/r10-new-experience-failure-dom.txt",
    await page
      .locator("body")
      .innerText()
      .catch(() => ""),
  );
  process.exitCode = 1;
} finally {
  report.upstreamRequests = count() - before;
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
