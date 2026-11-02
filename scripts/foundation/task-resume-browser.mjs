import {chromium,expect} from '@playwright/test';import fs from 'node:fs';import assert from 'node:assert/strict';
import {observeAssistant,ask} from '../practical/browser-helpers.mjs';
const base='http://127.0.0.1:3241',root='docs/engineering/qwen-foundation-2026-11-02/evidence',stage=process.argv.find(a=>a.startsWith('--stage='))?.slice(8)||'task-resume-r1';if(!/^task-resume-r[1-9]$/.test(stage))throw Error('invalid_stage');const file=root+'/'+stage+'.json';if(fs.existsSync(file))throw Error('preserve_evidence');
const previous=JSON.parse(fs.readFileSync(root+'/task-continuity-r2.json'));assert.ok(previous.outcome?.outcomeId);assert.equal(previous.checks.length,2);
const before=JSON.parse(fs.readFileSync(root+'/model-calls.json')).attempts.length;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),context=await browser.newContext({storageState:'.runtime/foundation-browser-state.json',viewport:{width:1440,height:1000}});await observeAssistant(context);const page=await context.newPage();
const report={at:new Date().toISOString(),basis:'real_browser_Qwen_same_Task_cross_entry_reuse_correction_forget_synthetic_reports_only',priorEvidence:'task-continuity-r2.json',taskId:previous.taskId,outcomeId:previous.outcome.outcomeId,responses:[],checks:[],errors:[],pageErrors:[]};const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');page.on('pageerror',e=>report.pageErrors.push(e.message));
async function fresh(){const region=page.getByRole('region',{name:'物间统一对话',exact:true});const button=region.getByRole('button',{name:'开始新问题',exact:true});if(await button.count())await button.click();}
try{
 await page.goto(base+'/#home');const continuity=page.getByTestId('task-continuity');if(await continuity.getAttribute('open')===null)await continuity.locator('summary').first().click();
 await continuity.locator('button[data-task-id="'+report.taskId+'"]').click();
 if(process.argv.includes('--new-report')){
  // A new explicit synthetic report, not restoration of the previously forgotten
  // record. The prior forgotten record remains forgotten in the domain store.
  await continuity.getByLabel('实际尝试结果',{exact:true}).fill('[新的合成报告，未操作硬件]我已经读懂配对步骤，还没有真正连接；接下来准备先核对旧手机是否自动回连。');
  await continuity.getByLabel('允许以后同一物品的任务参考这条结果（仍仅自己可见）',{exact:true}).check();await continuity.getByLabel('也允许本条结果交给云端 AI 帮助我（可不选）',{exact:true}).check();
  const saved=page.waitForResponse(r=>r.url()===base+'/api/foundation'&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='outcome');await continuity.getByRole('button',{name:'确认：我已完成',exact:true}).click();const body=await(await saved).json();assert.ok(body.outcome?.outcomeId);assert.notEqual(body.outcome.outcomeId,report.outcomeId);report.outcomeId=body.outcome.outcomeId;report.newExplicitReport=body.outcome;save();
 }
 await page.getByLabel('使用已获准的个人记忆与经历（仅使用允许云端读取的内容，不自动保存新记忆）',{exact:true}).check();
 const first=await ask(page,'我们刚才实际完成的是什么？下一步尝试连接时应避免重复做什么？请区分阅读准备和真实设备成功，不要把我的报告解释成你知道成功原因。',report);save();
 assert.equal(first.reply.outcome,'answered');assert.equal(first.session.known.foundationTaskId,report.taskId);assert.ok(first.reply.memoryIds.includes(report.outcomeId));
 report.checks.push({name:'item Task → home Task list → same Task and approved report in real Qwen',passed:true});
 await continuity.getByRole('button',{name:'纠正这条经验',exact:true}).click();
 const corrected='[合成更正，未操作真实设备]原来的已完成只是读懂说明；模拟试用中即使关闭旧手机蓝牙，新手机仍未找到音箱。并未连接成功，请不要只重复让我关闭旧手机蓝牙。';
 await continuity.getByLabel('纠正后的实际经历',{exact:true}).fill(corrected);await continuity.getByLabel('允许以后参考这条更正',{exact:true}).check();await continuity.getByLabel('允许云端 AI 使用这条更正',{exact:true}).check();
 const amendment=page.waitForResponse(r=>r.url()===base+'/api/foundation'&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='amend_outcome');await continuity.getByRole('button',{name:'确认更正经验',exact:true}).click();assert.ok((await amendment).ok());
 await fresh();const second=await ask(page,'根据我更正后的这次经历，我已经解决连接问题了吗？继续排查应该调整什么，别重复那个已经试过但无效的单一步骤。',report);save();assert.equal(second.reply.outcome,'answered');assert.ok(second.reply.memoryIds.includes(report.outcomeId));
 report.checks.push({name:'UI correction separately approved → fresh Qwen response uses current report',passed:true,semanticQuality:'review raw text for changed advice, not just mention of memory'});
 page.once('dialog',d=>d.accept());const forgotten=page.waitForResponse(r=>r.url()===base+'/api/foundation'&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='amend_outcome');await continuity.getByRole('button',{name:'忘记这条经验',exact:true}).click();assert.ok((await forgotten).ok());
 await fresh();const third=await ask(page,'请只按当前仍获准的信息回答：你能确认我之前是否连接成功、试过什么吗？没有记录就明确不知道。',report);save();assert.equal(third.reply.outcome,'answered');assert.ok(!third.reply.memoryIds.includes(report.outcomeId));
 report.checks.push({name:'UI forget → fresh Qwen has no revoked Outcome ID',passed:true,semanticQuality:'absence of old content must also be reviewed in logged provider packet'});
 await page.screenshot({path:root+'/'+stage+'-desktop.png'});await page.setViewportSize({width:390,height:844});await page.getByRole('region',{name:'物间统一对话',exact:true}).locator('.assistant-prose').last().scrollIntoViewIfNeeded();await page.screenshot({path:root+'/'+stage+'-mobile.png'});
}catch(e){report.errors.push(e.message);await page.screenshot({path:root+'/'+stage+'-failure.png'}).catch(()=>{});fs.writeFileSync('.runtime/'+stage+'-dom.txt',await page.locator('body').innerText().catch(()=>''));process.exitCode=1;}
finally{report.upstreamRequests=JSON.parse(fs.readFileSync(root+'/model-calls.json')).attempts.length-before;save();await browser.close();console.log(JSON.stringify({checks:report.checks,errors:report.errors,upstreamRequests:report.upstreamRequests}));}
