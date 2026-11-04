import test from 'node:test';import assert from 'node:assert/strict';import {practicalToolSet,practicalTools} from '../src/lib/agent/practical.ts';
const objects=(v:any):any[]=>!v||typeof v!=='object'?[]:[v,...Object.values(v).flatMap(objects)];
test('最终指导与计划保存使用同一当前可行动资源范围，阅读权限不被误删，未知条件不冒充通过',()=>{
 const original=JSON.stringify(practicalTools),tools=practicalToolSet(['source'],['eligible']);
 for(const name of ['complete_answer','prepare_action'])for(const n of objects(tools.find(t=>t.function.name===name)!.function.parameters)){
  const p=n.properties;if(!p)continue;
  if(p.itemIds)assert.deepEqual(p.itemIds.items.enum,['eligible']);
  if(p.kind?.const==='procedure')assert.deepEqual(p.itemId.enum,['eligible']);
  if(p.items)assert.deepEqual(p.items.items.enum,['eligible']);
  if(p.target)assert.deepEqual(p.target.enum,['eligible']);
 }
 assert.ok(tools.some(t=>t.function.name==='get_item_context'),'不能执行某种使用并不等于无权读取资料');assert.equal(JSON.stringify(practicalTools),original);
 const none=practicalToolSet(['source'],[]);assert.ok(none.some(t=>t.function.name==='complete_answer'));const final=none.find(t=>t.function.name==='complete_answer')!.function.parameters;assert.ok(!objects(final).some(n=>n.properties?.kind?.const==='procedure'),'无可行动资源时不宣传必败型号操作');assert.ok(!objects(final).some(n=>n.properties?.steps),'无行动资源仍可说明已知事实与缺口');
});
