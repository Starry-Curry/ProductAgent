import test from 'node:test';import assert from 'node:assert/strict';import {practicalToolSet,practicalTools} from '../src/lib/agent/practical.ts';
test('行动工具Schema只列已读取资料和获准资源ID；无资料时不得伪造引用，不修改全局Schema',()=>{
 const plan=(tools:any[])=>tools.find(t=>t.function.name==='prepare_action').function.parameters.oneOf.find((s:any)=>s.properties.kind.const==='plan');
 const a=plan(practicalToolSet([],['real-item']));assert.equal(a.properties.sourceIds.maxItems,0);assert.deepEqual(a.properties.itemIds.items.enum,['real-item']);assert.deepEqual(a.properties.steps.items.anyOf[0].properties.target.enum,['real-item']);
 const b=plan(practicalToolSet(['real-passage'],['another-item']));assert.deepEqual(b.properties.sourceIds.items.enum,['real-passage']);assert.equal(plan(practicalTools).properties.sourceIds.maxItems,8);assert.equal(plan(practicalTools).properties.itemIds.items.enum,undefined);
});
