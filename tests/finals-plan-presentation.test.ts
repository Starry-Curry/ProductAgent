import test from 'node:test';import assert from 'node:assert/strict';import {presentGuidance} from '../src/lib/agent/guidance.ts';import {planStepStatus} from '../src/lib/life/plan-presentation.ts';
test('未验证机制的前提与构想状态在动作之前出现，状态词不声称物理验证成功',()=>{
 const item={id:'x',name:'[合成]未知结构的盒','owner':'lin',model:'',category:'其他',state:'在用',availability:'available',attributes:{}} as any;
 const other={...item,id:'y',name:'[合成]独立承载物'};const r=presentGuidance({goal:'探索一个尚未确认的承托想法',itemIds:['x','y'],steps:[{kind:'support',items:['x'],target:'y',text:'ACTION-NOT-YET-ADVICE',conditions:['VERIFY-SUPPORT-FIRST']}],sourceIds:[],conditions:[]},'探索用途，不是立即执行',['x','y'],[],[],[item,other]);assert.equal(r.plan.dependencies[0].status,'concept');assert.ok(r.answer.indexOf('VERIFY-SUPPORT-FIRST')<r.answer.indexOf('ACTION-NOT-YET-ADVICE'));assert.ok(r.answer.indexOf('仅构想 · 暂不作为操作')<r.answer.indexOf('ACTION-NOT-YET-ADVICE'));
 assert.equal(planStepStatus('low_risk'),'低风险候选 · 未实测');assert.equal(planStepStatus(undefined),'旧步骤 · 待重新核对');
});
