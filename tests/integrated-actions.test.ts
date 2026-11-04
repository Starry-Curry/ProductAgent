import test from 'node:test';import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {respond} from '../src/lib/agent/service.ts';
import {decideAction} from '../src/lib/home/store.ts';
import {listFragments} from '../src/lib/life/stories.ts';
import {checkPlanResources} from '../src/lib/agent/practical-actions.ts';
import type {Provider} from '../src/lib/ai/provider.ts';
import {relevantManualLinks} from '../src/lib/life/retrieval-topics.ts';
import {createTask,resolveTaskContext,taskRuns} from '../src/lib/foundation/tasks.ts';
import {clearOwnerContext} from '../src/lib/memory/store.ts';
import {makeKnowledgeDocument,storeOfficialDocument} from '../src/lib/life/acquisition.ts';
const plan=(ids=['camera'])=>({kind:'plan',goal:'拍摄',itemIds:ids,steps:['手持记录'],sourceIds:[] as string[],conditions:[] as string[]});
test('目录按新问题跨语言选择实际章节，不把录像总章当作所有快门设置的答案',()=>{
 const links=[{title:'Movie Recording Size',url:'https://example.com/size'},{title:'Movie Recording',url:'https://example.com/movie'},{title:'Shutter Button Function for Movies',url:'https://example.com/shutter'}];
 assert.equal(relevantManualLinks('怎样录像',links)[0].url,links[1].url);
 assert.equal(relevantManualLinks('照片快门能直接录像吗',links)[0].url,links[2].url);
});
test('行动资源：未持有、未满足条件、来源跨物品、未确认前提均不能保存为可执行计划',()=>{
 assert.throws(()=>checkPlanResources(plan(['imaginary']),['camera'],[],[]),/未登记/);
 const check:any={itemIds:['gimbal'],satisfied:false,detail:'310g超出290g'};
 assert.throws(()=>checkPlanResources(plan(['gimbal']),['gimbal'],[check],[]),/310g/);
 const p={...plan(),conditions:['支撑未知']};assert.equal(checkPlanResources(p,['camera'],[],[]).readiness,'conditional');
 const op={...plan(),sourceIds:['other-source']};
 assert.throws(()=>checkPlanResources(op,['camera'],[],[{id:'other-source',itemId:'gimbal'}]),/不属于/);
 assert.deepEqual(checkPlanResources(plan(),['camera'],[],[]).itemIds,['camera']);
});
test('统一Agent故事：真实领域确认后才写入，默认私密且无云端同意，确认幂等',async t=>{
 const f=validationFixture('.runtime/integrated-actions-'+crypto.randomUUID());t.after(()=>f.db.close());const id=f.add('[合成]相机经历','其他','Canon','TEST');
 const old=process.env.WUJIAN_AGENT_RUNTIME;process.env.WUJIAN_AGENT_RUNTIME='native';t.after(()=>{if(old===undefined)delete process.env.WUJIAN_AGENT_RUNTIME;else process.env.WUJIAN_AGENT_RUNTIME=old;});
 let n=0;const provider:Provider={ready:true,model:'offline-substitute',generate:async()=>{throw Error('no_reviewer');},converse:async()=>++n===1?{model:'offline-substitute',text:'',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'story',type:'function',function:{name:'prepare_action',arguments:JSON.stringify({kind:'story',itemId:id,text:'[合成]今天给爸爸录了做饭片段，原因尚未验证。'})}}]}:{model:'offline-substitute',text:'请先预览并确认这段私人故事。',tokens:null,finishReason:'stop',toolCalls:[]}};
 const r=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:'请保存刚才这段物品经历为故事',memoryPolicy:'off',mode:'auto'},provider);
 assert.equal(listFragments(f.db,f.read(),'lin',id).length,0);const card=r.reply.actionCards![0];assert.equal(card.status,'pending');
 assert.throws(()=>decideAction(f.db,f.read,'dad',card.id,'confirm'),/未获授权/);
 const confirmation=decideAction(f.db,f.read,'lin',card.id,'confirm');decideAction(f.db,f.read,'lin',card.id,'confirm');
 assert.ok(confirmation.session.known.foundationTaskId,'确认业务写入后，会话应连接领域服务已经创建的同一Task');
 assert.ok(taskRuns(f.db,f.read(),'lin',confirmation.session.known.foundationTaskId).some(run=>run.sessionId===r.session.id),'原对话可从该Task恢复，不重建平行会话');
 const fragments=listFragments(f.db,f.read(),'lin',id);assert.equal(fragments.length,1);assert.equal(fragments[0].allowRecall,false);assert.equal(fragments[0].allowCloud,false);assert.equal(listFragments(f.db,f.read(),'dad').length,0);
});
test('确认计划进入同一Task且保留未知条件，纠正/遗忘后不借计划恢复旧个人Context',async t=>{
 const f=validationFixture('.runtime/integrated-plan-'+crypto.randomUUID());t.after(()=>f.db.close());const id=f.add('[合成]相机','其他','Canon','TEST');
 const task=createTask(f.db,f.read,'lin',{requestId:crypto.randomUUID(),goal:'[合成]给爸爸录做饭',intent:'plan',itemInstanceIds:[id]});
 const old=process.env.WUJIAN_AGENT_RUNTIME;process.env.WUJIAN_AGENT_RUNTIME='native';t.after(()=>{if(old===undefined)delete process.env.WUJIAN_AGENT_RUNTIME;else process.env.WUJIAN_AGENT_RUNTIME=old;});
 let n=0;const provider:Provider={ready:true,model:'offline-substitute',generate:async()=>{throw Error('no_reviewer');},converse:async()=>++n===1?{model:'offline-substitute',text:'',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'plan',type:'function',function:{name:'prepare_action',arguments:JSON.stringify({...plan([id]),steps:[{kind:'other',items:[id],text:'手持记录',conditions:['仅规划，不是已验证的设备动作']}],conditions:['镜头未知，先确认取景']})}}]}:{model:'offline-substitute',text:'先预览，未执行。',tokens:null,finishReason:'stop',toolCalls:[]}};
 const r=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),taskId:task.taskId,itemId:id,question:'为当前目标准备候选计划',mode:'auto',memoryPolicy:'off'},provider);
 decideAction(f.db,f.read,'lin',r.reply.actionCards![0].id,'confirm');
 const current=resolveTaskContext(f.db,f.read(),'lin',task.taskId);assert.equal(current.plans.length,1);assert.ok(current.plans[0].conditions?.includes('镜头未知，先确认取景'));assert.equal(current.plans[0].basis,'user_confirmed_plan_not_execution');
 clearOwnerContext(f.db,'lin',true,[id]);assert.equal(resolveTaskContext(f.db,f.read(),'lin',task.taskId).plans.length,0);assert.equal(f.read().plans?.length,1);
});
test('明确的多物品计划：已知不满足的资源被服务器拒绝，不向前端流出错误的自由指导',async t=>{
 const f=validationFixture('.runtime/integrated-bound-'+crypto.randomUUID());t.after(()=>f.db.close());
 const camera=f.add('[合成]相机','其他','Canon','TEST-CAMERA'),mount=f.add('[合成]手机稳定器','其他','DJI','TEST-MOUNT');
 for(const id of [camera,mount]){const i=f.read().items.find(i=>i.id===id)!;const page={url:id===camera?'https://www.canon.com.cn/test-camera':'https://www.dji.com/test-mount',title:i.model,text:i.model+'\n'+(id===mount?'Compatible Phone Weight 170-290 g':'Camera operations require its applicable manual.'),links:[]};storeOfficialDocument(f.db,'lin',i,makeKnowledgeDocument(page,i,[page.url]));}
 const goal='我的手机实测310克。只用已有物品安排拍摄。';const task=createTask(f.db,f.read,'lin',{requestId:crypto.randomUUID(),goal,intent:'plan',itemInstanceIds:[camera,mount]});
 const old=process.env.WUJIAN_AGENT_RUNTIME;process.env.WUJIAN_AGENT_RUNTIME='native';t.after(()=>{if(old===undefined)delete process.env.WUJIAN_AGENT_RUNTIME;else process.env.WUJIAN_AGENT_RUNTIME=old;});
 let n=0;const visible:string[]=[];
 const provider:Provider={ready:true,model:'offline-substitute',onText:s=>visible.push(s),generate:async()=>{throw Error('no_reviewer');},converse:async(_m,_t,o)=>{assert.equal(o.toolChoice,'auto','已知失败条件不等于每轮强制创建计划；资源拒绝仍由服务端执行');o.onText?.('错误自由草稿：尝试超重安装');return {model:'offline-substitute',text:'错误自由草稿：尝试超重安装',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'p'+(++n),type:'function',function:{name:'prepare_action',arguments:JSON.stringify({...plan([n===1?mount:camera]),steps:[{kind:'other',items:[camera],text:'只手持相机安排画面',conditions:['相机实物与取景待核对']}],conditions:['核对镜头与实物取景']})}}]};}};
 const r=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),taskId:task.taskId,itemId:camera,question:goal,mode:'auto',memoryPolicy:'off'},provider);
 assert.equal(n,2);assert.equal(r.reply.actionCards?.length,1);assert.ok(r.trace.some(t=>t.stage==='practical_tool_failed'));assert.ok(r.trace.some(t=>t.stage==='practical_bound_plan'));assert.ok(!visible.join('').includes('错误自由草稿'));assert.ok(!r.reply.answer.includes('错误自由草稿'));assert.match(r.reply.answer,/310/);
});
