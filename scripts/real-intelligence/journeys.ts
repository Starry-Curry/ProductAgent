import fs from 'node:fs';
import { gateway } from './gateway.mjs';
import { validationFixture } from '../life-validation-fixture.ts';
import { migrateUnified } from '../../src/lib/foundation/schema.ts';
import { createProvider } from '../../src/lib/ai/provider.ts';
import { respond } from '../../src/lib/agent/service.ts';
import { storeOfficialDocument } from '../../src/lib/life/acquisition.ts';
import { saveMemory } from '../../src/lib/memory/store.ts';
import { createTask,recordOutcome,getTask,amendOutcome,resolveTaskContext } from '../../src/lib/foundation/tasks.ts';
import { discoverInTask } from '../../src/lib/foundation/creative.ts';
import { feedbackIdea } from '../../src/lib/life/ideas.ts';
if(!process.argv.includes('--authorized-150-cny50'))throw Error('authorization_required');
const stage=process.argv.find(s=>s.startsWith('--stage='))?.slice(8)||'journeys-v1';
if(!/^[a-z0-9-]+$/.test(stage))throw Error('invalid_stage');
const dir='docs/engineering/real-intelligence-2026-10-31/evidence',file=dir+'/'+stage+'.json';
if(fs.existsSync(file))throw Error('evidence_exists');
process.env.WUJIAN_EXPERIMENTAL_FACT_QA='false';process.env.WUJIAN_ALLOW_PUBLIC_FETCH='false';
const gate=await gateway('D:/ProductAgent-LifeContext/.env.local');
const ledger=()=>JSON.parse(fs.readFileSync(dir+'/model-calls.json','utf8')).attempts;
const f=validationFixture('.runtime/'+stage);migrateUnified(f.db);
const docs=JSON.parse(fs.readFileSync('.runtime/evaluation-documents.json','utf8'));
const ids:Record<string,string>={};
for(const [key,brand,model,name,region]of [['SONY-WH-CH520','Sony','WH-CH520','耳机','unspecified'],['XIAOMI-1S','小米','MJTD01SYL','台灯','unspecified'],['IKEA-SAMLA11','IKEA','494.408.37','透明盒','jp'],['CANON-R50','Canon','EOS R50','相机','unspecified']]){
 const id=f.add('[合成持有]'+name,'生活物品',brand,model,{region});ids[key]=id;
 const item=f.read().items.find(i=>i.id===id)!;
 for(const {document:d}of docs.filter((d:any)=>d.productId===key&&d.document.text.length>100&&!d.document.url.includes('/zh-cn/')))storeOfficialDocument(f.db,'lin',item,{...d,model,region});
}
const rows:any[]=[],transitions:any[]=[];let label='',inputs:any[]=[];
const provider=createProvider({AI_BASE_URL:'https://fixture.invalid/v1',AI_API_KEY:'fixture-only',AI_MODEL:gate.model,AI_CREATIVE_MODEL:gate.model,AI_ALLOW_PAID_CALLS:'true',AI_ENABLE_THINKING:'false',AI_REQUEST_TIMEOUT_MS:'90000'},(_u,init)=>{
 inputs.push(JSON.parse(String(init?.body)));return fetch(gate.url+'/journey/v1/chat/completions',{...init,headers:{...init?.headers,'x-wujian-evaluation':label}});
});
const save=()=>fs.writeFileSync(file,JSON.stringify({roundId:'real-intelligence-20261031-r1',stage,model:gate.model,synthetic:true,physicalTests:0,rows,transitions},null,2)+'\n');
async function run(id:string,action:()=>Promise<any>){label=stage+'/'+id;inputs=[];const start=performance.now(),before=ledger().length;let result;
 try{result=await action();rows.push({id,result,elapsedMs:Math.round(performance.now()-start),attempts:ledger().slice(before).map((a:any)=>a.number),inputs});}
 catch(e){rows.push({id,error:(e as Error).message,elapsedMs:Math.round(performance.now()-start),attempts:ledger().slice(before).map((a:any)=>a.number),inputs});}
 save();console.log(id,rows.at(-1).error||'returned',rows.at(-1).attempts);return result;
}
const task=(name:string,items:string[],intent='guide')=>createTask(f.db,f.read,'lin',{requestId:crypto.randomUUID(),goal:name,intent,itemInstanceIds:items});
const ask=(id:string,q:string,t?:any)=>respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,taskId:t?.taskId,question:q,mode:'service',memoryPolicy:'legacy',uiContext:{page:'item'}},provider);
function outcome(t:any,r:any,notes:string){return recordOutcome(f.db,f.read,'lin',{taskId:t.taskId,runId:r.foundation.runId,requestId:crypto.randomUUID(),expectedRevision:getTask(f.db,f.read(),'lin',t.taskId).revision,goalStatus:'achieved',notes,confirmed:true,reuse:true,allowCloud:true});}
async function direct(id:string){const prior=rows.at(-1);const body=prior.inputs.find((i:any)=>i.messages?.some((m:any)=>m.role==='user'));if(!body)return;
 await run(id,()=>provider.generate('根据相同资料与获准用户报告，自然完整回答当前问题/目标。不编造型号能力、政策、经历或已执行的设备操作；未知说未知，不把用户报告当厂家证明。',JSON.parse(body.messages.find((m:any)=>m.role==='user').content),{temperature:0.2,json:false,maxTokens:id.startsWith('creative')?4000:1800,timeoutMs:id.startsWith('creative')?90000:45000}));}
