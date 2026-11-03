import test from 'node:test';
import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {makeKnowledgeDocument,storeOfficialDocument,readKnowledge} from '../src/lib/life/acquisition.ts';
import {extractSourceSemantics} from '../src/lib/context/source-semantics.ts';
import {saveSourceSelections,readSourceSelections} from '../src/lib/context/source-reference.ts';
import {readReality} from '../src/lib/context/reality-service.ts';
import {respond} from '../src/lib/agent/service.ts';
import {migrateUnified} from '../src/lib/foundation/schema.ts';
import type {Provider} from '../src/lib/ai/provider.ts';

function setup(t:any){
 const f=validationFixture('.runtime/source-reuse-'+crypto.randomUUID());t.after(()=>f.db.close());migrateUnified(f.db);
 const id=f.add('[合成·离线]新型号物品','其他','Sony','SYNTH-REUSE-91');
 const item=f.read().items.find(i=>i.id===id)!;
 const page={url:'https://helpguide.sony.net/synthetic/reuse.html',title:item.model,text:item.model+'\nDisconnect power before cleaning.\nPress the marked key once.\nKeep dry.',links:[]};
 const doc=makeKnowledgeDocument(page,item,[page.url]);storeOfficialDocument(f.db,'lin',item,doc);
 return {...f,id,item,page,doc};
}
async function select(f:ReturnType<typeof setup>){
 const provider:Provider={ready:true,model:'offline-source-selector',generate:async(_s,input:any)=>{
  const source=input.sources[0];return {model:'offline-source-selector',tokens:null,text:JSON.stringify({observations:[
   {kind:'operation',subject:source.subject,sourceId:source.id,quoteSpans:[source.spans.find((s:any)=>s.text.startsWith('Press')).id],conditions:['PRIVATE-CONDITION-MUST-NOT-PERSIST'],unknown:null},
   {kind:'unknown',subject:source.subject,sourceId:source.id,quoteSpans:[],conditions:[],unknown:'未提供保修期限'},
  ]})};
 }};
 return extractSourceSemantics(provider,'PRIVATE-USER-QUESTION',[{id:f.doc.id,itemId:f.id,model:f.item.model,region:f.doc.region,text:f.doc.text,url:f.doc.url,hash:f.doc.hash}]);
}
test('共享知识复用连续原文定位，保持原始正文；私人问题/条件和未知不持久化',async t=>{
 const f=setup(t),result=await select(f);saveSourceSelections(f.db,f.read(),'lin',f.id,result);
 saveSourceSelections(f.db,f.read(),'lin',f.id,result);
 const docs=readKnowledge(f.db,f.read(),'lin',f.id);assert.equal(docs.length,1);assert.equal(docs[0].text,f.doc.text);assert.equal(docs[0].hash,f.doc.hash);
 assert.equal(docs[0].sourceSelections?.entries.length,1);assert.ok(!JSON.stringify(docs).includes('PRIVATE-'));
 const entries=readSourceSelections(f.item,docs);assert.equal(entries[0].text,'Press the marked key once.');
 const reality=readReality(f.db,f.read(),'lin',f.id);
 assert.ok(reality.facts.some(f=>f.value===entries[0].text&&f.basis==='official_source'));
 assert.ok(reality.capabilities.some(c=>c.effect===entries[0].text&&c.status==='conditional'&&!c.executable&&!c.verifiedForThisInstance));
 assert.ok(!JSON.stringify(reality).includes('未提供保修期限'));
});
test('知识来源正文变更/型号变更/撤权后，不复用过期或无权定位',async t=>{
 const f=setup(t);saveSourceSelections(f.db,f.read(),'lin',f.id,await select(f));
 const docs=readKnowledge(f.db,f.read(),'lin',f.id);
 assert.equal(readSourceSelections({...f.item,model:'OTHER-MODEL'},docs).length,0);
 const changed=makeKnowledgeDocument({...f.page,text:f.page.text+'\nChanged edition.'},f.item,[f.page.url]);storeOfficialDocument(f.db,'lin',f.item,changed);
 assert.equal(readSourceSelections(f.item,readKnowledge(f.db,f.read(),'lin',f.id)).length,0);
 const s=f.read(),i=s.items.find(i=>i.id===f.id)!;i.owner='u_owner';i.shared=true;i.sharedWith=['u_guest'];f.write(s);
 f.db.prepare('INSERT INTO foundation_grants VALUES(?,?,?,?,?,?)').run('g','u_owner','u_guest',f.id,1,JSON.stringify({actions:['read'],revokedAt:new Date().toISOString()}));
 assert.throws(()=>readReality(f.db,f.read(),'u_guest',f.id),/未获当前授权/);
 assert.throws(()=>saveSourceSelections(f.db,f.read(),'u_guest',f.id,awaitedResult),/未获当前授权/);
});
// Authorization is checked before the payload is inspected.
const awaitedResult={} as any;
test('有适用缓存的普通问答只调用一次主模型；不强制抽取、允许原文步骤及部分未知',async t=>{
 const f=setup(t);let calls=0;
 const provider:Provider={ready:true,model:'offline-short-path',structuredOutput:'json_schema',generate:async()=>{throw Error('mandatory extraction must be removed');},converse:async(messages)=>{
  calls++;const input=JSON.parse(messages.find(m=>m.role==='user')!.content!);
  const source=input.officialSemantics.originalSources.find((s:any)=>s.text.includes('Press the marked'));
  assert.ok(source);return {model:'offline-short-path',text:'',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'answer',type:'function',function:{name:'complete_answer',arguments:JSON.stringify({message:'操作如下；保修期限资料未说明，不能推定不保修。',guidance:{kind:'procedure',itemId:f.id,steps:[{text:'按标示键一次。',sourceId:source.id}],conditions:['本次仅离线模拟；实物按键标示需核对']}})}}]};
 }};
 const r=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:f.id,question:'这个设备如何按键操作，保修多久？',mode:'service',memoryPolicy:'off'},provider);
 assert.equal(calls,1);assert.equal(r.reply.outcome,'answered');assert.match(r.reply.answer,/按标示键一次/);assert.match(r.reply.answer,/不能推定/);assert.ok(r.reply.citations.some(c=>c.url===f.page.url));
});
