import fs from 'node:fs';
import {ROOT} from './gateway.mjs';
const file=ROOT+'/direct-final-same-facts.json';
if(fs.existsSync(file))throw Error('preserve_evidence');
const ledger=JSON.parse(fs.readFileSync(ROOT+'/model-calls.json'));
const bound=JSON.parse(fs.readFileSync(ROOT+'/cross-bound-final.json'));
const turn=bound.responses[0],start=turn.result.session.createdAt,end=turn.result.trace.at(-1).at;
const sample=ledger.attempts.find(a=>a.question===turn.question&&a.startedAt>=start&&a.startedAt<=end);
if(!sample?.input)throw Error('matching_application_input_missing');
// Reuse the running task gateway: no second ledger or credential reader.
const gate=JSON.parse(fs.readFileSync('.runtime/integrated-gateway.json'));
const started=Date.now();
const response=await fetch(gate.url+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer fixture-only','content-type':'application/json','x-wujian-evaluation':'final-direct-same-facts-no-tools'},body:JSON.stringify({model:gate.model,messages:sample.input,enable_thinking:true,thinking_budget:768,max_tokens:6000}),signal:AbortSignal.timeout(90000)});
const data=await response.json();
fs.writeFileSync(file,JSON.stringify({at:new Date().toISOString(),basis:'same_model_same_initial_application_messages_thinking768_no_tools_no_plan_transaction',applicationAttempt:sample.number,httpStatus:response.status,elapsedMs:Date.now()-started,text:data.choices?.[0]?.message?.content,error:data.error,usage:data.usage,model:data.model},null,2));
console.log(JSON.stringify({httpStatus:response.status,elapsedMs:Date.now()-started,characters:data.choices?.[0]?.message?.content?.length}));
