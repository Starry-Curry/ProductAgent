import {chromium,expect} from '@playwright/test';import fs from 'node:fs';import {ROOT} from './gateway.mjs';import {observeAssistant,ask} from './browser-helpers.mjs';
const stage=process.argv.find(s=>s.startsWith('--stage='))?.slice(8)||'experience-browser-v1';if(!/^[a-z0-9-]+$/.test(stage)||fs.existsSync(ROOT+'/'+stage+'.json'))throw Error('unique_stage_required');
const report={at:new Date().toISOString(),basis:'synthetic_user_report_not_hardware_verification',responses:[],checks:[],errors:[]},ledger=()=>JSON.parse(fs.readFileSync(ROOT+'/model-calls.json')).attempts,before=ledger().length;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),context=await browser.newContext({storageState:'.runtime/practical-browser-state.json',viewport:{width:1440,height:1000}});await observeAssistant(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));const ids=JSON.parse(fs.readFileSync('.runtime/practical-browser-item.json'));
const expand=async w=>{if(!await w.evaluate(e=>e.open))await w.locator('summary').first().click();};
const waitAction=action=>page.waitForResponse(r=>r.url().endsWith('/api/foundation')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action===action);
async function freshQuestion(question){await page.goto('http://127.0.0.1:3232/?journey='+Date.now()+'#item/'+ids.sonyItemId);await page.getByRole('region',{name:'物间统一对话',exact:true}).waitFor();await expect(page).toHaveURL(new RegExp('#item/'+ids.sonyItemId+'$'));await page.getByLabel('使用这件物品已获准的故事与经验',{exact:true}).check();return ask(page,question,report);}
try{
 if(process.argv.includes('--verify-forgotten')){
  const prior=JSON.parse(fs.readFileSync(ROOT+'/experience-browser-v4.json'));report.taskId=prior.taskId;report.previousEvidence='experience-browser-v4.json';
  const r=await freshQuestion('WH-CH520连不上，先说明你能参考哪些我允许保留的尝试记录。没有就说明没有，不要猜。');
  const detail=await(await page.request.get('http://127.0.0.1:3232/api/foundation?taskId='+report.taskId)).json();report.afterForget={outcomes:detail.outcomes};
  report.checks.push({name:'遗忘后正文为空且新会话无这条经验',passed:detail.outcomes.some(o=>o.status==='forgotten'&&!o.notes)&&!r.reply.memoryIds.includes(prior.forgotten.outcome.outcomeId)});
  await page.screenshot({path:ROOT+'/experience-after-forget.png'});await page.setViewportSize({width:390,height:844});await page.locator('.assistant-prose').last().scrollIntoViewIfNeeded();await page.screenshot({path:ROOT+'/experience-mobile.png'});
 }else{
 await page.goto('http://127.0.0.1:3232/#assistant');await page.getByLabel('使用已获准的个人记忆与经历',{exact:false}).check();
 const continuity=page.getByTestId('task-continuity');await expand(continuity);
 const resume=process.argv.includes('--resume-v2')?JSON.parse(fs.readFileSync(ROOT+'/experience-browser-v2.json')):null;
 if(resume){report.taskId=resume.taskId;report.saved=resume.saved;await continuity.getByRole('button',{name:'[合成任务]我的Sony WH-CH520在原手机连接失败，请用已有资料指导。',exact:true}).first().click();}else{
 await continuity.getByLabel('新任务目标',{exact:true}).fill('[合成任务]我的Sony WH-CH520在原手机连接失败，请用已有资料指导。');
 await continuity.getByText('选择这次相关的物品（可不选）',{exact:true}).click();await continuity.getByLabel('[模拟持有]我的Sony耳机',{exact:false}).check();
 const created=waitAction('create');await continuity.getByRole('button',{name:'开始并保留进度',exact:true}).click();const d=await(await created).json();report.taskId=d.task.taskId;
 await page.waitForFunction(()=>window.__assistantResults?.some(r=>r.result?.reply),null,{timeout:130000});report.responses.push({question:d.task.goal,result:await page.evaluate(()=>window.__assistantResults.at(-1).result),purpose:'create_real_task_run'});
 // Wait for the task widget's read-only refresh to see the completed advice run.
 await continuity.getByLabel('实际尝试结果',{exact:true}).waitFor({timeout:15000});
 const original='[合成经历，非硬件验证]同一台原手机上，正确进入5秒配对模式后反复移近和重开蓝牙仍未解决；换另一台手机能够连接。成功原因没有查明。';
 await continuity.getByLabel('实际尝试结果',{exact:true}).fill(original);await continuity.getByLabel('允许以后同一物品的任务参考这条结果（仍仅自己可见）',{exact:true}).check();await continuity.getByLabel('也允许本条结果交给云端 AI 帮助我（可不选）',{exact:true}).check();
 const saved=waitAction('outcome');await continuity.getByRole('button',{name:'确认：还没解决',exact:true}).click();const savedResponse=await saved;report.saved=await savedResponse.json();if(!savedResponse.ok())throw Error(JSON.stringify(report.saved));
 }
 const q='同一台原手机又连不上WH-CH520。我不想重复已经失败的办法，也不做初始化，下一步怎么排查？请参考我允许保存的这件耳机的经历。';
 const used=await freshQuestion(q);report.checks.push({name:'跨会话实际使用已获准经验',passed:used.reply.memoryIds.length>0,needsHumanReview:'是否避开无效步骤、是否不编造因果'});await page.screenshot({path:ROOT+'/experience-before-correction.png'});
 const widget=page.getByTestId('task-continuity');await expand(widget);await widget.getByRole('button',{name:'纠正这条经验',exact:true}).click();
 const correction='[合成更正，非硬件验证]另一台手机其实也没连上；原记录的“换手机能够连接”不正确。移近、重开蓝牙和反复配对仍未解决，原因未知。';
 await widget.getByLabel('纠正后的实际经历',{exact:true}).fill(correction);await widget.getByLabel('允许以后参考这条更正',{exact:true}).check();await widget.getByLabel('允许云端 AI 使用这条更正',{exact:true}).check();
 const corrected=waitAction('amend_outcome');await widget.getByRole('button',{name:'确认更正经验',exact:true}).click();report.corrected=await(await corrected).json();
 const revised=await freshQuestion(q);report.checks.push({name:'纠正后新会话仍取到有效经验',passed:revised.reply.memoryIds.length>0,needsHumanReview:'不再把换手机可连接当事实'});
 const w=page.getByTestId('task-continuity');await expand(w);const revoked=waitAction('amend_outcome');await w.getByRole('button',{name:'不再复用',exact:true}).click();report.revoked=await(await revoked).json();
 const after=await freshQuestion('WH-CH520连不上，请先说明你现在能参考哪些我此前的尝试记录；没有记录就说明没有，不要猜。');report.checks.push({name:'撤销复用后新会话不携带这条经验',passed:!after.reply.memoryIds.some(id=>used.reply.memoryIds.includes(id))});
 const last=page.getByTestId('task-continuity');await expand(last);page.once('dialog',d=>d.accept());const forgotten=waitAction('amend_outcome');await last.getByRole('button',{name:'忘记这条经验',exact:true}).click();report.forgotten=await(await forgotten).json();await expect(last.getByText('这条经验已忘记',{exact:true})).toBeVisible();
 const detail=await(await page.request.get('http://127.0.0.1:3232/api/foundation?taskId='+report.taskId)).json();report.afterForget={outcomes:detail.outcomes};if(JSON.stringify(detail.outcomes).includes(original)||JSON.stringify(detail.outcomes).includes(correction))throw Error('forgotten_body_still_exposed');
 report.checks.push({name:'真实UI遗忘后当前记录不再返回经历正文',passed:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:ROOT+'/experience-mobile.png'});
 }
 if(report.checks.some(c=>!c.passed))throw Error('experience_contract_failed');
}catch(e){report.errors.push(e.message);fs.writeFileSync('.runtime/experience-failure-dom.txt',await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:ROOT+'/'+stage+'-failure.png'}).catch(()=>{});process.exitCode=1;}
finally{report.upstreamRequests=ledger().length-before;fs.writeFileSync(ROOT+'/'+stage+'.json',JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({checks:report.checks,errors:report.errors,upstreamRequests:report.upstreamRequests}));}
