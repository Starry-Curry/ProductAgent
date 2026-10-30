import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3223',dir='docs/engineering/experience-lifecycle-2026-10-31/evidence';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const ac=await browser.newContext({viewport:{width:1440,height:1000}}),bc=await browser.newContext({viewport:{width:390,height:844},isMobile:true});
const a=await ac.newPage(),b=await bc.newPage(),report={at:new Date().toISOString(),synthetic:true,paidCalls:0,checks:[],errors:[],responses:[]};
for(const page of[a,b])page.on('pageerror',e=>report.errors.push(e.message));
const save=()=>fs.writeFileSync(dir+'/browser.json',JSON.stringify(report,null,2));
const check=(name,detail)=>{report.checks.push({name,passed:true,detail});save();};
async function post(p,url,data,headers){const started=performance.now();const r=await p.request.post(base+url,{data,headers});const d=await r.json();if(url==='/api/assistant')report.responses.push({question:data.question,source:d.reply?.source,answer:d.reply?.answer,outcome:d.reply?.outcome,modelCalls:d.modelCalls,tokens:d.tokens,elapsedMs:Math.round(performance.now()-started),note:'模型关闭的本机路径，不是模型正确完成延迟'});assert.ok(r.ok(),JSON.stringify({url,status:r.status(),error:d.error}));return d;}
const life=(p,action,input,taskId)=>post(p,'/api/life',{action,input},taskId?{'x-wujian-task':taskId}:undefined);
const get=async(p,url)=>(await(await p.request.get(base+url)).json());
const foundation=(p,action,input)=>post(p,'/api/foundation',{action,input});
async function register(p,n){await p.goto(base);await p.getByLabel('用户名',{exact:true}).fill('经验回归'+n+Date.now());await p.getByLabel('口令',{exact:true}).fill(randomBytes(18).toString('hex'));await p.getByRole('checkbox').check();await p.getByRole('button',{name:'进入我的物间',exact:true}).click();await p.getByRole('button',{name:'生活首页',exact:true}).waitFor();return(await get(p,'/api/account')).account;}
const item=async(p,name,brand,model)=>(await life(p,'createItem',{name:'[合成]'+name,brand,model,category:'其他',lifecycle:'长期耐用',availability:'available',ownsConfirmed:true,synthetic:true,requestId:randomUUID()})).item;
const task=async(p,goal,ids,intent='guide')=>(await foundation(p,'create',{requestId:randomUUID(),goal,intent,itemInstanceIds:ids})).task;
const ask=(p,t,id)=>post(p,'/api/assistant',{requestId:randomUUID(),taskId:t.taskId,itemId:id,mode:'service',question:'请读取这个型号的资料',memoryPolicy:'off'});
async function openTask(p,actor,t){await p.evaluate(({actor,id})=>localStorage.setItem('wujian-task:'+actor,id),{actor,id:t.taskId});await p.goto(base+'/#home');await p.reload();const box=p.getByTestId('task-continuity');await box.waitFor();await box.locator('summary').first().click();await expect(box.getByRole('heading',{name:t.goal,exact:true})).toBeVisible();return box;}
try{
 const ua=await register(a,'甲'),ub=await register(b,'乙');
 const headphone=await item(a,'陌生耳机','Sony','WH-CH520'),lamp=await item(a,'独立台灯','小米','MJTD01SYL');
 try{const source=await life(a,'importOfficial',{itemId:headphone.id,url:'https://helpguide.sony.net/mdr/2958/v1/en/contents/TP1000776852.html',confirmed:true});report.sourceImport={ok:true,sourceId:source.source?.id};}catch(e){report.sourceImport={ok:false,error:e.message};}
 const ta=await task(a,'[合成]耳机任务A',[headphone.id]),ar=await ask(a,ta,headphone.id);
 let box=await openTask(a,ua.id,ta);await box.getByLabel('实际尝试结果',{exact:true}).fill('[合成用户报告]移近手机后完成耳机配对');
 await box.getByLabel('允许以后同一物品的任务参考这条结果（仍仅自己可见）',{exact:true}).check();
 const written=a.waitForResponse(r=>r.url().endsWith('/api/foundation')&&r.request().method()==='POST');await box.getByRole('button',{name:'确认：我已完成',exact:true}).click();assert.ok((await written).ok());
 const ad=await get(a,'/api/foundation?taskId='+ta.taskId);assert.equal(ad.outcomes[0].allowCloud,false);assert.equal(ad.outcomes[0].basis,'user_report');
 const tb=await task(a,'[合成]台灯任务B',[lamp.id]),br=await ask(a,tb,lamp.id),bd=await get(a,'/api/foundation?taskId='+tb.taskId);
 await foundation(a,'outcome',{taskId:tb.taskId,runId:br.foundation.runId,requestId:randomUUID(),expectedRevision:bd.task.revision,goalStatus:'achieved',notes:'[合成报告]台灯已整理',confirmed:true,reuse:true,allowCloud:false});
 const tc=await task(a,'[合成]耳机任务C及不分享的私人目标',[headphone.id]);box=await openTask(a,ua.id,tc);await box.getByText('本次可参考的经验',{exact:true}).click();await expect(box.getByText(/移近手机后完成耳机配对/)).toBeVisible();
 await a.screenshot({path:dir+'/experience-desktop.png',fullPage:false});await a.setViewportSize({width:390,height:844});assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await a.screenshot({path:dir+'/experience-mobile.png',fullPage:false});await a.setViewportSize({width:1440,height:1000});
 check('A 跨物品任务后旧经验仍可见，独立云许可和桌面/390px', {answerSource:ar.reply.source,reportBasis:'user_report',modelQuality:'not_run'});
 box=await openTask(a,ua.id,ta);await box.getByRole('button',{name:'纠正这条经验',exact:true}).click();await box.getByLabel('纠正后的实际经历',{exact:true}).fill('[合成更正]只在原手机尝试有效');await box.getByLabel('允许以后参考这条更正',{exact:true}).check();
 await Promise.all([a.waitForResponse(r=>r.url().endsWith('/api/foundation')&&r.request().method()==='POST'),box.getByRole('button',{name:'确认更正经验',exact:true}).click()]);
 assert.equal((await get(a,'/api/foundation?taskId='+tc.taskId)).previousOutcomes[0].notes,'[合成更正]只在原手机尝试有效');
 await expect(box.getByRole('button',{name:'忘记这条经验',exact:true})).toBeVisible();a.once('dialog',d=>d.accept());await Promise.all([a.waitForResponse(r=>r.url().endsWith('/api/foundation')&&r.request().method()==='POST'),box.getByRole('button',{name:'忘记这条经验',exact:true}).click()]);
 assert.equal((await get(a,'/api/foundation?taskId='+tc.taskId)).previousOutcomes.length,0);check('A 真实界面纠正、忘记后C不再召回，未用模型生成冒充');
 // B needs real generation quality; exercise the actual closed-provider failure path honestly.
 const creative=await task(a,'[合成]用已有物品创造旅行小件晾放用途',[headphone.id,lamp.id],'explore');
 const discoveryResponse=await a.request.post(base+'/api/life',{data:{action:'discover',input:{goal:creative.goal,itemIds:[headphone.id,lamp.id],model:true,publicEvidence:false,includeSynthetic:true}},headers:{'x-wujian-task':creative.taskId}});
 const discovery=await discoveryResponse.json();assert.equal(discoveryResponse.status(),502);assert.equal((await get(a,'/api/foundation?taskId='+creative.taskId)).task.currentStage,'blocked');
 report.creativity={taskId:creative.taskId,status:discoveryResponse.status(),error:discovery.error,acceptance:'blocked_model_budget',note:'实际调用本机App；模型关闭返回502且原任务标记阻塞，没有伪造方案或完成结果。'};save();
 const invite=await post(a,'/api/collaboration',{requestId:randomUUID(),action:'invite',confirmed:true});await post(b,'/api/collaboration',{requestId:randomUUID(),action:'join',token:invite.invite,confirmed:true});
 const collab=(p,input)=>post(p,'/api/collaboration',{requestId:randomUUID(),...input});await collab(a,{action:'share',itemId:headphone.id,memberId:ub.id,enabled:true});
 const family=await collab(a,{action:'task',itemId:headphone.id,memberId:ub.id,title:'帮爸爸核对耳机',summary:'[合成批准摘要]请核对耳机连接资料，不分享私聊',confirmed:true,sourceTaskId:tc.taskId});
 const peer=await get(b,'/api/foundation?taskId='+tc.taskId);assert.ok(!JSON.stringify(peer).includes('不分享的私人目标'));
 await collab(b,{action:'seen',taskId:family.taskId});await collab(b,{action:'accept',taskId:family.taskId});await collab(b,{action:'report_done',taskId:family.taskId,confirmed:true});
 box=await openTask(a,ua.id,tc);await expect(box.getByText(/家人已报告处理完成/)).toBeVisible();const cd=await get(a,'/api/foundation?taskId='+tc.taskId);assert.equal(cd.task.currentStage,'waiting_user');assert.equal(cd.familyProgress[0].basis,'user_report');await a.screenshot({path:dir+'/family-progress-desktop.png',fullPage:false});
 await collab(a,{action:'share',itemId:headphone.id,memberId:ub.id,enabled:false});assert.equal((await b.request.get(base+'/api/foundation?taskId='+tc.taskId)).status(),403);check('C 家庭报告更新原任务，私人目标隔离，撤权后403');
 const painting=await item(a,'朋友赠画','无品牌','原创画作'),tg=await task(a,'[合成]传递赠画故事',[painting.id],'gift');
 const story=(await life(a,'fragment',{itemIds:[painting.id],text:'[合成]小周送的画，选中分享的经历',allowRecall:false,allowCloud:false},tg.taskId)).fragment;await life(a,'fragment',{itemIds:[painting.id],text:'[合成私人]不分享这段经历',allowRecall:false,allowCloud:false});
 const gift=(await life(a,'gift',{itemId:painting.id,message:'[合成]愿这幅画继续陪伴你',fragmentIds:[story.id]},tg.taskId)).gift;
 await b.goto(base+'/gift/'+gift.token);await b.getByLabel('我确认已实际取得这件物品').check();await b.getByRole('button',{name:'认领并延续记忆'}).click();await b.getByText('礼物已认领。',{exact:false}).waitFor();
 const ws=await get(b,'/api/workspace'),received=ws.items.find(i=>i.transferredFrom?.giftId===gift.id);assert.ok(received&&received.id!==painting.id);assert.ok(!JSON.stringify(ws).includes('不分享这段经历'));
 await life(b,'fragment',{itemIds:[received.id],text:'[合成私人]新主人经历',allowRecall:false,allowCloud:false});assert.ok(!JSON.stringify(await get(a,'/api/life')).includes('新主人经历'));await b.screenshot({path:dir+'/gift-mobile.png',fullPage:false});check('D 实际赠礼认领界面与独立实例，双方新旧私人经历不自动转移');
 assert.deepEqual(report.errors,[]);
}catch(e){report.errors.push(e.stack||e.message);throw e;}finally{save();await browser.close();}
