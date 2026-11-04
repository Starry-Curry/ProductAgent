import test from 'node:test';import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';import {installVirtualHome,setVirtualHomeCloud,virtualHomeItems} from '../src/lib/life/virtual-home.ts';
import {planDiscovery} from '../src/lib/life/planning.ts';import {executePractical} from '../src/lib/agent/practical.ts';import {compileTaskContext} from '../src/lib/context/compiler.ts';
import type {Provider} from '../src/lib/ai/provider.ts';import type {ServiceSession} from '../src/lib/agent/contracts.ts';
import {identity} from '../src/lib/ai/harness.ts';import {epoch} from '../src/lib/memory/store.ts';
const fixture=(t:any)=>{const f=validationFixture('.runtime/finals-home-consent-'+crypto.randomUUID());t.after(()=>f.db.close());installVirtualHome(f.db,f.read,'lin',false);return f;};
const session=(itemId?:string):ServiceSession=>({id:'offline-adversarial',owner:'lin',itemId,mode:'auto',revision:0,status:'active',messages:[],known:{memoryPolicy:'off'},tried:[],memoryEpoch:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()});
test('省略homeId不能绕过模拟家庭云端许可，自动发现也不能把未授权家庭发给模型',async t=>{
 const f=fixture(t);let calls=0;const packets:string[]=[];const provider={ready:true,model:'offline-substitute',generate:async(_system:string,data:unknown)=>{calls++;packets.push(JSON.stringify(data));return {text:'## 展示\n用现有物品探索有条件的新作用。',model:'offline-substitute',tokens:{input:1,output:1}};}} as unknown as Provider;
 const ids=virtualHomeItems(f.read(),'lin').map(i=>i.id);
 await planDiscovery(f.db,f.read(),'lin',{goal:'从已有物品找一个新用途',itemIds:[ids[0]],model:true,includeSynthetic:true},provider,f.read).catch(()=>{});
 assert.equal(calls,0,'明确选择的家庭物品在未许可时必须先拒绝，不能依赖前端homeId');
 await planDiscovery(f.db,f.read(),'lin',{goal:'从已有物品找一个新用途',model:true,includeSynthetic:true},provider,f.read).catch(()=>{});
 assert.ok(!ids.some(id=>packets.some(p=>p.includes(id))),'无明确选择时不能把未授权家庭放进模型资源池；原空间可独立使用');
 const c=compileTaskContext(f.db,f.read(),'lin',session(),'我有什么物品？');assert.ok(!c.catalogue.some(i=>ids.includes(i.id)));
 const own=f.add('[合成]原空间的木托盘','其他','','',{attributes:{material:'木材（用户报告）',capabilities:['承放轻物']}});let sent='';
 const ownProvider={...provider,generate:async(_system:string,data:unknown)=>{calls++;sent=JSON.stringify(data);return {text:'## 有条件的新用途\n用原空间木托盘归集手边物品，表面与放置条件需用户核对。',model:'offline-substitute',tokens:{input:1,output:1}};}} as unknown as Provider;
 const prior=calls;await planDiscovery(f.db,f.read(),'lin',{goal:'从原有木托盘找一个新用途',model:true,includeSynthetic:true},ownProvider,f.read);assert.equal(calls,prior+1);assert.ok(sent.includes(own));assert.ok(!ids.some(id=>sent.includes(id)),'撤回模拟家庭不阻断原空间，也不把家庭资料混进去');
});
test('普通物品入口省略homeId仍在调用前拒绝撤权家庭；新授权可用，在途撤回不保存候选',async t=>{
 const f=fixture(t),ids=virtualHomeItems(f.read(),'lin').map(i=>i.id);let calls=0;
 const provider={ready:true,model:'offline-substitute',converse:async()=>{calls++;return {text:'',model:'offline-substitute',finishReason:'tool_calls',toolCalls:[{id:'final',type:'function',function:{name:'complete_answer',arguments:JSON.stringify({message:'仅协议替身。',guidance:null})}}],tokens:{input:1,output:1}};}} as unknown as Provider;
 const currentSession={...session(ids[0]),memoryEpoch:epoch(f.db,'lin'),identity:JSON.stringify(['lin',identity(f.read().items.find(i=>i.id===ids[0])!)])};
 await assert.rejects(executePractical(f.db,f.read,'lin',currentSession,'这件物品是什么？',provider,true),/授权.*模拟家庭|模拟家庭.*授权|许可/);assert.equal(calls,0);
 setVirtualHomeCloud(f.db,f.read,'lin',true);assert.ok(compileTaskContext(f.db,f.read(),'lin',session(ids[0]),'这件物品是什么？').catalogue.some(i=>i.id===ids[0]));
 let generated=0;const revoke={ready:true,model:'offline-substitute',generate:async()=>{generated++;setVirtualHomeCloud(f.db,f.read,'lin',false);return {text:'## 展示\n仅协议替身，不能保存撤权后的候选。',model:'offline-substitute',tokens:{input:1,output:1}};}} as unknown as Provider;
 await assert.rejects(planDiscovery(f.db,f.read(),'lin',{goal:'从已有物品找一个新用途',itemIds:[ids[0]],model:true,includeSynthetic:true},revoke,f.read),/授权.*模拟家庭|模拟家庭.*授权|许可/);assert.equal(generated,1);assert.equal((f.db.prepare('SELECT count(*) AS n FROM life_ideas').get() as any).n,0);
});
