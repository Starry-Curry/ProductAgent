import test from 'node:test';import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {saveMemory} from '../src/lib/memory/store.ts';import {respond} from '../src/lib/agent/service.ts';import type {Provider} from '../src/lib/ai/provider.ts';
test('按需载入物品时同一工具交付当前明确获准的关系Context，off不透露记录或可用性',async t=>{
 const f=validationFixture('.runtime/finals-item-memory-discovery-'+crypto.randomUUID());t.after(()=>f.db.close());
 const id=f.add('[合成]独立测试画作','画作','',''),m=saveMemory(f.db,f.read,'lin',{kind:'relationship',itemId:id,text:'SYNTHETIC-RELATION 朋友小海送给我',status:'active',allowCloud:true});
 const old=process.env.WUJIAN_AGENT_RUNTIME,net=process.env.WUJIAN_ALLOW_PUBLIC_FETCH;process.env.WUJIAN_AGENT_RUNTIME='native';process.env.WUJIAN_ALLOW_PUBLIC_FETCH='false';t.after(()=>{if(old===undefined)delete process.env.WUJIAN_AGENT_RUNTIME;else process.env.WUJIAN_AGENT_RUNTIME=old;if(net===undefined)delete process.env.WUJIAN_ALLOW_PUBLIC_FETCH;else process.env.WUJIAN_ALLOW_PUBLIC_FETCH=net;});
 for(const policy of ['read','off'] as const){let n=0;const results:any[]=[];const p:Provider={ready:true,model:'offline-protocol',generate:async()=>{throw Error('no_reviewer');},converse:async messages=>{
   if(n++)results.push(JSON.parse(messages.at(-1)!.content!));
   const name=n===1?'get_item_context':n===2?'get_relevant_experiences':undefined;
   return name?{text:'',model:'offline-protocol',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'read-'+n,type:'function',function:{name,arguments:JSON.stringify({itemIds:[id]})}}]}:{text:'按获准内容解释，未验证现实经历。',model:'offline-protocol',tokens:null,finishReason:'stop',toolCalls:[]};
  }};
  await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),question:'请读这一件，再解释已有记录与未知情况',mode:'auto',memoryPolicy:policy,uiContext:{page:'assistant',useItemMemories:true}},p);
  assert.equal(JSON.stringify(results[0]).includes(m.text),policy==='read','按需读到物品时，不吞掉已经明确授权给本轮的相关记忆');
  assert.equal(results[0].privateFacts.some((r:any)=>r.itemId===id&&r.id===m.id),policy==='read');
  assert.equal(JSON.stringify(results[1]).includes(m.text),policy==='read');
 }
});
