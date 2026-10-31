import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gateway} from '../real-intelligence/gateway.mjs';
import {kernelFixture,reportRoot} from './fixtures.ts';
import {createProvider} from '../../src/lib/ai/provider.ts';
import {respond} from '../../src/lib/agent/service.ts';
import {kernelContext} from '../../src/lib/agent/kernel/context.ts';
import {saveMemory} from '../../src/lib/memory/store.ts';
import {createTask,beginRun,finishRun,recordOutcome,getTask} from '../../src/lib/foundation/tasks.ts';
// This command does NOT authorize a new round. It appends the canonical existing
// round, under its original exclusive lock, at most the explicitly remaining 13.
if(!process.argv.includes('--use-authorized-r1-remainder'))throw Error('explicit_remaining_round_required');
const stage=process.argv.find(s=>s.startsWith('--stage='))?.slice(8)||'screening-v1';
if(!/^[a-z0-9-]+$/.test(stage))throw Error('bad_stage');
const file=reportRoot+'/'+stage+'.json';if(fs.existsSync(file))throw Error('preserve_raw_outputs_new_stage_required');
const canonical='D:/ProductAgent-LifeContext/.runtime/real-intelligence-eval-v1';
const ledgerPath=canonical+'/docs/engineering/real-intelligence-2026-10-31/evidence/model-calls.json';
const original=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
if(original.task!=='real-intelligence-20261031-r1'||original.attempts.length<137||original.attempts.length>=150)throw Error('remaining_authorized_round_unavailable');
const originalHash=createHash('sha256').update(JSON.stringify(original.attempts.slice(0,137))).digest('hex');
const cwd=process.cwd();let gate;
// Resolve the EXISTING ledger and lock paths in the canonical workspace. Do not
// instantiate an independent 137/150 copy in this worktree.
try{process.chdir(canonical);gate=await gateway('D:/ProductAgent-LifeContext/.env.local');}finally{process.chdir(cwd);}
process.env.WUJIAN_ALLOW_PUBLIC_FETCH='false';process.env.WUJIAN_EXPERIMENTAL_FACT_QA='false';
let label='';const inputs:any[]=[];const rows:any[]=[];
const provider=createProvider({AI_BASE_URL:'https://fixture.invalid/v1',AI_API_KEY:'fixture-only',AI_MODEL:gate.model,AI_TASK_MODEL:gate.model,AI_CREATIVE_MODEL:gate.model,AI_ALLOW_PAID_CALLS:'true',AI_ENABLE_THINKING:'false'},(_u,init)=>{
 const body=JSON.parse(String(init?.body));inputs.push({label,body});return fetch(gate.url+'/kernel/v1/chat/completions',{...init,headers:{...init?.headers,'x-wujian-evaluation':label}});
});
const historicalPlan=JSON.parse(fs.readFileSync('docs/engineering/experience-lifecycle-2026-10-31/evidence/live-evaluation-plan.json','utf8')).cases;
const cases=process.argv.find(s=>s.startsWith('--cases='))?.slice(8).split(',')||['QA-03','QA-07','CONSTRAINT-02','CONSTRAINT-06'];
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const save=()=>fs.writeFileSync(file,JSON.stringify({stage,roundId:original.task,requestsAtStart:original.attempts.length,original137Hash:originalHash,model:gate.model,syntheticOwners:true,physicalTests:0,humanBlindReview:false,rows},null,2)+'\n');
try{
 for(const id of cases){const c=historicalPlan.find((c:any)=>c.id===id);if(!c)throw Error('unknown_case');const f=kernelFixture(stage+'-'+id.toLowerCase());
  try{
   const itemId=f.ids[c.product_ids[0]],q=c.prompt;
   const session:any={itemId,known:{memoryPolicy:'legacy',useItemMemories:'no'},messages:[],tried:[]};
   const context=kernelContext(f.db,f.read(),'lin',session,q);
   for(const arm of ['v3','direct']){
    label='kernel-v3/'+stage+'/'+id+'/'+arm;const started=performance.now(),before=inputs.length;
    process.env.WUJIAN_EXPERIMENTAL_KERNEL_V3=arm==='v3'?'true':'false';
    try{const result=arm==='v3'?await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId,question:q,mode:'service',memoryPolicy:'legacy',uiContext:{page:'item'}},provider):await provider.generate('根据给定物品、资料和获准用户报告，用中文完整自然回答用户全部问题。未提及不等于不支持；不要编造资料、政策、私人经历或实际执行。',context,{temperature:0.2,maxTokens:4000,timeoutMs:45000});
     rows.push({id,arm,question:q,result,elapsedMs:Math.round(performance.now()-started),effectiveContextHash:hash(context),inputs:inputs.slice(before)});
    }catch(e){rows.push({id,arm,question:q,error:(e as Error).message,elapsedMs:Math.round(performance.now()-started),effectiveContextHash:hash(context),inputs:inputs.slice(before)});}
    save();console.log(id,arm,rows.at(-1).result?.reply?.outcome||rows.at(-1).error||'returned');
   }
  }finally{f.db.close();}
 }
}finally{
 delete process.env.WUJIAN_EXPERIMENTAL_KERNEL_V3;save();await gate.close();
 const updated=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
 if(hash(updated.attempts.slice(0,137))!==originalHash)throw Error('historical_attempts_changed');
 // New public artifact; never overwrite the historical 137-attempt Git snapshot.
 fs.writeFileSync(reportRoot+'/'+stage+'-round-continuation.json',JSON.stringify(updated,null,2)+'\n');
 console.log(JSON.stringify({canonicalLedger:ledgerPath,requests:updated.attempts.length,newRequests:updated.attempts.length-original.attempts.length,historicalPrefixUnchanged:true}));
}
