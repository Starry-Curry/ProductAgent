import test from 'node:test';import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {startGoal,confirmGoalOutcome} from '../examples/foundation/goal-feature.ts';
import {foundationMock} from '../examples/foundation/mock-provider.ts';
import {discoverCapabilities,readReality,resolveTaskContext,createTask} from '../src/lib/foundation/services.ts';
import {compileTaskContext} from '../src/lib/context/compiler.ts';
import {beginRun,bindRunReadResources,finishRun,getTask} from '../src/lib/foundation/tasks.ts';

test('独立专业功能使用同一服务、授权、Task和Outcome，无第二套Runtime或事实库',async t=>{
 const f=validationFixture('.runtime/team-example-'+crypto.randomUUID());t.after(()=>f.db.close());
 for(let n=0;n<19;n++)f.add('无关合成物品'+n,'其他','无品牌','待确认');
 const id=f.add('合成分格盒','其他','无品牌','待确认',{attributes:{capabilities:['分隔调色，便于收走'],physicalFacts:[]}});
 const goal='希望分隔调色，练习后便于收走';const found=discoverCapabilities(f.db,f.read(),'lin',{goal});assert.ok(found.resources.some(r=>r.id===id));assert.ok(found.resources.every(r=>r.capabilities.every(c=>!c.executable)));
 const all=discoverCapabilities(f.db,f.read(),'lin',{limit:5});assert.equal(all.resources.length,5);assert.equal(all.nextCursor,5);assert.equal(discoverCapabilities(f.db,f.read(),'lin',{cursor:5,limit:5}).resources.some(r=>all.resources.some(a=>a.id===r.id)),false);
 const requestId=crypto.randomUUID();const result=await startGoal(f.db,f.read,'lin',goal,foundationMock(),requestId);assert.equal(result.turn.reply.outcome,'answered');assert.match(result.turn.reply.answer,/离线协议示例/);assert.ok(result.turn.reply.usedItems?.some(i=>i.id===id));assert.ok(result.task.itemInstanceIds.includes(id),'goal-discovered item must follow the same Task');
 const replayed=await startGoal(f.db,f.read,'lin',goal,{...foundationMock(),converse:async()=>{throw Error('idempotent replay must not call model');}},requestId);assert.equal(replayed.task.revision,result.task.revision);
 const replay=createTask(f.db,f.read,'lin',{requestId,goal,intent:'explore',itemInstanceIds:[]});assert.equal(replay.taskId,result.task.taskId);assert.ok(replay.itemInstanceIds.includes(id));assert.throws(()=>createTask(f.db,f.read,'lin',{requestId,goal:'changed goal',intent:'explore',itemInstanceIds:[]}),/幂等/);
 const confirmation={requestId:crypto.randomUUID(),confirmed:true as const,notes:'[合成反馈]只完成阅读，未操作实物',reuse:true,allowCloud:false,goalStatus:'partial' as const};
 const outcome=confirmGoalOutcome(f.db,f.read,'lin',result,confirmation);assert.equal(confirmGoalOutcome(f.db,f.read,'lin',result,confirmation).outcomeId,outcome.outcomeId);assert.equal(outcome.basis,'user_report');assert.equal(outcome.allowCloud,false);
 const resolved=resolveTaskContext(f.db,f.read(),'lin',result.task.taskId);assert.ok(resolved.previousOutcomes.some(o=>o.outcomeId===outcome.outcomeId));
 const s=f.read();s.items.find(i=>i.id===id)!.owner='u_another_holder';f.write(s);assert.ok(!discoverCapabilities(f.db,f.read(),'lin',{goal}).resources.some(r=>r.id===id));assert.throws(()=>readReality(f.db,f.read(),'lin',id),/未获当前授权/);
});

test('未匹配不等于不存在；精简目录可发现互补资源，作用域只缩小既有权限',t=>{
 const f=validationFixture('.runtime/catalogue-boundary-'+crypto.randomUUID());t.after(()=>f.db.close());
 for(let n=0;n<15;n++)f.add('合成无关条目'+n,'其他','无品牌','待确认');
 const matched=f.add('合成分格盒','其他','无品牌','待确认',{attributes:{capabilities:['分隔调色']}});
 const tray=f.add('合成有围边托盘','其他','无品牌','待确认',{attributes:{capabilities:['整组端走']}});
 const session={id:'offline',actor:'lin',known:{memoryPolicy:'off'},tried:[],messages:[]} as any;
 const context=compileTaskContext(f.db,f.read(),'lin',session,'分隔调色');
 assert.ok(context.catalogue.some(i=>i.id===tray),'互补物品必须在目录可发现，不能只提供词法匹配项');assert.equal(context.discovery.catalogueComplete,true);
 const narrowed=discoverCapabilities(f.db,f.read(),'lin',{scopeItemIds:[matched]});assert.deepEqual(narrowed.resources.map(i=>i.id),[matched]);
 const s=f.read();s.items.find(i=>i.id===tray)!.owner='u_other';f.write(s);
 assert.ok(!discoverCapabilities(f.db,f.read(),'lin',{scopeItemIds:[tray]}).resources.length);
});

test('目标资源绑定不扩大共享任务；撤权或版本变化后不能完成旧运行',t=>{
 const f=validationFixture('.runtime/task-resource-boundary-'+crypto.randomUUID());t.after(()=>f.db.close());
 const first=f.add('合成资源甲','其他','无品牌','待确认'),extra=f.add('合成资源乙','其他','无品牌','待确认');
 const task=createTask(f.db,f.read,'lin',{requestId:crypto.randomUUID(),goal:'离线目标',intent:'explore',itemInstanceIds:[first]});
 const shared={...task,participantIds:['friend'],participantSummaries:{friend:'仅共享摘要'}};
 f.db.prepare('UPDATE foundation_tasks SET body=? WHERE id=?').run(JSON.stringify(shared),task.taskId);
 const run=beginRun(f.db,f.read,'lin',{requestId:crypto.randomUUID(),taskId:task.taskId,itemIds:[first],entryPoint:'test',executor:'offline',input:{question:'test'}});
 bindRunReadResources(f.db,f.read(),run,[extra]);finishRun(f.db,f.read,run,'waiting_user','offline-session');assert.deepEqual(getTask(f.db,f.read(),'lin',task.taskId).itemInstanceIds,[first]);
 const fresh=beginRun(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemIds:[extra],entryPoint:'test',executor:'offline',input:{question:'test'}});
 const state=f.read();state.items.find(i=>i.id===extra)!.owner='u_other';f.write(state);
 assert.throws(()=>finishRun(f.db,f.read,fresh,'waiting_user'),/授权已失效/);
 assert.throws(()=>bindRunReadResources(f.db,f.read(),fresh,[extra]),/授权已失效/);
});
