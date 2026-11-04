import test from 'node:test';import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {makeKnowledgeDocument,storeOfficialDocument,readKnowledge} from '../src/lib/life/acquisition.ts';
import {saveGuidanceSources,readSourceSelections} from '../src/lib/context/source-reference.ts';
import {respond} from '../src/lib/agent/service.ts';
import type {Provider} from '../src/lib/ai/provider.ts';

test('已向主模型提供的原文定位可在同一契约中用于候选计划；换版旧定位不能借用',async t=>{
 const f=validationFixture('.runtime/finals-prior-source-'+crypto.randomUUID());t.after(()=>f.db.close());
 const oldRuntime=process.env.WUJIAN_AGENT_RUNTIME,oldFetch=process.env.WUJIAN_ALLOW_PUBLIC_FETCH;process.env.WUJIAN_AGENT_RUNTIME='native';process.env.WUJIAN_ALLOW_PUBLIC_FETCH='false';t.after(()=>{if(oldRuntime===undefined)delete process.env.WUJIAN_AGENT_RUNTIME;else process.env.WUJIAN_AGENT_RUNTIME=oldRuntime;if(oldFetch===undefined)delete process.env.WUJIAN_ALLOW_PUBLIC_FETCH;else process.env.WUJIAN_ALLOW_PUBLIC_FETCH=oldFetch;});
 const id=f.add('合成耳机','电子','Sony','WH-CH520'),item=f.read().items.find(i=>i.id===id)!;
 const doc=makeKnowledgeDocument({url:'https://helpguide.sony.net/synthetic/WH-CH520',title:'WH-CH520 synthetic manual',text:'WH-CH520 synthetic fixture: hold the marked button as described. Not a real product instruction.',links:[]},item,[]);
 storeOfficialDocument(f.db,'lin',item,doc);saveGuidanceSources(f.db,f.read(),'lin',id,[doc.chunks[0].id],'offline-fixture');
 const ref=readSourceSelections(item,readKnowledge(f.db,f.read(),'lin',id))[0];assert.ok(ref.id.startsWith('sem:'));
 let stale=false,calls=0;const provider:Provider={ready:true,structuredOutput:'json_schema',model:'offline-contract-not-Qwen',generate:async()=>{throw Error('no_second_reviewer');},converse:async (messages,tools)=>{
  calls++;const packet=JSON.parse(messages.find(m=>m.role==='user')!.content!);
  if(!stale){assert.ok(packet.officialSemantics.priorSelections.some((s:any)=>s.id===ref.id));const prepare=tools.find(t=>t.function.name==='prepare_action')!;assert.ok(JSON.stringify(prepare.function.parameters).includes(ref.id),'给模型看过的定位也必须能被相同工具契约使用');}
  else assert.ok(!packet.officialSemantics.priorSelections.some((s:any)=>s.id===ref.id));
  const proposal={kind:'plan',goal:'保存合成的待核操作候选',itemIds:[id],steps:[{kind:'device_operation',items:[id],operationRef:ref.id,text:'依据合成原文提出待核操作，不实际执行',conditions:['仅为合成测试，不是硬件指令']}],sourceIds:[ref.id],conditions:['未做实物验证']};
  return {model:provider.model,text:'',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'source-'+calls,type:'function',function:{name:stale&&calls>1?'complete_answer':'prepare_action',arguments:JSON.stringify(stale&&calls>1?{message:'旧资料已失效，不能保存该操作。',guidance:null}:proposal)}}]};
 }};
 const result=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:'请保存这件物品的操作计划候选，不执行',mode:'auto',memoryPolicy:'off'},provider);
 assert.equal(result.reply.actionCards?.length,1);assert.equal((f.read().plans||[]).length,0,'预览候选不等于确认写入计划');
 const replacement=makeKnowledgeDocument({url:doc.url,title:doc.title,text:'WH-CH520 replacement synthetic edition: no previous operation in this edition.',links:[]},item,[]);storeOfficialDocument(f.db,'lin',item,replacement);stale=true;calls=0;
 const rejected=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:'请保存旧操作，不执行',mode:'auto',memoryPolicy:'off'},provider);
 assert.equal(rejected.reply.actionCards?.length,0);assert.ok(rejected.trace.some(t=>t.stage==='practical_tool_failed'));assert.equal((f.read().plans||[]).length,0);
});
