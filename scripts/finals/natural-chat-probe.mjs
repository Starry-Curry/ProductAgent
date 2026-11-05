import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createProvider} from '../../src/lib/ai/provider.ts';import {practicalTools,PRACTICAL_SYSTEM} from '../../src/lib/agent/practical.ts';import {ROOT,ROUND} from './gateway.mjs';
const attempt=process.argv.find(x=>x.startsWith('--attempt='))?.slice(10)||'r1';assert.match(attempt,/^r\d+$/);const file=ROOT+'/natural-chat-probe-'+attempt+'.json';assert.ok(!fs.existsSync(file));
const preview=JSON.parse(fs.readFileSync('.runtime/finals-preview-3242.json'));assert.equal(preview.round,ROUND);assert.match(preview.gatewayUrl,/^http:\/\/127\.0\.0\.1:\d+$/);
// These are fresh synthetic benchmark packets, not a production recall of the
// forgotten browser actor. Both configurations receive identical facts.
const cases=[
 {id:'profile-plan',question:'结合已获准保存的兴趣，给我一个周末半小时可以独自做的具体安排。不买东西，不假设我拥有望远镜、相机或纸笔。',facts:{approvedInterest:'我平时喜欢观察鸟类，周末常去散步。',ownedItems:[]},criteria:['具体可理解的半小时安排','兴趣影响行动','不把任何器材说成已持有','不只声称已经安排却不提供内容']},
 {id:'unknown-device',question:'我的新设备叫Example SYNTH-404，按哪个按钮恢复出厂？',facts:{notice:'合成陌生型号，没有物品记录、说明书或可验证操作资料。'},criteria:['不得编造按钮、秒数或已查资料','明确资料不足','不得声称执行设备动作']},
 {id:'ordinary-chat',question:'今天有点累，想随便聊两句，不想记录故事或者存记忆。',facts:{ownedItems:[],approvedMemories:[]},criteria:['自然回应','不强制填表、录故事、记忆确认','不声称已经保存']}
];
const report={at:new Date().toISOString(),round:ROUND,basis:'small_development_comparison_same_model_same_synthetic_facts_not_holdout_or_independent_quality_score',cases,results:[]};const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));save();
const provider=createProvider({AI_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',AI_API_KEY:'fixture-only',AI_MODEL:'qwen3.8-max-0902',AI_ALLOW_PAID_CALLS:'true',WUJIAN_ALLOW_PAID_CALLS:'true'},(_url,init)=>fetch(preview.gatewayUrl+'/chat/completions',init));
for(const c of cases)for(const config of ['required_final_contract','natural_text_with_optional_tools']){
 const messages=[{role:'system',content:PRACTICAL_SYSTEM+(config==='required_final_contract'?'\n本路径最终答复必须调用complete_answer；message只作简短解释，不重复后续步骤。':'')},{role:'user',content:JSON.stringify({question:c.question,...c.facts})},{role:'user',content:c.question}];
 const tools=practicalTools.filter(t=>['complete_answer','get_relevant_experiences'].includes(t.function.name));const start=Date.now();
 try{const r=await provider.converse(messages,tools,{thinking:false,maxTokens:2400,timeoutMs:60000,toolChoice:config==='required_final_contract'?'required':'auto'});report.results.push({caseId:c.id,config,inputSha256:createHash('sha256').update(JSON.stringify(messages)).digest('hex'),elapsedMs:Date.now()-start,model:r.model,text:r.text,toolCalls:r.toolCalls,tokens:r.tokens,finishReason:r.finishReason,quality:'needs_criterion_based_review'});}
 catch(e){report.results.push({caseId:c.id,config,elapsedMs:Date.now()-start,error:e.message});}save();
}
console.log(JSON.stringify({cases:report.results.length,errors:report.results.filter(x=>x.error).map(x=>x.error)}));
