import fs from 'node:fs';
import {integratedGateway,ROOT} from './gateway.mjs';
const file=ROOT+'/thinking-comparison.json';if(fs.existsSync(file))throw Error('preserve_evidence');
const prior=JSON.parse(fs.readFileSync('docs/engineering/practical-continuation-2026-11-01/evidence/additional-r1/model-calls.json'));
const sample=prior.attempts.find(a=>a.question?.includes('EOS R50相机、Osmo Mobile 6'));
if(!sample?.input)throw Error('original_input_missing');
const gate=await integratedGateway({recordContent:true}),results=[];
try{
 for(const thinking of [false,true]){
  const start=Date.now(),r=await fetch(gate.url+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer fixture-only','content-type':'application/json','x-wujian-evaluation':'same-facts-direct-thinking-'+thinking},body:JSON.stringify({model:gate.model,messages:sample.input,enable_thinking:thinking,...(thinking?{thinking_budget:2048}:{}),max_tokens:6000,temperature:0.35}),signal:AbortSignal.timeout(90000)});
  const d=await r.json();results.push({thinking,httpStatus:r.status,elapsedMs:Date.now()-start,text:d.choices?.[0]?.message?.content,error:d.error,usage:d.usage});
  fs.writeFileSync(file,JSON.stringify({basis:'same_model_same_original_input_no_tools_direct_comparison',priorAttempt:sample.number,results},null,2));
 }
}finally{await gate.close();}
console.log(JSON.stringify(results.map(({text,...r})=>({...r,characters:text?.length}))));
