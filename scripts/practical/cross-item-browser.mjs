import {chromium} from '@playwright/test';import fs from 'node:fs';import {ROOT} from './gateway.mjs';import {observeAssistant,createUIItem,ask} from './browser-helpers.mjs';
const stage=process.argv.find(s=>s.startsWith('--stage='))?.slice(8)||'cross-item-browser-v1';if(!/^[a-z0-9-]+$/.test(stage)||fs.existsSync(ROOT+'/'+stage+'.json'))throw Error('unique_stage_required');
const report={at:new Date().toISOString(),syntheticOwnership:true,physicalTests:0,responses:[],checks:[],errors:[],acquisitions:[]},ledger=()=>JSON.parse(fs.readFileSync(ROOT+'/model-calls.json')).attempts,before=ledger().length;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),context=await browser.newContext({storageState:'.runtime/practical-browser-state.json',viewport:{width:1440,height:1000}});await observeAssistant(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
try{
 let camera,gimbal;
 if(process.argv.includes('--reuse-items')){const ids=JSON.parse(fs.readFileSync('.runtime/practical-cross-items.json'));camera={id:ids.cameraId,model:'EOS R50',name:'[模拟持有]拍家庭视频的相机'};gimbal={id:ids.gimbalId,model:'Osmo Mobile 6',name:'[模拟持有]手机云台'};report.reusedOfficialAcquisitionEvidence='cross-item-browser-v1.json';}else{
 camera=await createUIItem(page,{name:'[模拟持有]拍家庭视频的相机',brand:'Canon',model:'EOS R50',url:'https://www.canon.com.cn/product/r50/'},report);report.acquisitions.push(report.acquisition);
 gimbal=await createUIItem(page,{name:'[模拟持有]手机云台',brand:'DJI',model:'Osmo Mobile 6',url:'https://dl.djicdn.com/downloads/DJI_Osmo_Mobile_6/UM/20260520/Osmo_Mobile_6_User_Manual_V1.8_en.pdf'},report);report.acquisitions.push(report.acquisition);delete report.acquisition;}
 report.items=[{id:camera.id,model:camera.model},{id:gimbal.id,model:gimbal.model}];
 await page.goto('http://127.0.0.1:3232/#assistant');await page.getByLabel('使用已获准的个人记忆与经历',{exact:false}).check();const w=page.getByTestId('task-continuity');await w.locator('summary').first().click();
 const goal='想用已有EOS R50相机和Osmo Mobile 6给爸爸拍一段做饭视频，爸爸不会摄影，不买新配件。能把相机装到这台云台上吗？我的手机实测310克、宽75毫米、厚8毫米。请先核对兼容条件，再安排现有物品怎样完成视频；不适合的东西可以不用。';
 await w.getByLabel('新任务目标',{exact:true}).fill(goal);await w.getByText('选择这次相关的物品（可不选）',{exact:true}).click();await w.getByLabel(camera.name,{exact:false}).check();await w.getByLabel(gimbal.name,{exact:false}).check();await w.getByRole('button',{name:'开始并保留进度',exact:true}).click();
 await page.waitForFunction(()=>window.__assistantResults?.some(r=>r.result?.reply),null,{timeout:130000});const r=await page.evaluate(()=>window.__assistantResults.at(-1).result);report.responses.push({question:goal,result:r});
 report.checks.push({name:'两件真实型号及官方资料进入同一任务',passed:r.reply.usedItems.some(i=>i.id===camera.id)&&r.reply.usedItems.some(i=>i.id===gimbal.id)&&r.reply.citations.some(c=>c.url.includes('dji'))});
 report.checks.push({name:'310与290出现在回答中（仅定位待审部分，不验证比较结论或资源约束）',passed:/290/.test(r.reply.answer)&&/310/.test(r.reply.answer),needsHumanReview:true});await page.screenshot({path:ROOT+'/'+stage+'-desktop.png'});
 await ask(page,'好，就按不使用云台的方案。请给我和爸爸一个可以照着拍的短视频分工和三个镜头；现有镜头、三脚架和相机固件信息都未知，不要假设有。',report);
 await page.setViewportSize({width:390,height:844});await page.locator('.assistant-prose').last().scrollIntoViewIfNeeded();await page.screenshot({path:ROOT+'/'+stage+'-mobile.png'});
 fs.writeFileSync('.runtime/practical-cross-items.json',JSON.stringify({cameraId:camera.id,gimbalId:gimbal.id}));if(report.checks.some(c=>!c.passed))throw Error('cross_item_contract_failed');
}catch(e){report.errors.push(e.message);fs.writeFileSync('.runtime/cross-item-failure-dom.txt',await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:ROOT+'/'+stage+'-failure.png'}).catch(()=>{});process.exitCode=1;}
finally{report.upstreamRequests=ledger().length-before;fs.writeFileSync(ROOT+'/'+stage+'.json',JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({checks:report.checks,errors:report.errors,upstreamRequests:report.upstreamRequests}));}
