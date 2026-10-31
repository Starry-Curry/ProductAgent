import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {v3Gateway,V3_ROOT,V3_ROUND} from './gateway.mjs';
import {kernelFixture} from './fixtures.ts';
import {createProvider} from '../../src/lib/ai/provider.ts';
import {respond} from '../../src/lib/agent/service.ts';
import {kernelContext} from '../../src/lib/agent/kernel/context.ts';
import {createTask,beginRun,finishRun,getTask,recordOutcome,amendOutcome} from '../../src/lib/foundation/tasks.ts';
import {saveMemory} from '../../src/lib/memory/store.ts';
if(!process.argv.includes('--authorized-v3-250-cny50'))throw Error('authorized_round_required');
const stage=process.argv.find(s=>s.startsWith('--stage='))?.slice(8)||'experience-v1';
if(!/^[a-z0-9-]+$/.test(stage))throw Error('bad_stage');
const file=V3_ROOT+'/'+stage+'.json';if(fs.existsSync(file))throw Error('preserve_existing_evidence');
process.env.WUJIAN_ALLOW_PUBLIC_FETCH='false';process.env.WUJIAN_EXPERIMENTAL_KERNEL_V3='true';process.env.WUJIAN_EXPERIMENTAL_FACT_QA='false';
const gate=await v3Gateway(),f=kernelFixture(stage),rows:any[]=[],transitions:any[]=[];
let label='';const captures:any[]=[];
const provider=createProvider({AI_BASE_URL:'https://fixture.invalid/v1',AI_API_KEY:'fixture-only',AI_MODEL:gate.model,AI_TASK_MODEL:gate.model,AI_ALLOW_PAID_CALLS:'true',AI_ENABLE_THINKING:'false',AI_REQUEST_TIMEOUT_MS:'90000'},(_u,init)=>{
 const body=JSON.parse(String(init?.body));captures.push({label,body});return fetch(gate.url+'/experience/v1/chat/completions',{...init,headers:{...init?.headers,'x-wujian-evaluation':label}});
});
const ledger=()=>JSON.parse(fs.readFileSync(V3_ROOT+'/model-calls.json','utf8')).attempts;
const save=()=>fs.writeFileSync(file,JSON.stringify({roundId:V3_ROUND,stage,syntheticHistory:true,actualHardwareVerification:false,independentCreativeBlindReview:false,rows,transitions},null,2)+'\n');
const task=(ids:string[],goal:string)=>createTask(f.db,f.read,'lin',{requestId:crypto.randomUUID(),goal,intent:'guide',itemInstanceIds:ids});
function report(ids:string[],notes:string,allowCloud=true){const t=task(ids,'合成用户已尝试的结果');const run=beginRun(f.db,f.read,'lin',{requestId:crypto.randomUUID(),taskId:t.taskId,itemIds:ids,entryPoint:'test',executor:'synthetic_user_report_not_model_or_hardware',input:{}});finishRun(f.db,f.read,run,'waiting_user');return recordOutcome(f.db,f.read,'lin',{taskId:t.taskId,runId:run.runId,requestId:crypto.randomUUID(),expectedRevision:getTask(f.db,f.read(),'lin',t.taskId).revision,goalStatus:'partial',notes,confirmed:true,reuse:true,allowCloud});}
async function run(id:string,q:string,itemId:string,memoryPolicy:'legacy'|'off',direct=false){label=stage+'/'+id;const started=performance.now(),before=captures.length;
 const context=kernelContext(f.db,f.read(),'lin',{itemId,known:{memoryPolicy},messages:[],tried:[]} as any,q);
 try{const result=direct?await provider.generate('根据相同物品、官方原文、用户报告和实际限制，完整自然回答。不编造，不重复无效动作；创意可以有未知但要说明。',context,{temperature:0.2,maxTokens:4000,timeoutMs:60000}):await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId,question:q,mode:'service',memoryPolicy,uiContext:{page:'item'}},provider);
 const calls=ledger().filter((a:any)=>a.evaluation===label);rows.push({id,question:q,result,elapsedMs:Math.round(performance.now()-started),attempts:calls.map((a:any)=>a.number),contextHash:createHash('sha256').update(JSON.stringify(context)).digest('hex'),experienceIds:context.experiences.map(r=>r.outcomeId),inputCaptures:captures.slice(before)});
 }catch(e){rows.push({id,question:q,error:(e as Error).message,elapsedMs:Math.round(performance.now()-started)});}save();console.log(id,rows.at(-1).result?.reply?.outcome||rows.at(-1).error||'returned');}
try{
 const headset=f.ids['SONY-WH-CH520'],lamp=f.ids['XIAOMI-1S'];
 const original=report([headset],'[合成用户报告A]在同一台手机上，移近耳机以及反复长按5秒都没有解决；后来在手机蓝牙设置删除WH-CH520旧配对记录后重新配对成功。不是实物验证。');
 report([lamp],'[合成用户报告B]台灯已整理；此报告与耳机无关。',false);
 transitions.push({action:'A_then_unrelated_B',outcomeId:original.outcomeId});
 const q='我的WH-CH520又连不上这台原手机了，下一步该怎么做？不想无意义地反复尝试。';
 await run('C-without-experience',q,headset,'off');
 await run('C-with-experience',q,headset,'legacy');
 await run('C-direct-same-context',q,headset,'legacy',true);
 const correction=amendOutcome(f.db,f.read,'lin',{outcomeId:original.outcomeId,requestId:crypto.randomUUID(),expectedRevision:original.revision||1,operation:'correct',notes:'[合成更正A]删除旧配对记录没有解决。后来关闭原手机蓝牙，在另一台手机配对后可用；不能证明原手机已修复。',reuse:true,allowCloud:true,confirmed:true});
 transitions.push({action:'correct',outcomeId:correction.outcomeId,revision:correction.revision});
 await run('C-after-correction',q,headset,'legacy');
 amendOutcome(f.db,f.read,'lin',{outcomeId:correction.outcomeId,requestId:crypto.randomUUID(),expectedRevision:correction.revision||2,operation:'forget',confirmed:true});
 transitions.push({action:'forget',outcomeId:original.outcomeId});
 await run('C-after-forgetting',q,headset,'legacy');
 if(process.argv.includes('--creative')){
 const box=f.ids['IKEA-SAMLA11'],camera=f.ids['CANON-R50'];
 saveMemory(f.db,f.read,'lin',{itemId:box,kind:'interest',text:'[合成兴趣]我喜欢安静的几何摄影，不喜欢把容器当镜头前滤镜。',allowCloud:true});
 report([box,lamp,camera],'[合成失败反馈]台灯倒置与盒子撑住灯头的方案没尝试，因支撑不明而否定；把盒子挡在镜头前反光很重，不要再推荐这个方向。');
 const goal='用我已有的SAMLA透明盒、EOS R50和小米台灯，想一个不同于原用途的摄影玩法。不买、不剪、不粘，不增加器材。';
 await run('creative-with-experience',goal,box,'legacy');
 await run('creative-without-experience',goal,box,'off');
 await run('creative-direct-same-context',goal,box,'legacy',true);
 }
}finally{save();f.db.close();await gate.close();delete process.env.WUJIAN_EXPERIMENTAL_KERNEL_V3;}
