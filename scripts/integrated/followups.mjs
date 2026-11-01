import {chromium,expect} from '@playwright/test';import fs from 'node:fs';
import {ROOT} from './gateway.mjs';import {observeAssistant,ask} from '../practical/browser-helpers.mjs';
const stage=process.argv.find(a=>a.startsWith('--stage='))?.slice(8)||'geometry-followup';if(!/^[a-z0-9-]+$/.test(stage)||fs.existsSync(ROOT+'/'+stage+'.json'))throw Error('unique_stage_required');
const base='http://127.0.0.1:3233',count=()=>JSON.parse(fs.readFileSync(ROOT+'/model-calls.json')).attempts.length,before=count();
const report={at:new Date().toISOString(),stage,basis:'real_browser_and_qwen_synthetic_items_no_hardware',responses:[],checks:[],errors:[]};
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),context=await browser.newContext({storageState:'.runtime/practical-browser-state.json',viewport:{width:1440,height:1000}});await observeAssistant(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
try{
 const auth=page.waitForResponse(r=>r.url().endsWith('/api/account')&&r.request().method()==='GET');await page.goto(base+'/');if(!(await(await auth).json()).account){const login=JSON.parse(fs.readFileSync('.runtime/continuation-fixture-login.json'));await page.getByLabel('用户名',{exact:true}).fill(login.name);await page.getByLabel('口令',{exact:true}).fill(login.password);await page.getByRole('button',{name:'进入我的物间',exact:true}).click();}await page.getByRole('button',{name:'生活首页',exact:true}).waitFor();
 if(stage.startsWith('geometry')){
  const prior=JSON.parse(fs.readFileSync(ROOT+'/new-combination-final.json')),id=prior.responses[0].result.foundation.taskId;report.taskId=id;
  await page.goto(base+'/#assistant');const w=page.getByTestId('task-continuity');await w.locator('summary').first().click();await w.locator('[data-task-id="'+id+'"]').click();await page.locator('.assistant-prose').last().waitFor();
  await ask(page,'请重新核对刚才方案：40×30厘米平面画完整放入16:9横幅时应该怎样留边？请调用比例计算工具分别算完整容纳与铺满裁切，别把二者混说。并重新读取EOS R8官方录像章节核对照片/录像开关和模式转盘的作用，不套用别的型号。不要给固定拍摄距离，也不新增任何物品。',report);
  const calls=JSON.parse(fs.readFileSync(ROOT+'/model-calls.json')).attempts.slice(before);report.checks.push({name:'真实模型确实调用frame比例计算，不以回答里声称算过替代',passed:calls.some(a=>a.output?.tool_calls?.some(t=>{try{return t.function.name==='check_constraints'&&JSON.parse(t.function.arguments).kind==='frame';}catch{return false;}}))});
  // Cancel the stale proposal through the UI; it was never confirmed or executed.
  const cancel=page.getByRole('button',{name:'暂不执行',exact:true});if(await cancel.count())await cancel.first().click();
 }else if(stage.startsWith('natural-story')){
  const a=await(await page.request.get(base+'/api/account')).json(),prior=await page.evaluate(id=>localStorage.getItem('wujian-task:'+id),a.account.id);
  if(prior){const w=page.getByTestId('task-continuity');await w.locator('summary').first().click();await w.getByRole('button',{name:'暂时离开这件事',exact:true}).click();}
  const ids=JSON.parse(fs.readFileSync('.runtime/additional-items.json'));await page.goto(base+'/#item/'+ids.cameraId);await page.getByRole('region',{name:'物间统一对话',exact:true}).waitFor();
  await ask(page,'请保存这台相机的一段私人故事：[合成测试]今天想为爸爸录下一次做饭经历，只保存这个想法，没有实际拍摄。不要说已经拍成，也不允许长期检索或分享。先给我确认。',report);
  const confirmation=page.waitForResponse(r=>r.url().endsWith('/api/home')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='confirm');await page.getByRole('button',{name:'确认保存私人故事',exact:true}).click();const r=await confirmation;report.confirmation=await r.json();if(!r.ok())throw Error('confirmation_failed');
  if(!report.confirmation.taskId)throw Error('domain_task_not_connected');
  await expect(page.getByText('私人故事已保存，未授权检索或分享',{exact:true})).toBeVisible();
  const next=await ask(page,'刚才保存的只是一个合成想法，并未实际拍摄。请说明现在可以怎样继续这件事，不要当成已经实现的设备结果。',report);
  report.checks.push({name:'不预建Task，确认故事后领域Task连回原对话且下一轮沿用',passed:next.foundation?.taskId===report.confirmation.taskId&&next.session.id===report.responses[0].result.session.id});
 }
 await page.locator('.assistant-prose').last().scrollIntoViewIfNeeded();await page.screenshot({path:ROOT+'/'+stage+'-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:ROOT+'/'+stage+'-mobile.png'});report.mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);if(report.checks.some(c=>!c.passed)||report.mobileOverflow)throw Error('followup_contract_failed');await context.storageState({path:'.runtime/practical-browser-state.json'});
}catch(e){report.errors.push(e.message);await page.screenshot({path:ROOT+'/'+stage+'-failure.png'}).catch(()=>{});process.exitCode=1;}finally{report.modelRequests=count()-before;fs.writeFileSync(ROOT+'/'+stage+'.json',JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({stage,checks:report.checks,requests:report.modelRequests,errors:report.errors}));}
