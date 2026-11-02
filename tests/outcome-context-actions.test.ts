import test from 'node:test';import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';import {createTask} from '../src/lib/foundation/tasks.ts';import {compileTaskContext} from '../src/lib/context/compiler.ts';import {checkPlanResources} from '../src/lib/agent/practical-actions.ts';import {respond} from '../src/lib/agent/service.ts';import type {Provider} from '../src/lib/ai/provider.ts';import {decideAction} from '../src/lib/home/store.ts';
test('任务目录可发现外部获准资源，未选择前不加载其私密详情；跨账号不可见',t=>{
 const f=validationFixture('.runtime/outcome-scope-'+crypto.randomUUID());t.after(()=>f.db.close());const a=f.add('合成旧篮','其他','','待确认'),b=f.add('合成毛线','其他','','待确认');const s=f.read();s.items.find(i=>i.id===b)!.note='不该自动发送的私人备注';f.write(s);
 const task=createTask(f.db,f.read,'lin',{requestId:crypto.randomUUID(),goal:'从旧篮出发帮助编织',intent:'explore',itemInstanceIds:[a]});const session:any={itemId:a,known:{foundationTaskId:task.taskId,memoryPolicy:'off'},messages:[],tried:[]};
 const c=compileTaskContext(f.db,f.read(),'lin',session,task.goal,false,[],[],18000);assert.ok(c.authorizedItemIds.includes(b));assert.ok(!c.items.some(i=>i.id===b));assert.ok(!JSON.stringify(c).includes('不该自动发送'));
 const selected=compileTaskContext(f.db,f.read(),'lin',session,task.goal,false,[],[b],18000);assert.ok(selected.items.some(i=>i.id===b));assert.ok(!JSON.stringify(selected).includes('不该自动发送'));
 const denied=compileTaskContext(f.db,f.read(),'dad',{known:{memoryPolicy:'off'},messages:[],tried:[]} as any,'编织',false,[],[],18000);assert.ok(!denied.catalogue.some(i=>i.id===b));
});
test('动作依赖不仅检查计划ID：缺失支撑/隐含资源、伪装作用和禁止动作被拒；未知只作条件',()=>{
 const plan={kind:'plan',goal:'不购买、不粘贴，用已有物品整理桌面',itemIds:['a'],sourceIds:[],conditions:[],steps:[{kind:'support',items:['a'],target:'ghost',text:'用不存在的支架承托'}]};
 assert.throws(()=>checkPlanResources(plan,['a'],[],[]),/步骤依赖/);
 const ambiguous=checkPlanResources({...plan,steps:[{kind:'assign_role',items:['a'],text:'夹住桌边'}]},['a'],[],[],[{id:'a',name:'合成物品',model:'待确认',state:'在用',owner:'lin',attributes:{}} as any]);assert.equal(ambiguous.readiness,'conditional');assert.ok(ambiguous.unresolved.some(c=>c.includes('未认证')));
 assert.throws(()=>checkPlanResources({...plan,steps:[{kind:'adhere',items:['a'],text:'粘贴固定'}]},['a'],[],[],[{id:'a',name:'合成物品',model:'待确认',state:'在用',availability:'available',owner:'lin',attributes:{}} as any]),/限制|禁止/);
 const conditional=checkPlanResources({...plan,steps:['尚未逐步核对的想法']},['a'],[],[]);assert.equal(conditional.readiness,'conditional');assert.ok(conditional.unresolved.some(c=>c.includes('仅供探索')));
});
test('未完成的自由操作草稿不流出；计划确认前物品条件更改应拒绝旧快照',async t=>{
 const f=validationFixture('.runtime/outcome-publication-'+crypto.randomUUID());t.after(()=>f.db.close());const id=f.add('合成物品','其他','','待确认');const before=process.env.WUJIAN_AGENT_RUNTIME;process.env.WUJIAN_AGENT_RUNTIME='native';t.after(()=>{if(before===undefined)delete process.env.WUJIAN_AGENT_RUNTIME;else process.env.WUJIAN_AGENT_RUNTIME=before;});
 const published:string[]=[];let n=0;const provider:Provider={ready:true,model:'offline-substitute',onText:s=>published.push(s),generate:async()=>{throw Error('no_reviewer');},converse:async(_m,_t,o)=>{o.onText?.('不完整且尚未检查的草稿');if(++n===1)return {text:'',model:'offline-substitute',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'p',type:'function',function:{name:'prepare_action',arguments:JSON.stringify({kind:'plan',goal:'合成整理',itemIds:[id],steps:['仅探索待确认'],sourceIds:[],conditions:[]})}}]};return {text:'请核对候选后确认，尚未执行。',model:'offline-substitute',tokens:null,finishReason:'stop',toolCalls:[]};}};
 const r=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:'准备可保存的候选计划',mode:'auto',memoryPolicy:'off'},provider);assert.ok(!published.join('').includes('不完整'));assert.equal(r.reply.actionCards?.length,1,JSON.stringify(r.trace));
 const s=f.read();s.items.find(i=>i.id===id)!.attributes={material:'更正后的材料'};f.write(s);assert.throws(()=>decideAction(f.db,f.read,'lin',r.reply.actionCards![0].id,'confirm'),/条件已变化/);assert.equal(f.read().plans?.length||0,0);
});
