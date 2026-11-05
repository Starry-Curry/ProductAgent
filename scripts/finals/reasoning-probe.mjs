import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {finalsGateway,ROOT,ROUND} from './gateway.mjs';
import {createProvider} from '../../src/lib/ai/provider.ts';
import {practicalTools} from '../../src/lib/agent/practical.ts';
const file=ROOT+'/reasoning-probe-r1.json';assert.ok(!fs.existsSync(file),'preserve originals');
const original=JSON.parse(fs.readFileSync(ROOT+'/model-calls.json')).attempts.find(a=>a.number===51);assert.ok(original?.contentRecorded);
const report={at:new Date().toISOString(),round:ROUND,basis:'same_pinned_Qwen_and_identical_recorded_synthetic_context_parameter_and_format_ablation_not_quality_certification',originalRequest:51,inputSha256:createHash('sha256').update(JSON.stringify(original.input)).digest('hex'),cases:[],errors:[]};
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));save();
const gate=await finalsGateway({recordContent:true});
try{
 const provider=createProvider({AI_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',AI_API_KEY:'fixture-only',AI_MODEL:gate.model,AI_ALLOW_PAID_CALLS:'true',WUJIAN_ALLOW_PAID_CALLS:'true'},(url,init)=>fetch(gate.url+'/chat/completions',{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),'x-wujian-evaluation':'reasoning-ablation'}}));
 for(const [label,thinking,tools] of [['tools_thinking',true,practicalTools],['direct_without_tools',false,[]],['direct_thinking',true,[]]]){
  const start=Date.now();try{
   const messages=structuredClone(original.input);
   // Direct controls receive the same facts, history and question. Remove only
   // the wrapper's final-tool instruction, otherwise this is not a fair direct chat.
   if(!tools.length)messages[0].content=messages[0].content.split('\n本路径最终答复必须调用complete_answer')[0];
   const result=await provider.converse(messages,tools,{thinking,thinkingBudget:2048,maxTokens:6000,timeoutMs:90000,toolChoice:tools.length?{type:'function',function:{name:'complete_answer'}}:'none'});
   report.cases.push({label,thinking,elapsedMs:Date.now()-start,inputSha256:createHash('sha256').update(JSON.stringify(messages)).digest('hex'),output:result.text,toolCalls:result.toolCalls,model:result.model,tokens:result.tokens,finishReason:result.finishReason,quality:'requires_source_based_review'});
  }catch(e){report.cases.push({label,thinking,elapsedMs:Date.now()-start,error:e.message});}
  save();
 }
}finally{await gate.close();save();console.log(JSON.stringify({cases:report.cases.map(c=>({label:c.label,elapsedMs:c.elapsedMs,error:c.error,tokens:c.tokens})),errors:report.errors}));}
