import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {login,readAccount,accountDB} from '../src/lib/accounts.ts';
import {collaborate} from '../src/lib/collaboration.ts';
import {makeKnowledgeDocument,storeOfficialDocument} from '../src/lib/life/acquisition.ts';
import {saveGuidanceSources} from '../src/lib/context/source-reference.ts';
import {saveFragment,listFragments} from '../src/lib/life/stories.ts';
import {
 FOUNDATION_API_VERSION,readReality,discoverCapabilities,compileTaskContext,respond,
 createTask,getTask,recordOutcome,resolveTaskContext,amendOutcome,AgentError,
 type Provider,type ModelResponse,type ServiceSession,type TurnRequest,type AmendOutcomeInput,
} from '../src/lib/foundation/services.ts';
import {startGoal,confirmGoalOutcome} from '../examples/foundation/goal-feature.ts';

/** Protocol substitute, never a creativity/factual-quality evaluator. It reads
 * the actual authorized packet then returns an explicitly synthetic candidate. */
function protocolMock(packets:Record<string,any>[]):Provider{
 let n=0;
 return {ready:true,model:'offline-four-paths',structuredOutput:'json_schema',generate:async()=>{throw Error('no_second_model');},converse:async messages=>{
  const payload=JSON.parse(messages.find(m=>m.role==='user')!.content!);packets.push(payload);
  const result=(name:string,args:unknown):ModelResponse=>({model:'offline-four-paths',text:'',tokens:null,finishReason:'tool_calls',toolCalls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  if(n++===0)return result('get_item_context',{itemIds:[],query:payload.question});
  return result('complete_answer',{message:'[离线Mock候选，未验证实物]利用分格模块分隔、托盘整组承托，尺寸/承重/稳定性待核。获准反馈：'+payload.experiences.map((x:any)=>x.notes).join('；'),guidance:null});
 }};
}

test('四认知最小通路：同一合成空间，真实领域事务/账号授权＋离线Provider，零网络',async t=>{
 mkdirSync('.runtime',{recursive:true});const directory=mkdtempSync(path.resolve('.runtime','four-paths-'));
 const env={data:process.env.PRODUCT_AGENT_DATA_DIR,fetch:process.env.WUJIAN_ALLOW_PUBLIC_FETCH,paid:process.env.AI_ALLOW_PAID_CALLS,allow:process.env.WUJIAN_ALLOW_PAID_CALLS};
 process.env.PRODUCT_AGENT_DATA_DIR=directory;process.env.WUJIAN_ALLOW_PUBLIC_FETCH='false';process.env.AI_ALLOW_PAID_CALLS='false';process.env.WUJIAN_ALLOW_PAID_CALLS='false';
 const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('network_forbidden_in_four_paths');};
 const f=validationFixture(directory);const packets:Record<string,any>[]=[];
 try{
  const owner=login('synthetic_owner',randomBytes(18).toString('hex'),true),guest=login('synthetic_guest',randomBytes(18).toString('hex'),true),actor=owner.account.id,other=guest.account.id;
  assert.equal(readAccount(new Request('http://127.0.0.1:3200/api/life',{headers:{cookie:owner.cookie.split(';')[0]}})).id,actor);
  const a=f.add('[合成]分格模块','其他','Sony','SYNTH-TEAM-01',{attributes:{capabilities:['分隔调色']}}),b=f.add('[合成]围边托盘','其他','无品牌','待确认',{attributes:{capabilities:['练习后便于收走']}});
  const state=f.read();for(const id of [a,b]){const i=state.items.find(i=>i.id===id)!;i.owner=actor;i.synthetic=true;i.shared=false;i.sharedWith=[];}f.write(state);
  const item=f.read().items.find(i=>i.id===a)!;
  // Synthetic source fixture on a known-host shape; not fetched official data.
  const url='https://helpguide.sony.net/synthetic/SYNTH-TEAM-01';
  const doc=makeKnowledgeDocument({url,title:'SYNTH-TEAM-01 synthetic source substitute',text:'SYNTH-TEAM-01\n[合成来源替身]Separate compartments. Actual load and fit not provided.',links:[]},item,[url]);
  storeOfficialDocument(f.db,actor,item,doc);saveGuidanceSources(f.db,f.read(),actor,a,[doc.id],'offline-fixture');
  await t.test('理解物：身份、原文定位、条件化能力均由公共Reality读取',()=>{
   assert.equal(FOUNDATION_API_VERSION,'foundation-services/1');const r=readReality(f.db,f.read(),actor,a);
   assert.equal(r.identity.model,item.model);assert.ok(r.facts.some(x=>x.source.url===url));assert.ok(r.capabilities.some(x=>x.basis==='official_source'&&x.status==='conditional'&&!x.executable));
  });
  const goal='希望分隔调色，练习后便于收走';let first:Awaited<ReturnType<typeof startGoal>>;
  await t.test('物与物：不指定物品的目标发现两资源，候选与缺口跟随同一Task',async()=>{
   assert.ok(discoverCapabilities(f.db,f.read(),actor,{goal}).resources.length>=2);
   first=await startGoal(f.db,f.read,actor,goal,protocolMock(packets));
   assert.ok([a,b].every(id=>first.task.itemInstanceIds.includes(id)));assert.ok(first.turn.reply.answer.includes('待核'));assert.equal(first.turn.foundation?.taskId,first.task.taskId);
  });
  await t.test('物与人：获准反馈实际进入新任务，纠正替换、遗忘移除；知识不被清空',async()=>{
   const outcome=confirmGoalOutcome(f.db,f.read,actor,first!,{requestId:crypto.randomUUID(),confirmed:true,notes:'[合成]单独端软盒失败，下次改由托盘承托',reuse:true,allowCloud:true,goalStatus:'not_achieved'});
   const follow=await startGoal(f.db,f.read,actor,goal,protocolMock(packets));assert.notEqual(follow.task.taskId,first!.task.taskId);assert.match(follow.turn.reply.answer,/单独端软盒失败/);
   const correction:AmendOutcomeInput={outcomeId:outcome.outcomeId,requestId:crypto.randomUUID(),expectedRevision:1,operation:'correct',confirmed:true,notes:'[合成更正]只有阅读，不能当作实际失败',reuse:true,allowCloud:true};
   const revised=amendOutcome(f.db,f.read,actor,correction);const next=await startGoal(f.db,f.read,actor,goal,protocolMock(packets));assert.match(next.turn.reply.answer,/只有阅读/);assert.ok(!next.turn.reply.answer.includes('单独端软盒失败'));
   amendOutcome(f.db,f.read,actor,{outcomeId:outcome.outcomeId,requestId:crypto.randomUUID(),expectedRevision:revised.revision,operation:'forget',confirmed:true});
   const after=await startGoal(f.db,f.read,actor,goal,protocolMock(packets));assert.ok(!after.turn.reply.answer.includes('只有阅读'));assert.equal(resolveTaskContext(f.db,f.read(),actor,after.task.taskId).previousOutcomes.length,0);assert.ok(readReality(f.db,f.read(),actor,a).facts.some(x=>x.source.url===url));
  });
  await t.test('人与人：现有共享领域服务；公开知识和实例状态可读，私人Task/经历/故事不可读，撤权后全部拒绝',async()=>{
   const privateTask=createTask(f.db,f.read,actor,{requestId:crypto.randomUUID(),goal:'PRIVATE-OWNER-TASK',intent:'guide',itemInstanceIds:[a]});
   const privateTurn=await respond(f.db,f.read,actor,{requestId:crypto.randomUUID(),taskId:privateTask.taskId,itemId:a,question:goal,mode:'auto',memoryPolicy:'read'},protocolMock(packets));
   recordOutcome(f.db,f.read,actor,{taskId:privateTask.taskId,runId:privateTurn.foundation!.runId,requestId:crypto.randomUUID(),expectedRevision:getTask(f.db,f.read(),actor,privateTask.taskId).revision,goalStatus:'partial',notes:'PRIVATE-OWNER-EXPERIENCE',confirmed:true,reuse:true,allowCloud:true});
   saveFragment(f.db,f.read,actor,{text:'PRIVATE-OWNER-STORY',itemIds:[a],allowRecall:true,allowCloud:true});
   const act=(who:typeof actor,input:Record<string,unknown>)=>collaborate(f.db,f.read,who,{requestId:crypto.randomUUID(),...input});
   const invite=act(actor,{action:'invite',confirmed:true});act(other,{action:'join',token:invite.invite,confirmed:true});assert.throws(()=>readReality(f.db,f.read(),other,a),AgentError);
   act(actor,{action:'share',itemId:a,memberId:other,enabled:true});const shared=readReality(f.db,f.read(),other,a);assert.equal(shared.instance.state,readReality(f.db,f.read(),actor,a).instance.state);assert.ok(shared.facts.some(x=>x.source.url===url));
   assert.throws(()=>getTask(f.db,f.read(),other,privateTask.taskId),AgentError);assert.equal(listFragments(f.db,f.read(),other,a).length,0);
   const session:ServiceSession={id:crypto.randomUUID(),owner:other,itemId:a,mode:'auto',revision:0,status:'active',known:{memoryPolicy:'read'},tried:[],messages:[],memoryEpoch:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};
   const ctx=compileTaskContext(f.db,f.read(),other,session,goal);assert.ok(!JSON.stringify(ctx).includes('PRIVATE-OWNER-'));
   act(actor,{action:'share',itemId:a,memberId:other,enabled:false});assert.throws(()=>readReality(f.db,f.read(),other,a),AgentError);assert.ok(!discoverCapabilities(f.db,f.read(),other).resources.some(x=>x.id===a));
   const input:TurnRequest={requestId:crypto.randomUUID(),itemId:a,question:goal,mode:'auto',memoryPolicy:'read'};
   const before=packets.length;await assert.rejects(respond(f.db,f.read,other,input,protocolMock(packets)));assert.equal(packets.length,before,'撤权应在模型之前拒绝');
  });
 }finally{
  f.db.close();accountDB().close();globalThis.fetch=network;
  for(const [name,value]of Object.entries({PRODUCT_AGENT_DATA_DIR:env.data,WUJIAN_ALLOW_PUBLIC_FETCH:env.fetch,AI_ALLOW_PAID_CALLS:env.paid,WUJIAN_ALLOW_PAID_CALLS:env.allow}))if(value===undefined)delete process.env[name];else process.env[name]=value;
 }
});
