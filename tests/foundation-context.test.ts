import test from 'node:test';
import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {migrateUnified} from '../src/lib/foundation/schema.ts';
import {respond} from '../src/lib/agent/service.ts';
import {itemAffordances} from '../src/lib/life/planning.ts';
import type {Provider} from '../src/lib/ai/provider.ts';

test('Gate0：默认展开相关物品而非目录前八件；无关私人内容不入工具',async t=>{
 const f=validationFixture('.runtime/foundation-selection-'+crypto.randomUUID());t.after(()=>f.db.close());migrateUnified(f.db);
 for(let n=0;n<11;n++)f.add('无关测试物'+n,'其他','','待确认',{note:'不得发送的私密备注'});
 const id=f.add('特别圆盘','其他','','待确认',{attributes:{material:'本人报告木质'}});
 const previous=process.env.WUJIAN_AGENT_RUNTIME;process.env.WUJIAN_AGENT_RUNTIME='native';t.after(()=>{if(previous===undefined)delete process.env.WUJIAN_AGENT_RUNTIME;else process.env.WUJIAN_AGENT_RUNTIME=previous;});
 let calls=0,toolData:any;
 const provider:Provider={ready:true,model:'offline-fixture-not-qwen',generate:async()=>{throw Error('no_model_call');},converse:async(messages)=>{
  if(++calls===1)return {text:'',model:'offline-fixture-not-qwen',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'read',type:'function',function:{name:'get_item_context',arguments:'{"itemIds":[]}'}}]};
  toolData=JSON.parse(messages.findLast(m=>m.role==='tool')!.content!);
  return {text:'只根据当前圆盘的已登记信息讨论。',model:'offline-fixture-not-qwen',tokens:null,finishReason:'stop',toolCalls:[]};
 }};
 await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:'特别圆盘可以怎样利用？',mode:'auto',memoryPolicy:'off',temporary:true},provider);
 assert.deepEqual(toolData.items.map((i:any)=>i.id),[id]);
 assert.ok(!JSON.stringify(toolData).includes('不得发送'));
});

test('Gate0：物品名称不是已证实能力，不把纸灯笼关键词自动变为照明能力',()=>{
 const item:any={id:crypto.randomUUID(),name:'纸灯笼造型纪念摆件',category:'纪念物',model:'待确认',brand:'',owner:'lin',state:'闲置',availability:'available',attributes:{capabilities:[]}};
 const projected=itemAffordances(item);
 assert.deepEqual(projected.capabilities,[]);
 assert.deepEqual(projected.inferredCapabilities,[]);
});
