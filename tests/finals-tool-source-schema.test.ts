import test from 'node:test';import assert from 'node:assert/strict';import {practicalTools,practicalToolSet} from '../src/lib/agent/practical.ts';
import {actionProposal,currentActionProposal} from '../src/lib/agent/practical-actions.ts';
function objects(value:unknown):any[]{if(!value||typeof value!=='object')return [];return [value,...Object.values(value).flatMap(objects)];}
test('最终呈现与保存预览使用同一官方原文ID契约，不暗示私人记忆/用户尺寸是操作证据',()=>{
 const before=JSON.stringify(practicalTools),tools=practicalToolSet(['actual-original'],['item-a']);
 for(const name of ['prepare_action','complete_answer']){
  const nodes=objects(tools.find(t=>t.function.name===name)!.function.parameters);
  const arrays=nodes.filter(n=>n.properties?.sourceIds).map(n=>n.properties.sourceIds);assert.ok(arrays.length);for(const s of arrays)assert.deepEqual(s.items.enum,['actual-original']);
  for(const p of nodes.filter(n=>n.properties?.sourceId).map(n=>n.properties.sourceId))assert.deepEqual(p.enum,['actual-original']);
  for(const p of nodes.filter(n=>n.properties?.operationRef).map(n=>n.properties.operationRef))assert.deepEqual(p.enum,['actual-original']);
 }
 assert.equal(JSON.stringify(practicalTools),before,'每轮收窄不污染全局Schema或下一会话');
});
test('未读原文时保留条件化想法，不广告必被服务器拒绝的型号操作；读取后可恢复',()=>{
 const tools=practicalToolSet([],['item-a']);for(const name of ['prepare_action','complete_answer']){
  const nodes=objects(tools.find(t=>t.function.name===name)!.function.parameters);assert.ok(!nodes.some(n=>n.properties?.kind?.const==='procedure'));assert.ok(!nodes.some(n=>n.properties?.kind?.enum?.includes('device_operation')));assert.ok(nodes.some(n=>n.properties?.kind?.enum?.includes('other')),'仍可提出未验证的探索想法');for(const n of nodes.filter(n=>n.properties?.sourceIds))assert.equal(n.properties.sourceIds.maxItems,0);
 }
 assert.ok(objects(practicalToolSet(['new-original'],['item-a']).find(t=>t.function.name==='complete_answer')!.function.parameters).some(n=>n.properties?.kind?.const==='procedure'));
});
test('新模型保存计划只提交逐步资源依赖，不继续广告旧纯文字步骤旁路',()=>{
 const tools=practicalToolSet([],['item-a']);const schema=tools.find(t=>t.function.name==='prepare_action')!.function.parameters as any;
 const plan=schema.oneOf.find((s:any)=>s.properties?.kind?.const==='plan');
 assert.equal(plan.properties.steps.items.type,'object');assert.ok(plan.properties.steps.items.required.includes('items'));
 assert.ok(!objects(plan.properties.steps.items).some(n=>n.description?.includes('兼容旧草稿')));
 const legacy={kind:'plan',goal:'历史探索草稿',itemIds:['item-a'],steps:['仅历史文字'],sourceIds:[],conditions:[]};assert.ok(actionProposal.safeParse(legacy).success);assert.ok(!currentActionProposal.safeParse(legacy).success,'历史读写兼容不成为新模型生成旁路');
});
