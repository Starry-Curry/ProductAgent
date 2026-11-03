import test from 'node:test';import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {respond} from '../src/lib/agent/service.ts';
import {decideAction} from '../src/lib/home/store.ts';
import {makeKnowledgeDocument,storeOfficialDocument,readKnowledge} from '../src/lib/life/acquisition.ts';
import {hasCurrentKnowledgeReference} from '../src/lib/context/source-reference.ts';
import type {Provider} from '../src/lib/ai/provider.ts';
import {createTask} from '../src/lib/foundation/tasks.ts';

async function prepared(t:any){
 const f=validationFixture('.runtime/semantic-confirm-'+crypto.randomUUID());t.after(()=>f.db.close());
 const itemId=f.add('[合成]未预置设备','其他','Sony','SYNTH-REF-73'),item=f.read().items.find(i=>i.id===itemId)!;
 const page={url:'https://helpguide.sony.net/synthetic/reference.html',title:item.model,text:item.model+'\nPress the marked key once.\nDo not disassemble.',links:[]};
 const doc=makeKnowledgeDocument(page,item,[page.url]);storeOfficialDocument(f.db,'lin',item,doc);
 let chosen='';const p:Provider={ready:true,model:'offline-binding-test',structuredOutput:'json_schema',generate:async(_s,input:any)=>{
  const source=input.sources[0];return {model:'offline-binding-test',tokens:null,text:JSON.stringify({observations:[{kind:'operation',subject:source.subject,sourceId:source.id,quoteSpans:[source.spans.find((s:any)=>s.text.startsWith('Press')).id],conditions:['尚未操作设备'],unknown:null}]})};
 },converse:async messages=>{
  const tool=messages.findLast(m=>m.role==='tool');
  if(!tool)return {model:'offline-binding-test',tokens:null,text:'',finishReason:'tool_calls',toolCalls:[{id:'read',type:'function',function:{name:'search_product_knowledge',arguments:JSON.stringify({itemId,query:'按键原文'})}}]};
  const input=JSON.parse(tool.content!);chosen=(input.sources[0]||{id:doc.chunks[0].id}).id;
  return {model:'offline-binding-test',tokens:null,text:'',finishReason:'tool_calls',toolCalls:[{id:'preview',type:'function',function:{name:'prepare_action',arguments:JSON.stringify({kind:'plan',goal:'按当前合成资料准备操作',itemIds:[itemId],steps:[{kind:'device_operation',items:[itemId],text:'核对原文后按标示键一次',operationRef:chosen,conditions:['实物标示待核对']}],sourceIds:[chosen],conditions:['仅为候选，尚未操作']})}}]};
 }};
 const result=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId,mode:'service',question:'请准备待我确认的步骤，不要执行',memoryPolicy:'off'},p);
 assert.equal(result.reply.actionCards?.length,1,JSON.stringify(result.trace));
 const card=result.reply.actionCards![0],row=f.db.prepare('SELECT action FROM home_proposals WHERE id=?').get(card.id) as {action:string};
 const reference=JSON.parse(row.action).sourceRefs[0];assert.ok(reference.id.startsWith('sem:'));assert.equal(reference.sourceId,chosen);assert.equal(reference.documentHash,doc.hash);
 return {...f,itemId,item,page,doc,result,card,reference};
}

test('真实执行契约：原文ID在服务端绑定连续引文后进入同一计划，确认时回到原文hash/范围而非强求旧chunk ID',async t=>{
 const f=await prepared(t);assert.ok(hasCurrentKnowledgeReference(readKnowledge(f.db,f.read(),'lin',f.itemId),f.reference));
 const confirmed=decideAction(f.db,f.read,'lin',f.card.id,'confirm');assert.equal(confirmed.status,'applied');
 assert.equal(f.read().plans!.length,1);assert.equal(f.read().plans![0].sources![0].id,f.reference.id);
 assert.equal(decideAction(f.db,f.read,'lin',f.card.id,'confirm').status,'applied');assert.equal(f.read().plans!.length,1);
});
test('相同URL正文变化/伪造范围/假语义ID不能通过确认，原始资料仍保留版本',async t=>{
 const f=await prepared(t),docs=readKnowledge(f.db,f.read(),'lin',f.itemId);
 assert.equal(hasCurrentKnowledgeReference(docs,{id:f.reference.id,url:f.reference.url}),false);
 assert.equal(hasCurrentKnowledgeReference(docs,{...f.reference,quoteRange:{start:0,end:999999}}),false);
 assert.equal(hasCurrentKnowledgeReference(docs,{...f.reference,quoteHash:'0'.repeat(64)}),false);
 assert.ok(hasCurrentKnowledgeReference(docs,{id:f.doc.chunks[0].id,url:f.doc.url}),'historical raw chunk references remain supported');
 const changed=makeKnowledgeDocument({...f.page,text:f.page.text+'\nUpdated source conditions.'},f.item,[f.page.url]);storeOfficialDocument(f.db,'lin',f.item,changed);
 assert.throws(()=>decideAction(f.db,f.read,'lin',f.card.id,'confirm'),/资料已经更新/);assert.equal(f.read().plans?.length||0,0);
 assert.equal((f.db.prepare("SELECT count(*) n FROM life_knowledge_documents WHERE status='superseded'").get() as any).n,1);
});

test('持久Task为plan不等于每轮都要新动作；无型号纪念物的状态/未知问答不强制商业手册搜索',async t=>{
 const f=validationFixture('.runtime/task-status-'+crypto.randomUUID());t.after(()=>f.db.close());
 const itemId=f.add('[合成]纪念物','其他','','待确认');
 const task=createTask(f.db,f.read,'lin',{requestId:crypto.randomUUID(),goal:'整理与纪念物的经历',intent:'plan',itemInstanceIds:[itemId]});
 let calls=0;const provider:Provider={ready:true,model:'offline-status',structuredOutput:'json_schema',generate:async()=>{throw Error('no product sources, no extraction');},converse:async(_m,_t,options)=>{
  calls++;assert.equal(options.toolChoice,'required','unknown model is not a commercial lookup trigger');
  return {text:'',model:'offline-status',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'status',type:'function',function:{name:'complete_answer',arguments:JSON.stringify({message:'当前没有获准的完成记录，不能确认你已经做过或成功。',guidance:null})}}]};
 }};
 const result=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),taskId:task.taskId,itemId,mode:'auto',question:'我之前真的完成了吗？没有记录就说不知道。',memoryPolicy:'read'},provider);
 assert.equal(result.reply.outcome,'answered');assert.equal(calls,1);assert.match(result.reply.answer,/不能确认/);
 assert.equal(result.reply.actionCards?.length||0,0);assert.equal(f.read().plans?.length||0,0);
});
