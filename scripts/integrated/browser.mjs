import {chromium,expect} from '@playwright/test';import fs from 'node:fs';
import {ROOT} from './gateway.mjs';import {observeAssistant,createUIItem,ask} from '../practical/browser-helpers.mjs';
process.env.WUJIAN_TEST_URL='http://127.0.0.1:3233';const base=process.env.WUJIAN_TEST_URL;
const stage=process.argv.find(a=>a.startsWith('--stage='))?.slice(8)||'canon-r8';if(!/^[a-z0-9-]+$/.test(stage)||fs.existsSync(ROOT+'/'+stage+'.json'))throw Error('unique_stage_required');
const file=ROOT+'/'+stage+'.json',report={stage,at:new Date().toISOString(),basis:'real_browser_real_qwen_synthetic_ownership_no_hardware',responses:[],checks:[],errors:[]};
const count=()=>JSON.parse(fs.readFileSync(ROOT+'/model-calls.json')).attempts.length,before=count();
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const context=await browser.newContext({storageState:'.runtime/practical-browser-state.json',viewport:{width:1440,height:1000}});await observeAssistant(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
try{
 const auth=page.waitForResponse(r=>r.url().endsWith('/api/account')&&r.request().method()==='GET');await page.goto(base+'/');if(!(await(await auth).json()).account){const login=JSON.parse(fs.readFileSync('.runtime/continuation-fixture-login.json'));await page.getByLabel('用户名',{exact:true}).fill(login.name);await page.getByLabel('口令',{exact:true}).fill(login.password);await page.getByRole('button',{name:'进入我的物间',exact:true}).click();}await page.getByRole('button',{name:'生活首页',exact:true}).waitFor();await context.storageState({path:'.runtime/practical-browser-state.json'});
 if(!stage.startsWith('cross')){
  const a=await(await page.request.get(base+'/api/account')).json();
  const prior=await page.evaluate(id=>localStorage.getItem('wujian-task:'+id),a.account.id);
  if(prior){const w=page.getByTestId('task-continuity');await w.locator('summary').first().click();await w.getByRole('button',{name:'暂时离开这件事',exact:true}).click();}
 }
 if(stage.startsWith('canon')){
  const item=await createUIItem(page,{name:'[模拟持有]陌生EOS R8',brand:'Canon',model:'EOS R8'},report);report.item={id:item.id,model:item.model,supportUrl:item.supportUrl||null};
  await ask(page,'这台EOS R8怎样开始和停止录视频？请读取该型号官方手册，只给当前必要操作；固件与镜头未知。',report);await ask(page,'还是这台相机，照片快门直接能当录像键吗？按钮图示不能识别就明确说未知，不要猜位置。',report);
 }else if(stage.startsWith('sony')){
  const url='https://helpguide.sony.net/speaker/7856/v1/en/contents/TP1000946321.html';
  const item=await createUIItem(page,{name:'[模拟持有]蓝牙小音箱',brand:'Sony',model:'SRS-XB100',url:stage.includes('fallback')?url:undefined},report);report.item={id:item.id,supportUrl:item.supportUrl||null};report.acquisitionMode=stage.includes('fallback')?'operator_provided_verified_url_not_autonomous':'no_url';
  await ask(page,'这台SRS-XB100已经连过别人的手机，现在怎样与我的手机配对？请依该型号官方指南回答，按键是短按还是长按、几秒不能猜。',report);
  if(stage.includes('fallback'))await ask(page,'怎么判断已经进入配对模式？请只用刚才的型号指南。',report);
 }else if(stage.startsWith('new-combination')){
  let lamp;try{lamp=await createUIItem(page,{name:'[模拟持有]画作补光台灯'+stage,brand:'Xiaomi',model:'MJTD01SYL',url:'https://www.mi.com/mjsmartlamp-1s/specs'},report);}catch(e){report.lampOfficialFetchFailed=e.message;lamp=await createUIItem(page,{name:'[模拟持有]画作补光台灯'+stage,brand:'Xiaomi',model:'MJTD01SYL'},report);}
  const painting=await createUIItem(page,{name:'[模拟持有]想送给爸爸的画'+stage,brand:'无品牌',model:'原创手绘画'},report);
  await page.goto(base+'/#assistant');const w=page.getByTestId('task-continuity');await w.locator('summary').first().click();
  const goal='想把我准备送给爸爸的手绘画录成十秒短片，安静、保留原色，不做夸张特效。我现有EOS R8、米家台灯1S和这幅画。画是40×30厘米的合成用户报告，平放在现有桌面上，台灯已由我打开。只用这些物品，不另找反光板、架子或夹子，不让画框自己站立。不需要教我调光或联网，不控制设备。镜头和固件未知。请给画面与侧光安排、录像开始停止及必要的检查，并准备可保存的简短候选计划。';
  await w.getByLabel('新任务目标',{exact:true}).fill(goal);await w.getByText('选择这次相关的物品（可不选）',{exact:true}).click();await w.getByLabel('[模拟持有]陌生EOS R8',{exact:false}).last().check();await w.getByLabel(lamp.name,{exact:false}).check();await w.getByLabel(painting.name,{exact:false}).check();await w.getByRole('button',{name:'开始并保留进度',exact:true}).click();
  await page.waitForFunction(()=>window.__assistantResults.some(r=>r.result?.reply),null,{timeout:180000});report.responses.push({question:goal,result:await page.evaluate(()=>window.__assistantResults.at(-1).result)});
 }else if(stage.startsWith('cross')){
  const ids=JSON.parse(fs.readFileSync('.runtime/practical-cross-items.json'));
  await page.goto(base+'/#assistant');await page.getByLabel('使用已获准的个人记忆与经历',{exact:false}).check();const w=page.getByTestId('task-continuity');await w.locator('summary').first().click();
  const goal='只用我登记的EOS R50相机、Osmo Mobile 6云台给爸爸拍做饭视频，不买东西，没有已知三脚架、支撑物或配件，镜头和固件未知。相机能装这台云台吗？我的手机实测310克、宽75毫米、厚8毫米。先核对必要条件，然后给我和爸爸可以照做的分工与三个视频镜头；照片功能不能当视频功能。';
  await w.getByLabel('新任务目标',{exact:true}).fill(goal);await w.getByText('选择这次相关的物品（可不选）',{exact:true}).click();await w.getByLabel('[模拟持有]拍家庭视频的相机',{exact:false}).check();await w.getByLabel('[模拟持有]手机云台',{exact:false}).check();await w.getByRole('button',{name:'开始并保留进度',exact:true}).click();await page.waitForFunction(()=>window.__assistantResults.some(r=>r.result?.reply),null,{timeout:180000});report.responses.push({question:goal,result:await page.evaluate(()=>window.__assistantResults.at(-1).result)});
  const first=report.responses.at(-1).result;
  const planned=first.reply.actionCards?.some(c=>c.kind==='plan')?first:await ask(page,'把有条件的猜想先留下，只为目前可用的资源准备可保存的拍摄计划预览。不要加入未登记的支架、书或袋子。',report);
  const card=planned.reply.actionCards?.find(c=>c.kind==='plan');
  if(!card)throw Error('no_confirmable_plan');
  const confirmed=page.waitForResponse(r=>r.url().endsWith('/api/home')&&r.request().method()==='POST'&&r.request().postDataJSON()?.id===card.id);
  await page.locator('.home-action-card').last().getByRole('button',{name:'保存这份计划',exact:true}).click();const receipt=await confirmed;report.confirmedPlan=await receipt.json();if(!receipt.ok())throw Error('plan_confirmation_failed');
  const taskId=planned.foundation.taskId;const task=await(await page.request.get(base+'/api/foundation?taskId='+taskId)).json();
  report.checks.push({name:'确认后的方案实际进入同一Task，非模型自行声称已保存',passed:task.plans?.some(p=>p.id===report.confirmedPlan.targetId)});
  if(report.checks.some(c=>!c.passed))throw Error('saved_plan_not_in_task');
 }else if(stage.startsWith('story')){
  const ids=JSON.parse(fs.readFileSync('.runtime/additional-items.json'));await page.goto(base+'/#item/'+ids.cameraId);await page.getByRole('region',{name:'物间统一对话',exact:true}).waitFor();
  await ask(page,'请把下面这段经历保存为这件相机的私人故事：[合成测试，未实际拍摄]今天我为爸爸录做饭片段，专用短片按钮完成了录制；为什么成功还不知道。不允许给云端长期检索，也不要与家人共享。先给我确认卡。',report);
  const b=page.getByRole('button',{name:'确认保存私人故事',exact:true});await b.waitFor({timeout:10000});await b.click();await expect(page.getByText('私人故事已保存，未授权检索或分享',{exact:true})).toBeVisible();report.checks.push({name:'story_explicit_confirmation',passed:true});
 }
 await page.locator('.assistant-prose').last().scrollIntoViewIfNeeded();await page.screenshot({path:ROOT+'/'+stage+'-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:ROOT+'/'+stage+'-mobile.png'});report.mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);await context.storageState({path:'.runtime/practical-browser-state.json'});
}catch(e){report.errors.push(e.message);await page.screenshot({path:ROOT+'/'+stage+'-failure.png'}).catch(()=>{});fs.writeFileSync('.runtime/integrated-'+stage+'-dom.txt',await page.locator('body').innerText().catch(()=>''));process.exitCode=1;}finally{report.modelRequests=count()-before;fs.writeFileSync(file,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({stage,requests:report.modelRequests,responses:report.responses.length,errors:report.errors}));}
