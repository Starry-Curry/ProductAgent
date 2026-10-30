import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3219';
const root='docs/engineering/unified-foundation-v2-2026-10-30', dir=root+'/evidence';
fs.mkdirSync(dir,{recursive:true});
const suite=fs.readFileSync(root+'/package/wujian_realworld_acceptance_v1.jsonl','utf8').trim().split('\n').map(JSON.parse);
const results=suite.map(c=>({id:c.id,mode:c.mode,status:c.mode==='live_model'?'blocked_model_budget':'not_run',method:'',actual_result:c.mode==='live_model'?'本轮没有新付费授权；未调用模型，旧150次台账未改变':'',evidence_ref:'',verified_by:'',note:''}));
const report={at:new Date().toISOString(),paidModelCalls:0,synthetic:true,checks:[],errors:[],network:[]};
const save=()=>{fs.writeFileSync(dir+'/acceptance-results.jsonl',results.map(r=>JSON.stringify(r)).join('\n')+'\n');fs.writeFileSync(dir+'/acceptance-run.json',JSON.stringify(report,null,2));};
function result(id,status,actual,method='real_browser_and_http',ref='evidence/acceptance-run.json'){const row=results.find(r=>r.id===id);Object.assign(row,{status,method,actual_result:actual,evidence_ref:ref,verified_by:'automated_assertions',note:'真实SKU、合成持有及人物；不代表实体/真人验证'});save();}
function check(name,data={}){report.checks.push({name,passed:true,...data});save();}
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const ac=await browser.newContext({viewport:{width:1440,height:1000}}),bc=await browser.newContext({viewport:{width:390,height:844},isMobile:true});
const a=await ac.newPage(),b=await bc.newPage();
for(const p of [a,b])p.on('pageerror',e=>{report.errors.push(e.message);save();});
async function api(p,url,body,headers={}){const r=body?await p.request.post(base+url,{data:body,headers}):await p.request.get(base+url,{headers});return {status:r.status(),data:await r.json()};}
async function post(p,url,body,headers){const r=await api(p,url,body,headers);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
const life=(p,action,input,taskId)=>post(p,'/api/life',{action,input},taskId?{'x-wujian-task':taskId}:undefined);
async function register(p,n){await p.goto(base);await p.getByLabel('用户名',{exact:true}).fill('V2'+n+Date.now());await p.getByLabel('口令',{exact:true}).fill(randomBytes(18).toString('hex'));await p.getByRole('checkbox').check();await p.getByRole('button',{name:'进入我的物间',exact:true}).click();await p.getByRole('button',{name:'生活首页',exact:true}).waitFor();return (await api(p,'/api/account')).data.account;}
const info={
 'SONY-WH-CH520':['Sony','WH-CH520'], 'JBL-CLIP5':['JBL','CLIP 5'],'LOGI-M185':['Logitech','M185'], 'CANON-R50':['Canon','EOS R50'], 'XIAOMI-1S':['小米','MJTD01SYL'], 'PHILIPS-HD9252-90':['Philips','HD9252/90'], 'IKEA-SAMLA11':['IKEA','494.408.37'], 'IKEA-KALLAX77':['IKEA','703.518.86'], 'DJI-OM6':['DJI','Osmo Mobile 6']
};
const products=JSON.parse(fs.readFileSync(root+'/package/wujian_real_product_fixtures_v1.json','utf8')).products;
const items={};
try {
 const ua=await register(a,'甲'),ub=await register(b,'乙');
 const before=(await api(a,'/api/life')).data.workspace.items.length;
 const refused=await api(a,'/api/life',{action:'createItem',input:{name:'没有确认持有',brand:'Sony',model:'WH-CH520',category:'电子设备',lifecycle:'长期耐用',availability:'unknown',synthetic:true}});
 assert.notEqual(refused.status,200);assert.equal((await api(a,'/api/life')).data.workspace.items.length,before);check('独立账号缺少本人持有确认时不建实例');
 for(const [key,p] of Object.entries(products)){
   const [brand,model]=info[key];items[key]=(await life(a,'createItem',{name:'[合成]'+p.name,brand,model,category:'其他',lifecycle:'长期耐用',availability:'unknown',ownsConfirmed:true,synthetic:true,requestId:randomUUID()})).item;
 }
 for(const [key,p] of Object.entries(products)){
   if(process.env.REUSE_NETWORK==='true'){const retry=(process.env.RECHECK_PRODUCTS||'').split(',').filter(Boolean);const previous=JSON.parse(fs.readFileSync(dir+'/acceptance-first-run.json','utf8')).network;if(!report.network.length)report.network=previous.filter(n=>!retry.includes(n.product));report.networkReuseRef='acceptance-first-run.json';if(!retry.length)break;if(!retry.includes(key))continue;}
   for(const source of p.official){
     const start=Date.now();let response;
     try{response=await api(a,'/api/life',{action:'inspectProduct',input:{url:source.url,brand:info[key][0],model:info[key][1]}});}catch(e){response={status:0,data:{error:e.message}};}
     const d=response.data;
     report.network.push({product:key,url:source.url,finalUrl:d.url,status:response.status,official:d.official||false,title:d.title,elapsedMs:Date.now()-start,error:d.error||null,textHash:d.text?createHash('sha256').update(d.text).digest('hex'):null,excerpt:d.text?.slice(0,500),manualLinks:d.manuals||[],basis:response.status===200?'live_fetch':'live_fetch_failed_no_cache'});save();
     if(response.status===200&&d.official&&!report.network.some(n=>n.product===key&&n.indexed)){
       const imported=await api(a,'/api/life',{action:'importOfficial',input:{itemId:items[key].id,url:source.url,confirmed:true}});
       report.network.at(-1).indexed=imported.status===200;report.network.at(-1).importError=imported.data.error||null;save();
     }
   }
 }
 for(const [key,id] of [['SONY-WH-CH520','INTAKE-01'],['JBL-CLIP5','INTAKE-02'],['LOGI-M185','INTAKE-03'],['CANON-R50','INTAKE-04'],['XIAOMI-1S','INTAKE-05'],['PHILIPS-HD9252-90','INTAKE-06']]){
   const proof=(await api(a,'/api/foundation?itemId='+items[key].id)).data;
   const has=report.network.some(n=>n.product===key&&n.indexed);
   result(id,has?'pass':'blocked',has?'本人确认创建合成实例；服务器再次联网核对官方来源，未知实物状态未补造':'实例已创建，但官方资料未完整通过实时读取/完整型号核对；保留网络失败，未填入fixture事实','integration_live_network');
   assert.equal(proof.model.model,info[key][1].toUpperCase());
 }
 const second=(await life(a,'createItem',{name:'[合成]厨房SAMLA',brand:'IKEA',model:'494.408.37',category:'其他',lifecycle:'长期耐用',availability:'unknown',ownsConfirmed:true,synthetic:true,location:'厨房（合成）',requestId:randomUUID()})).item;
 const firstModel=(await api(a,'/api/foundation?itemId='+items['IKEA-SAMLA11'].id)).data.model.modelKey;
 assert.equal((await api(a,'/api/foundation?itemId='+second.id)).data.model.modelKey,firstModel);assert.notEqual(second.id,items['IKEA-SAMLA11'].id);result('INTAKE-07','pass','两件同款独立实例，公共型号键相同，厨房位置保持独立','integration');
 result('INTAKE-08','blocked','无实际候选照片和获批视觉模型，未验证照片候选识别；未将相似外观自动认作准确SKU','integration');
 const count=(await api(a,'/api/life')).data.workspace.items.length;await api(a,'/api/life',{action:'inspectProduct',input:{url:products['DJI-OM6'].official[0].url,brand:'DJI',model:'Osmo Mobile 6'}});assert.equal((await api(a,'/api/life')).data.workspace.items.length,count);result('INTAKE-09','pass','单独研究网页未创建额外持有实例；研究结果不等于持有','integration');
 await a.reload();const scope=a.getByTestId('task-continuity');await scope.locator('summary').first().click();
 const goal='[合成任务]耳机连接与家庭交接（私密原始目标）';await scope.getByLabel('新任务目标').fill(goal);await scope.locator('summary').filter({hasText:'选择这次相关的物品'}).click();await scope.getByLabel('[合成]Sony WH-CH520 无线耳机',{exact:false}).check();await scope.getByRole('button',{name:'开始并保留进度'}).click();
 await expect(scope.getByRole('heading',{name:goal,exact:true})).toBeVisible();let task=(await api(a,'/api/foundation')).data.tasks.find(t=>t.goal===goal);assert.ok(task);check('真实界面创建统一任务',{taskId:task.taskId});
 await a.getByRole('button',{name:'物品展柜',exact:true}).click();await a.reload();await a.getByTestId('task-continuity').locator('summary').first().click();await expect(a.getByTestId('task-continuity').getByRole('heading',{name:goal,exact:true})).toBeVisible();await a.getByTestId('task-continuity').getByRole('button',{name:'回到这件事'}).click();
 await expect(a.getByRole('region',{name:'物间统一对话',exact:true})).toBeVisible();check('跨页面与刷新后恢复任务ID与物品');
 const run=await post(a,'/api/assistant',{requestId:randomUUID(),taskId:task.taskId,itemId:items['SONY-WH-CH520'].id,question:'怎样配对，之后我想交给家人协助',mode:'auto',memoryPolicy:'off',uiContext:{page:'assistant',useItemMemories:false}});
 assert.equal(run.foundation.taskId,task.taskId);assert.equal(run.modelCalls,0);check('模型未授权时诚实不可用，任务仍有运行记录',{reply:run.reply,foundation:run.foundation});
 const details=(await api(a,'/api/foundation?taskId='+task.taskId)).data;assert.ok(details.runs.length>=1);
 await a.reload();const panel=a.getByTestId('task-continuity');await panel.locator('summary').first().click();await panel.getByLabel('实际尝试结果',{exact:true}).fill('[合成用户报告]还没解决，需要家人接手');await panel.getByRole('button',{name:'确认：还没解决'}).click();await expect(panel.getByText('用户报告：[合成用户报告]还没解决，需要家人接手',{exact:true})).toBeVisible();
 assert.equal((await api(a,'/api/foundation?taskId='+task.taskId)).data.outcomes[0].basis,'user_report');check('真实界面反馈写入用户报告，不称设备回读');
 await life(a,'updateItem',{itemId:items['SONY-WH-CH520'].id,note:'SECRET-SYNTHETIC-PRIVATE-NOTE'});
 const invite=await post(a,'/api/collaboration',{requestId:randomUUID(),action:'invite',confirmed:true});await post(b,'/api/collaboration',{requestId:randomUUID(),action:'join',confirmed:true,token:invite.invite});assert.equal((await api(b,'/api/life')).data.workspace.items.length,0);result('FAMILY-01','pass','两个实际浏览器账号注册、明确接受邀请；加入家庭后仍看不到私人物品');
 await post(a,'/api/collaboration',{requestId:randomUUID(),action:'share',itemId:items['SONY-WH-CH520'].id,memberId:ub.id,enabled:true});assert.ok(!JSON.stringify((await api(b,'/api/life')).data).includes('SECRET-SYNTHETIC-PRIVATE-NOTE'));
 const hand=await post(a,'/api/collaboration',{requestId:randomUUID(),action:'task',itemId:items['SONY-WH-CH520'].id,memberId:ub.id,title:'[合成]帮忙连接耳机',summary:'仅分享此摘要：已尝试开机但配对还没解决',confirmed:true,sourceTaskId:task.taskId});
 const view=(await api(b,'/api/foundation?taskId='+task.taskId)).data;assert.equal(view.task.taskId,task.taskId);assert.equal(view.task.goal,'仅分享此摘要：已尝试开机但配对还没解决');assert.ok(!JSON.stringify(view).includes('私密原始目标'));assert.equal(view.outcomes.length,0);check('同一TaskId交接家人，私人原始目标与结果备注不传递');result('AGENT-01','pass','同一TaskId从物品提问接续家庭交接；用户确认的摘要含已尝试开机，原始目标与私聊不传递');
 await b.goto(base+'/#family');await b.getByRole('heading',{name:'[合成]帮忙连接耳机',exact:true}).waitFor();await b.getByRole('button',{name:'标记已看到',exact:true}).click();await expect(b.getByText(/对方已看到/).first()).toBeVisible();await b.getByRole('button',{name:'我来接手',exact:true}).click();await b.getByRole('button',{name:'报告已完成',exact:true}).click();await expect(b.getByText(/用户报告完成，非设备检测/).first()).toBeVisible();result('FAMILY-03','pass','耳机任务实际从统一目标交接同一任务引用，另一账号浏览器已读/接手/报告完成；未验证配对实物成功');
 await b.screenshot({path:dir+'/family-mobile.png',fullPage:true});
 await post(a,'/api/collaboration',{requestId:randomUUID(),action:'share',itemId:items['SONY-WH-CH520'].id,memberId:ub.id,enabled:false});assert.equal((await api(b,'/api/foundation?taskId='+task.taskId)).status,403);assert.notEqual((await api(b,'/api/collaboration',{requestId:randomUUID(),action:'unresolved',taskId:hand.taskId,confirmed:true})).status,200);result('FAMILY-07','pass','旧任务页下一次读取/写入在撤权后被拒；没有靠前端按钮隐藏授权');
 await a.goto(base+'/#home');if(await a.getByTestId('task-continuity').getAttribute('open')===null)await a.getByTestId('task-continuity').locator('summary').first().click();await a.screenshot({path:dir+'/task-desktop.png',fullPage:false});await a.setViewportSize({width:390,height:844});await a.screenshot({path:dir+'/task-mobile.png',fullPage:false});assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(report.errors.length,0);check('桌面与390px移动端任务界面，无JS错误/横向溢出');
 // Prototype paths only. No human discoverability or product quality claim.
 const proto=await browser.newPage();await proto.goto(pathToFileURL(path.resolve(root+'/package/物间_导航与任务连续性_三方案可点击原型.html')).href);const paths=[];
 for(const scheme of ['A','B','C'])for(let n=1;n<=9;n++){
   const id='ENTRY-'+String(n).padStart(2,'0');await proto.selectOption('#scheme',scheme);await proto.selectOption('#scenario',id);await proto.click('#begin');
   const target=await proto.evaluate(()=>state.scenario.target);const nav=await proto.evaluate(()=>schemes[state.scheme].nav);const page=Object.keys(nav).find(k=>nav[k].includes(target));assert.ok(page);await proto.locator('[data-page]').filter({hasText:page}).click();await proto.locator('[data-action]').filter({hasText:target}).click();await expect(proto.locator('#done')).toHaveText('找到操作');paths.push({id,scheme,path:[page,target],passed:true});
 }
 fs.writeFileSync(dir+'/prototype-paths.json',JSON.stringify({humanStudy:false,paths},null,2));for(let n=1;n<=9;n++)result('ENTRY-'+String(n).padStart(2,'0'),'pass','A/B/C各预设路径实际点击可达；不是当前App功能验收或真人首次发现率','prototype_automated_paths','evidence/prototype-paths.json');
} catch(e){report.errors.push(e.stack||e.message);save();throw e;}finally{save();await browser.close();}
