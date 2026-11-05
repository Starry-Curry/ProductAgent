// Completes only the previously NOT_RUN same-information controls. It never
// repeats/relabels a product first answer or overwrites the original blocked log.
import fs from 'node:fs';import {createHash} from 'node:crypto';
import OpenAI from 'openai';
import {foundationGateway,ROOT,ROUND} from './gateway.mjs';
const BASE='docs/engineering/qwen-foundation-2026-11-02/evidence';
const run='foundation-independent-r1',output=BASE+'/acceptance-runs/'+run;
if(ROUND!=='qwen-foundation-20261103-r2')throw Error('explicit_additional_round_required');
const prior=JSON.parse(fs.readFileSync(BASE+'/model-calls.json'));
const progress=JSON.parse(fs.readFileSync(output+'/RUN_FINAL.json'));
const selected=process.argv.find(a=>a.startsWith('--cases='))?.slice(8).split(',')||[];
if(!process.argv.includes('--execute-selected')||!selected.length){console.log('Read-only by default. Supply --execute-selected --cases=<explicit-case-id,...> for necessary diagnosed failures only.');process.exit(0);}
const rows=progress.cases.filter(c=>c.arm==='product'&&selected.includes(c.caseId));
if(rows.length!==selected.length)throw Error('unknown_case_id');
const readLedger=()=>JSON.parse(fs.readFileSync(ROOT+'/model-calls.json'));
const records=[],start=readLedger().attempts.length;
let gate;
try{
 gate=await foundationGateway({phase:'integration',recordContent:true});
 const client=new OpenAI({apiKey:'fixture-only',baseURL:gate.url+'/direct/v1',maxRetries:0,timeout:90000});
 for(const row of rows){
  const file=output+'/'+row.caseId+'.direct.CONTROL.json';if(fs.existsSync(file))throw Error('preserve_existing_control');
  const product=JSON.parse(fs.readFileSync(output+'/'+row.caseId+'.product.FIRST.json'));
  const tagged=prior.attempts.filter(a=>a.evaluation===run+':'+row.caseId+':product');
  const last=tagged.findLast(a=>a.kind==='inference'&&a.tools?.length&&Array.isArray(a.input));
  const record={caseId:row.caseId,arm:'direct',controlCohort:'additional_authorized_round_same_information',roundId:ROUND,status:'not_run',quality:'not_scored',at:new Date().toISOString()};
  const before=readLedger().attempts.length,t=performance.now();
  try{
   if(!last)throw Error('no_equivalent_product_input');
   const material=last.input.filter(m=>['user','tool'].includes(m.role)&&m.content!=null).map(m=>({role:'user',content:m.content}));
   record.sameInformation={productRequestNumber:last.number,materialSha256:createHash('sha256').update(JSON.stringify(material)).digest('hex'),method:'exact user/tool content of product final tool-loop request; excludes system and assistant drafts'};
   const r=await client.chat.completions.create({model:gate.model,messages:[{role:'system',content:'请根据提供的同等物品与官方资料回答用户当前问题。完整而自然，明确证据不足/适用条件；不要编造型号操作，不宣称实际执行。'},...material,{role:'user',content:product.question}],max_tokens:2400,temperature:0.35,enable_thinking:false},{headers:{'x-wujian-evaluation':run+':'+row.caseId+':direct-control'}});
   record.text=r.choices?.[0]?.message?.content||'';record.usage=r.usage;record.model=r.model;record.finishReason=r.choices?.[0]?.finish_reason;record.status='returned_not_scored';
  }catch(e){record.status='failed_not_scored';record.error=String(e.message).slice(0,500);}
  record.fullAnswerMs=Math.round(performance.now()-t);record.upstreamNumbers=readLedger().attempts.slice(before).map(a=>a.number);
  fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n',{flag:'wx'});records.push({caseId:row.caseId,status:record.status});
  console.log(JSON.stringify(records.at(-1)));
 }
}finally{if(gate)await gate.close();fs.writeFileSync(output+'/CONTROL_FINAL.json',JSON.stringify({roundId:ROUND,originalRun:run,records,actualUpstreamRequests:readLedger().attempts.length-start,firstAnswersUnchanged:true,quality:'not_scored'},null,2)+'\n',{flag:'wx'});}
