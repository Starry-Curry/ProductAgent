import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {observeAssistant,ask,createUIItem} from '../practical/browser-helpers.mjs';
import {randomBytes} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {readKnowledge,storeOfficialDocument} from '../../src/lib/life/acquisition.ts';
import {ROOT,ROUND} from './gateway.mjs';
const base='http://127.0.0.1:3242',stage=process.argv.find(a=>a.startsWith('--attempt='))?.slice(10)||'r1';
process.env.WUJIAN_TEST_URL=base;
assert.match(stage,/^r\d+$/);const file=ROOT+'/experience-browser-'+stage+'.json';assert.ok(!fs.existsSync(file),'preserve first answers');
const seed=JSON.parse(fs.readFileSync(ROOT+'/brother-browser-r2.json'));let itemId=seed.item.id;const isolated=process.argv.includes('--isolated');
const ledger=()=>JSON.parse(fs.readFileSync(ROOT+'/model-calls.json'));const before=ledger().attempts.length;
const report={at:new Date().toISOString(),round:ROUND,basis:'real_UI_and_Qwen_synthetic_failed_attempt_not_hardware_verification',itemId,responses:[],checks:[],errors:[],pageErrors:[],quality:'requires_independent_original_output_review'};
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));save();
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({...(!isolated?{storageState:'.runtime/finals-brother-r2-state.json'}:{}),viewport:{width:1440,height:1000}});await observeAssistant(context);const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
const continuity=page.getByTestId('task-continuity');
async function fresh(){const region=page.getByRole('region',{name:'物间统一对话',exact:true}),options=region.locator('.conversation-options');await region.getByRole('button',{name:'开始新问题',exact:true}).click();if(await options.getAttribute('open')===null)await options.locator('summary').click();await expect(options.locator('select').first()).toHaveValue('');await page.getByLabel('使用已获准的个人记忆与经历（仅使用允许云端读取的内容，不自动保存新记忆）',{exact:true}).check();}
async function action(name,fn){const next=page.waitForResponse(r=>r.url()===base+'/api/foundation'&&r.request().method()==='POST'&&r.request().postDataJSON()?.action===name);await fn();const r=await next,d=await r.json();assert.ok(r.ok(),d.error);return d;}
try{
 if(isolated){
  await page.goto(base);await page.getByLabel('用户名',{exact:true}).fill('决赛独立经验'+Date.now());await page.getByLabel('口令',{exact:true}).fill(randomBytes(18).toString('hex'));await page.getByLabel('第一次使用，创建独立账号',{exact:true}).check();await page.getByRole('button',{name:'进入我的物间',exact:true}).click();await page.getByRole('button',{name:'生活首页',exact:true}).waitFor();
  const own=await createUIItem(page,{name:'[合成]标签机经验独立验收',brand:'Brother',model:'PT-D210'},report);itemId=own.id;report.itemId=itemId;
  // This is an explicit integration fixture, not a claim of fresh discovery:
  // reuse ONLY existing public manufacturer documents, through domain writes,
  // in the fixed synthetic preview DB. No donor Task, story or private state.
  const db=new DatabaseSync('.runtime/finals-product-preview/demo.sqlite');try{const state=JSON.parse(db.prepare('SELECT body FROM workspace WHERE id=1').get().body),donor=state.items.find(i=>i.id===seed.item.id);assert.ok(donor?.synthetic&&own.synthetic);const docs=readKnowledge(db,state,donor.owner,donor.id);assert.ok(docs.length);for(const d of docs)storeOfficialDocument(db,own.owner,own,d);report.publicCacheFixture={basis:'existing_actual_official_documents_reused_not_new_discovery',documents:docs.map(d=>({url:d.url,hash:d.hash,model:d.model}))};}finally{db.close();}
  await context.storageState({path:'.runtime/finals-experience-'+stage+'-state.json'});save();
 }
 await page.goto(base+'/#item/'+itemId);await continuity.locator('summary').first().click();
 const goal='[合成持有、非实物操作]我有PT-D210和6毫米标签带，想把姓名和电话做得容易读。不能买带子，不恢复出厂；请按已取得的官方资料给可尝试的选择，并保留这件事。';
 await continuity.getByRole('textbox',{name:'新任务目标',exact:true}).fill(goal);
 const choose=continuity.locator('details').filter({has:page.getByText('选择这次相关的物品（可不选）',{exact:true})});await choose.locator('summary').click();const life=await(await context.request.get(base+'/api/life')).json(),index=life.workspace.items.findIndex(i=>i.id===itemId);assert.ok(index>=0);await choose.getByRole('checkbox').nth(index).check();
 const created=await action('create',()=>continuity.getByRole('button',{name:'开始并保留进度',exact:true}).click());report.taskId=created.task.taskId;save();
 await page.waitForFunction(()=>window.__assistantResults.length>0,undefined,{timeout:180000});const first=await page.evaluate(()=>window.__assistantResults.at(-1));assert.ok(first.result?.reply);assert.ok(first.result.modelCalls>0);report.responses.push({question:goal,result:first.result,autoStarted:true});save();
 assert.equal(first.result.session.known.foundationTaskId,report.taskId);
 report.checks.push({name:'existing_Task_and_real_Qwen_share_identity_and_official_knowledge',passed:true,semanticReviewRequired:true});
 await continuity.getByLabel('实际尝试结果',{exact:true}).fill('[明确合成尝试，未操作真实设备]我试过把姓名和电话拆成两条6毫米标签，但这个位置容不下两条；不是打印机不能打印。我现在只需要姓名。下次不要重复推荐两条并排，也不要推断这是胶带或电池故障。');
 await continuity.getByLabel('允许以后同一物品的任务参考这条结果（仍仅自己可见）',{exact:true}).check();await continuity.getByLabel('也允许本条结果交给云端 AI 帮助我（可不选）',{exact:true}).check();
 const outcome=await action('outcome',()=>continuity.getByRole('button',{name:'确认：还没解决',exact:true}).click());report.outcomeId=outcome.outcome.outcomeId;save();
 await page.goto(base+'/#home');if(await continuity.getAttribute('open')===null)await continuity.locator('summary').click();await continuity.locator('button[data-task-id="'+report.taskId+'"]').click();await fresh();
 const reused=await ask(page,'这台标签机的姓名标签这件事还没解决。结合我获准保存的尝试和现在的目标，给我不同的下一步；不能购买，不恢复出厂，别猜失败原因。',report);save();assert.ok(reused.modelCalls>0);assert.ok(reused.reply.memoryIds.includes(report.outcomeId));assert.notEqual(reused.session.id,first.result.session.id);assert.equal(reused.session.known.foundationTaskId,report.taskId);
 report.checks.push({name:'cross_entry_new_Qwen_session_receives_failed_Outcome_same_Task',passed:true,semanticReviewRequired:true});
 await continuity.getByRole('button',{name:'纠正这条经验',exact:true}).click();await continuity.getByLabel('纠正后的实际经历',{exact:true}).fill('[合成更正]我只做过纸面规划，没有打印过两条标签，也没有证实放不下。现在只想打印姓名；两条不适合只是旧假设。不能把旧假设称为实际操作失败。');await continuity.getByLabel('允许以后参考这条更正',{exact:true}).check();await continuity.getByLabel('允许云端 AI 使用这条更正',{exact:true}).check();await action('amend_outcome',()=>continuity.getByRole('button',{name:'确认更正经验',exact:true}).click());await fresh();
 const corrected=await ask(page,'按我最新更正的经历，我实际尝试过什么？现在如何继续姓名标签？请区分规划、假设与实物操作，不要重复旧的失败说法。',report);save();assert.ok(corrected.reply.memoryIds.includes(report.outcomeId));report.checks.push({name:'corrected_report_used_in_new_session',passed:true,semanticReviewRequired:true});
 page.once('dialog',d=>d.accept());await action('amend_outcome',()=>continuity.getByRole('button',{name:'忘记这条经验',exact:true}).click());await fresh();
 const forgotten=await ask(page,'现在还有我这台标签机的获准尝试经历吗？没有就说不知道。官方资料和我是否真正打印过必须分开。',report);save();assert.ok(!forgotten.reply.memoryIds.includes(report.outcomeId));report.checks.push({name:'forgotten_report_not_sent_to_new_Qwen_session',passed:true,semanticReviewRequired:true});
 const foreign=await browser.newContext();try{const denied=await foreign.request.get(base+'/api/foundation?taskId='+report.taskId);assert.ok([401,403].includes(denied.status()));report.checks.push({name:'unauthenticated_Task_read_denied',passed:true});}finally{await foreign.close();}
 await page.screenshot({path:ROOT+'/experience-'+stage+'-desktop.png'});await page.setViewportSize({width:390,height:844});await page.getByRole('region',{name:'物间统一对话',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:ROOT+'/experience-'+stage+'-mobile.png'});
 report.status='executed_protocol_passed_quality_requires_review';
}catch(e){report.status='failed';report.errors.push(e.message);process.exitCode=1;await page.screenshot({path:ROOT+'/experience-'+stage+'-failure.png'}).catch(()=>{});fs.writeFileSync('.runtime/experience-'+stage+'-dom.txt',await page.locator('body').innerText().catch(()=>''));}
finally{report.upstreamRequests=ledger().attempts.length-before;save();await browser.close();console.log(JSON.stringify({status:report.status,requests:report.upstreamRequests,checks:report.checks,errors:report.errors}));}
