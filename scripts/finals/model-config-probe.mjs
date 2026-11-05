import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {finalsGateway,ROOT,ROUND} from './gateway.mjs';import {createProvider} from '../../src/lib/ai/provider.ts';import {practicalTools} from '../../src/lib/agent/practical.ts';
const file=ROOT+'/model-config-probe-r1.json';assert.ok(!fs.existsSync(file));const ledger=JSON.parse(fs.readFileSync(ROOT+'/model-calls.json'));
const brother=JSON.parse(fs.readFileSync(ROOT+'/experience-browser-r5.json')),painting=JSON.parse(fs.readFileSync(ROOT+'/persona-browser-r4.json'));
function source(itemId,question){const a=ledger.attempts.find(a=>a.kind==='inference'&&a.question===question&&a.input?.some(m=>{try{return JSON.parse(m.content).items?.some(i=>i.id===itemId);}catch{return false;}}));assert.ok(a,'original input required');return a;}
const cases=[{id:'label-layout',original:source(brother.itemId,brother.responses[0].question)},{id:'painting-and-desk',original:source(painting.itemId,painting.responses[0].question)}];
const report={at:new Date().toISOString(),round:ROUND,basis:'development_diagnostics_two_historical_failures_same_input_per_case_not_holdout_or_product_acceptance',pricingSource:'https://help.aliyun.com/zh/model-studio/model-pricing',thinkingSource:'https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions',cases:[],errors:[]};const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));save();
const configurations=[{id:'max_low_tools',model:'qwen3.8-max-0902',budget:2048,tools:true},{id:'max_medium_tools',model:'qwen3.8-max-0902',budget:8192,tools:true},{id:'plus_low_tools',model:'qwen3.7-plus-2026-05-26',budget:2048,tools:true},{id:'max_low_direct',model:'qwen3.8-max-0902',budget:2048,tools:false}];
for(const config of configurations){
 const gate=await finalsGateway({recordContent:true,model:config.model,thinkingBudget:config.budget});
 try{
  const provider=createProvider({AI_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',AI_API_KEY:'fixture-only',AI_MODEL:config.model,AI_ALLOW_PAID_CALLS:'true',WUJIAN_ALLOW_PAID_CALLS:'true'},(url,init)=>fetch(gate.url+'/chat/completions',{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),'x-wujian-evaluation':'config-'+config.id}}));
  for(const task of cases){
   const messages=structuredClone(task.original.input);if(!config.tools)messages[0].content=messages[0].content.split('\n本路径最终答复必须调用complete_answer')[0];const start=Date.now();
   try{const r=await provider.converse(messages,config.tools?practicalTools:[],{thinking:true,thinkingBudget:config.budget,maxTokens:6000,timeoutMs:90000,toolChoice:config.tools?{type:'function',function:{name:'complete_answer'}}:'none'});report.cases.push({caseId:task.id,config:config.id,model:r.model,thinkingBudget:config.budget,originalRequest:task.original.number,inputSha256:createHash('sha256').update(JSON.stringify(messages)).digest('hex'),elapsedMs:Date.now()-start,text:r.text,toolCalls:r.toolCalls,tokens:r.tokens,finishReason:r.finishReason,quality:'needs_source_based_human_review'});}
   catch(e){report.cases.push({caseId:task.id,config:config.id,error:e.message,elapsedMs:Date.now()-start});if(/404|not_found|not_supported|不支持/.test(e.message)){save();break;}}
   save();
  }
 }finally{await gate.close();save();}
}
console.log(JSON.stringify({completed:report.cases.length,failures:report.cases.filter(c=>c.error).map(c=>({caseId:c.caseId,config:c.config,error:c.error}))}));
