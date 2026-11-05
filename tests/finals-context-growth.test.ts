import test from 'node:test';import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {makeKnowledgeDocument,storeOfficialDocument,readKnowledge} from '../src/lib/life/acquisition.ts';
import {saveGuidanceSources} from '../src/lib/context/source-reference.ts';
import {readReality} from '../src/lib/context/reality-service.ts';
import {modelReality,discoverableEffects} from '../src/lib/context/reality.ts';
import {respond} from '../src/lib/agent/service.ts';
import type {Provider} from '../src/lib/ai/provider.ts';

test('对抗长期知识积累：保留完整原文，不把全部历史手册段落复制成能力、目录和模型Context',async t=>{
 const f=validationFixture('.runtime/finals-growth-'+crypto.randomUUID());t.after(()=>f.db.close());
 const oldRuntime=process.env.WUJIAN_AGENT_RUNTIME,oldFetch=process.env.WUJIAN_ALLOW_PUBLIC_FETCH;process.env.WUJIAN_AGENT_RUNTIME='native';process.env.WUJIAN_ALLOW_PUBLIC_FETCH='false';t.after(()=>{if(oldRuntime===undefined)delete process.env.WUJIAN_AGENT_RUNTIME;else process.env.WUJIAN_AGENT_RUNTIME=oldRuntime;if(oldFetch===undefined)delete process.env.WUJIAN_ALLOW_PUBLIC_FETCH;else process.env.WUJIAN_ALLOW_PUBLIC_FETCH=oldFetch;});
 const id=f.add('合成耳机','电子','Sony','WH-CH520',{attributes:{dimensions:'合成尺寸，未测量',capabilities:['发声']}}),item=f.read().items.find(i=>i.id===id)!;
 const text='WH-CH520 synthetic manual.\n'+Array.from({length:35},(_,n)=>'SYNTHETIC-HISTORY-'+n+' '+('Unrelated original operation section and full conditions. '.repeat(22))).join('\n\n');
 const doc=makeKnowledgeDocument({url:'https://helpguide.sony.net/synthetic/WH-CH520',title:'WH-CH520 synthetic accumulated manual',text,links:[]},item,[]);storeOfficialDocument(f.db,'lin',item,doc);saveGuidanceSources(f.db,f.read(),'lin',id,doc.chunks.map(c=>c.id),'offline');
 const full=readReality(f.db,f.read(),'lin',id),compact=modelReality(full,{sourceAssertions:'references'});
 assert.ok(full.facts.some(f=>String(f.value).includes('SYNTHETIC-HISTORY')),'共享原文不得为省Token而删除');
 assert.ok(JSON.stringify(compact).length<JSON.stringify(modelReality(full)).length/3);
 assert.deepEqual(discoverableEffects(full),['发声'],'整段说明书不应被当作可利用功能塞进目录');
 assert.equal(readKnowledge(f.db,f.read(),'lin',id)[0].text,text);
 const provider:Provider={ready:true,structuredOutput:'json_schema',model:'offline-packet-inspection',generate:async()=>{throw Error('no_new_extractor_or_reviewer');},converse:async messages=>{
  const packet=JSON.parse(messages.find(m=>m.role==='user')!.content!);assert.ok(Buffer.byteLength(JSON.stringify(packet))<40000,'Context大小不应随历史定位正文线性重复增长');
  assert.ok(packet.officialSemantics.originalSources.length>0);assert.ok(packet.officialSemantics.priorSelections.every((s:any)=>!('text'in s)&&!!s.originalSourceId));assert.ok(!packet.catalogue.some((c:any)=>c.effects.some((e:string)=>e.includes('SYNTHETIC-HISTORY'))));
  return {model:provider.model,text:'',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'short',type:'function',function:{name:'complete_answer',arguments:JSON.stringify({message:'当前资料没有这个问题的适用答案，保留未知。',guidance:null})}}]};
 }};
 const r=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:'这个物品还有哪些未知条件？',mode:'auto',memoryPolicy:'off'},provider);assert.equal(r.modelCalls,1);
});