try{
 if(!process.argv.includes('--creative-only')){
 const a=task('[合成]耳机任务A',[ids['SONY-WH-CH520']]);const ar=await run('A-first',()=>ask(ids['SONY-WH-CH520'],'如何配对另一台手机？',a));
 if(ar){const o=outcome(a,ar,'[合成用户报告]只移近手机没有用；关闭旧手机蓝牙后，新手机才连接成功。不是厂家通用结论。');transitions.push({action:'A-report',outcome:o});
 const b=task('[合成]台灯任务B',[ids['XIAOMI-1S']]);const br=await run('B-other-item',()=>ask(ids['XIAOMI-1S'],'如何操作旋钮调节亮度和色温？',b));if(br)transitions.push({action:'B-report',outcome:outcome(b,br,'[合成用户报告]旋钮操作已试用；这只是测试状态。')});
 const c=task('[合成]下次连接耳机C',[ids['SONY-WH-CH520']]);transitions.push({action:'C-recall-after-B',context:resolveTaskContext(f.db,f.read(),'lin',c.taskId)});
 await run('C-reuse',()=>ask(ids['SONY-WH-CH520'],'这次又要配对新手机，如何操作？请结合我上次的结果，不要让我重复没有用的尝试。',c));await direct('C-direct');
 const corrected=amendOutcome(f.db,f.read,'lin',{outcomeId:o.outcomeId,expectedRevision:1,operation:'correct',notes:'[合成纠正]之前记错了，关旧手机蓝牙没有解决；新手机列表删除旧配对记录再配对才成功。仅用户报告。',confirmed:true,reuse:true,allowCloud:true,requestId:crypto.randomUUID()});transitions.push({action:'correct',outcome:corrected});
 await run('C-corrected',()=>ask(ids['SONY-WH-CH520'],'现在如何配对另一台手机？请结合我纠正后的上次结果。'));
 amendOutcome(f.db,f.read,'lin',{outcomeId:o.outcomeId,expectedRevision:2,operation:'forget',confirmed:true,requestId:crypto.randomUUID()});
 await run('C-forgotten',()=>ask(ids['SONY-WH-CH520'],'如何配对另一台手机？你是否有我的以前操作经验？'));
 }}
 if(!process.argv.includes('--memory-only')){
 saveMemory(f.db,f.read,'lin',{kind:'interest',text:'我喜欢安静的摄影和几何构图，不喜欢复杂布置，不买新东西。',allowCloud:true});
 const items=[ids['CANON-R50'],ids['IKEA-SAMLA11'],ids['XIAOMI-1S']];
 const goal='我想用已有相机、SAMLA透明盒和米家台灯做安静的静物开箱创意照片。不买、不剪、不粘，不要求用齐。请提出具体有作用的新布置和关键条件，不假设有三脚架、额外支架或背景纸。';
 const t=task(goal,items,'explore');
 const result=await run('creative-first',()=>discoverInTask(f.db,f.read,'lin',{goal,itemIds:items,model:true,publicEvidence:false},provider,t.taskId));await direct('creative-direct');
 if(result?.ideas?.length){const idea=result.ideas[0];feedbackIdea(f.db,f.read(),'lin',{id:idea.id,saved:true,outcome:'不感兴趣',note:'[合成反馈]不接受隔着透明盒拍摄，反光影响效果。希望盒子换一种作用。'});
 const o=outcome(t,result,'[合成用户报告]隔着透明盒拍摄反光明显，不接受这种路径；只是在测试脚本里报告，并未拍摄实物。');transitions.push({action:'creative-feedback',outcome:o,ideaId:idea.id});
 await run('creative-feedback-new-task',()=>discoverInTask(f.db,f.read,'lin',{goal:'根据我之前否定的结果换一个摄影新用途，盒子不要作为镜头前的滤镜。不买、不剪、不粘，不增添器材；结合我的兴趣。',itemIds:items,model:true,publicEvidence:false,previousIdeaIds:[idea.id],feedbackIdeaIds:[idea.id]},provider));await direct('creative-feedback-direct');
 }
 }
}finally{save();f.db.close();await gate.close();}
