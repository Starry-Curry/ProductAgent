import test from 'node:test';import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {startGoal,confirmGoalOutcome} from '../examples/foundation/goal-feature.ts';
import {foundationMock} from '../examples/foundation/mock-provider.ts';
import {discoverCapabilities,readReality,resolveTaskContext} from '../src/lib/foundation/services.ts';

test('独立专业功能使用同一服务、授权、Task和Outcome，无第二套Runtime或事实库',async t=>{
 const f=validationFixture('.runtime/team-example-'+crypto.randomUUID());t.after(()=>f.db.close());
 for(let n=0;n<19;n++)f.add('无关合成物品'+n,'其他','无品牌','待确认');
 const id=f.add('合成分格盒','其他','无品牌','待确认',{attributes:{capabilities:['分隔调色，便于收走'],physicalFacts:[]}});
 const goal='希望分隔调色，练习后便于收走';const found=discoverCapabilities(f.db,f.read(),'lin',{goal});assert.ok(found.resources.some(r=>r.id===id));assert.ok(found.resources.every(r=>r.capabilities.every(c=>!c.executable)));
 const all=discoverCapabilities(f.db,f.read(),'lin',{limit:5});assert.equal(all.resources.length,5);assert.equal(all.nextCursor,5);assert.equal(discoverCapabilities(f.db,f.read(),'lin',{cursor:5,limit:5}).resources.some(r=>all.resources.some(a=>a.id===r.id)),false);
 const result=await startGoal(f.db,f.read,'lin',goal,foundationMock());assert.equal(result.turn.reply.outcome,'answered');assert.match(result.turn.reply.answer,/离线协议示例/);assert.ok(result.turn.reply.usedItems?.some(i=>i.id===id));assert.ok(result.task.itemInstanceIds.includes(id),'goal-discovered item must follow the same Task');
 const outcome=confirmGoalOutcome(f.db,f.read,'lin',result,{confirmed:true,notes:'[合成反馈]只完成阅读，未操作实物',reuse:true,allowCloud:false,goalStatus:'partial'});assert.equal(outcome.basis,'user_report');assert.equal(outcome.allowCloud,false);
 const resolved=resolveTaskContext(f.db,f.read(),'lin',result.task.taskId);assert.ok(resolved.previousOutcomes.some(o=>o.outcomeId===outcome.outcomeId));
 const s=f.read();s.items.find(i=>i.id===id)!.owner='u_another_holder';f.write(s);assert.ok(!discoverCapabilities(f.db,f.read(),'lin',{goal}).resources.some(r=>r.id===id));assert.throws(()=>readReality(f.db,f.read(),'lin',id),/未获当前授权/);
});
