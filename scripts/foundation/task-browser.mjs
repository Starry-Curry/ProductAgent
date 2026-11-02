import {chromium,expect} from '@playwright/test';import fs from 'node:fs';import assert from 'node:assert/strict';
import {observeAssistant,ask} from '../practical/browser-helpers.mjs';
const base='http://127.0.0.1:3241',root='docs/engineering/qwen-foundation-2026-11-02/evidence';
const stage=process.argv.find(a=>a.startsWith('--stage='))?.slice(8)||'task-continuity-r1';
if(!/^task-continuity-r[1-9]$/.test(stage))throw Error('bad_stage');const file=root+'/'+stage+'.json';if(fs.existsSync(file))throw Error('preserve_evidence');
const itemId=JSON.parse(fs.readFileSync('.runtime/foundation-unfamiliar-item.json')).itemId;
const before=JSON.parse(fs.readFileSync(root+'/model-calls.json')).attempts.length;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),context=await browser.newContext({storageState:'.runtime/foundation-browser-state.json',viewport:{width:1440,height:1000}});await observeAssistant(context);const page=await context.newPage();
const report={at:new Date().toISOString(),basis:'real_browser_Qwen_Task_and_confirmed_synthetic_user_report_not_hardware',responses:[],checks:[],errors:[],pageErrors:[]};const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');page.on('pageerror',e=>report.pageErrors.push(e.message));
try{
 await page.goto(base+'/#item/'+itemId);const continuity=page.getByTestId('task-continuity');await continuity.locator('summary').first().click();
 const goal='准备SRS-XB100连接新手机的步骤清单，仅阅读准备，不初始化、不删除旧数据、不执行设备控制';
 await continuity.getByRole('textbox',{name:'新任务目标',exact:true}).fill(goal);
 const choose=continuity.locator('details').filter({has:page.getByText('选择这次相关的物品（可不选）',{exact:true})});await choose.locator('summary').click();
 const catalogue=await(await context.request.get(base+'/api/life')).json();
 // Read-only lookup disambiguates identical names created by preserved failure
 // runs. Click the actual rendered checkbox; never edit React or storage state.
 const index=catalogue.workspace.items.findIndex(i=>i.id===itemId);assert.ok(index>=0);
 await choose.getByRole('checkbox').nth(index).check();
 const create=page.waitForResponse(r=>r.url()===base+'/api/foundation'&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='create');
 await continuity.getByRole('button',{name:'开始并保留进度',exact:true}).click();const created=await(await create).json();assert.ok(created.task?.taskId);assert.deepEqual(created.task.itemInstanceIds,[itemId]);report.taskId=created.task.taskId;save();
 // Creating the task can auto-start its first model turn. Observe it before
 // sending another request, rather than racing a second run into the same task.
 await page.waitForFunction(()=>window.__assistantResults.length>0,undefined,{timeout:180000});
 const auto=await page.evaluate(()=>window.__assistantResults.at(-1));if(auto?.result?.reply)report.responses.push({question:goal,result:auto.result,autoStarted:true});save();
 let response=auto.result;
 if(!response?.reply?.actionCards?.some(c=>c.kind==='plan')){response=await ask(page,'请把刚才这件事整理为待我确认的行动计划卡，只引用已取得的SRS-XB100官方操作依据，手机侧条件未确认的保留，不要替我执行。',report);save();}
 assert.ok(response.reply.actionCards?.some(c=>c.kind==='plan'),'no real plan confirmation card');
 const card=response.reply.actionCards.find(c=>c.kind==='plan');assert.equal(card.status,'pending');
 const region=page.getByRole('region',{name:'物间统一对话',exact:true});const box=region.locator('.home-action-card').filter({has:page.getByRole('heading',{name:card.title,exact:true})});
 await box.getByRole('button',{name:card.confirmLabel,exact:true}).click();await expect(box.getByText('计划已保存，待你执行',{exact:true})).toBeVisible();report.checks.push({name:'same Task → model plan preview → explicit UI confirm → domain save',passed:true});
 await continuity.getByLabel('实际尝试结果',{exact:true}).fill('[合成报告，未操作硬件]我已读懂新增配对需按蓝牙键而非初始化；旧设备仍在附近时会先核对是否自动重连。仅证明完成阅读准备，不证明手机已连接。');
 await continuity.getByLabel('允许以后同一物品的任务参考这条结果（仍仅自己可见）',{exact:true}).check();await continuity.getByLabel('也允许本条结果交给云端 AI 帮助我（可不选）',{exact:true}).check();
 const outcome=page.waitForResponse(r=>r.url()===base+'/api/foundation'&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='outcome');
 await continuity.getByRole('button',{name:'确认：我已完成',exact:true}).click();const o=await(await outcome).json();assert.ok(o.outcome?.outcomeId);report.outcome=o.outcome;save();
 report.checks.push({name:'explicit synthetic result + separate future reuse/cloud opt-ins',passed:true});
 await page.screenshot({path:root+'/'+stage+'-desktop.png'});
 await page.goto(base+'/#home');if(await continuity.getAttribute('open')===null)await continuity.locator('summary').first().click();await continuity.getByRole('button',{name:'回到这件事',exact:true}).click();
 await page.getByLabel('使用已获准的个人记忆与经历（仅使用允许云端读取的内容，不自动保存新记忆）',{exact:true}).check();
 const follow=await ask(page,'我们刚才实际完成的是什么？下一步尝试连接时应避免重复做什么？请区分阅读准备和真实设备成功，不要把我的报告解释成你知道成功原因。',report);save();
 assert.equal(follow.foundation?.runId?.length>0,true);assert.equal(follow.session.known.foundationTaskId,report.taskId);
 assert.ok(follow.reply.memoryIds.includes(o.outcome.outcomeId),'approved experience did not reach response');
 report.checks.push({name:'home → same Task → approved result really enters later Qwen response',passed:true,semanticQuality:'independent raw source/answer review required'});
 await page.setViewportSize({width:390,height:844});await region.locator('.assistant-prose').last().scrollIntoViewIfNeeded();await page.screenshot({path:root+'/'+stage+'-mobile.png'});
}catch(e){report.errors.push(e.message);await page.screenshot({path:root+'/'+stage+'-failure.png'}).catch(()=>{});fs.writeFileSync('.runtime/'+stage+'-dom.txt',await page.locator('body').innerText().catch(()=>''));process.exitCode=1;}
finally{report.upstreamRequests=JSON.parse(fs.readFileSync(root+'/model-calls.json')).attempts.length-before;save();await browser.close();console.log(JSON.stringify({checks:report.checks,errors:report.errors,upstreamRequests:report.upstreamRequests}));}
