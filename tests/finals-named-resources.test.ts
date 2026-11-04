import test from 'node:test';import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {compileTaskContext} from '../src/lib/context/compiler.ts';
import {respond} from '../src/lib/agent/service.ts';
import type {Provider} from '../src/lib/ai/provider.ts';

test('对抗多物品：焦点画作不能吞掉明确提到的桌子尺寸；共同前缀不是相关性或权限',t=>{
 const f=validationFixture('.runtime/finals-named-'+crypto.randomUUID());t.after(()=>f.db.close());
 const painting=f.add('[合成]朋友赠送的原创画','其他','','',{attributes:{dimensions:'外框40×30厘米，背部支撑未知'}});
 const desk=f.add('[合成]靠墙的小书桌','其他','','',{attributes:{dimensions:'宽60厘米、深40厘米，承重未测'}});
 const other=f.add('[合成]另一人的小书桌','其他','','',{attributes:{dimensions:'PRIVATE-OTHER-DIMENSIONS'}});const state=f.read();state.items.find(i=>i.id===other)!.owner='dad';f.write(state);
 const session={id:'synthetic',itemId:painting,known:{memoryPolicy:'off'},messages:[],tried:[]} as any;
 const c=compileTaskContext(f.db,f.read(),'lin',session,'这幅画是谁送我的？我想把它和靠墙的小书桌一起重新布置。',false,[],[],18000);
 assert.ok(c.items.some(i=>i.id===desk),'资料压缩模式仍需读取明确提到的获准资源');
 assert.ok(c.semanticItems.find(i=>i.id===desk)?.facts.some(f=>f.predicate==='dimensions'&&String(f.value).includes('60')));
 assert.ok(!JSON.stringify(c).includes('PRIVATE-OTHER-DIMENSIONS'));
 const vague=compileTaskContext(f.db,f.read(),'lin',session,'[合成]聊聊这个物品。',false,[],[],18000);
 assert.deepEqual(vague.items.map(i=>i.id),[painting],'共同测试标签不能让所有物品私密细节都进入Context');
 const phoneGimbal=f.add('[合成]手机云台','电子','DJI','SYNTHETIC-GIMBAL');
 const phoneOnly=compileTaskContext(f.db,f.read(),'lin',session,'连接手机怎么操作？',false,[],[],18000);
 assert.ok(!phoneOnly.items.some(i=>i.id===phoneGimbal),'修饰语手机不能把整个手机云台当作明确实体引用');
});

test('候选首次引用目录资源时先读真实详情再定稿，不猜尺寸、不另起运行器',async t=>{
 const f=validationFixture('.runtime/finals-late-context-'+crypto.randomUUID());t.after(()=>f.db.close());
 const painting=f.add('合成画作','其他','','',{attributes:{dimensions:'40×30厘米'}}),desk=f.add('合成书桌','其他','','',{attributes:{dimensions:'60×40厘米'}});
 const prior=process.env.WUJIAN_AGENT_RUNTIME;process.env.WUJIAN_AGENT_RUNTIME='native';t.after(()=>{if(prior===undefined)delete process.env.WUJIAN_AGENT_RUNTIME;else process.env.WUJIAN_AGENT_RUNTIME=prior;});
 let calls=0;const provider:Provider={ready:true,structuredOutput:'json_schema',model:'offline-context-protocol',generate:async()=>{throw Error('no_second_reviewer');},converse:async messages=>{
  calls++;if(calls===1){const packet=JSON.parse(messages.find(m=>m.role==='user')!.content!);assert.ok(!packet.items.some((i:any)=>i.id===desk));assert.equal(packet.catalogue.find((i:any)=>i.id===desk).details,'available_via_get_item_context');assert.equal(packet.catalogue.find((i:any)=>i.id===desk).itemRead,'already_authorized');}
  else{const tool=JSON.parse(messages.findLast(m=>m.role==='tool')!.content!);assert.equal(tool.status,'authorized_resource_details_loaded_retry_final');assert.ok(tool.items.find((i:any)=>i.id===desk).facts.some((f:any)=>String(f.value).includes('60')));}
  return {model:'offline-context-protocol',text:'',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'candidate-'+calls,type:'function',function:{name:'complete_answer',arguments:JSON.stringify({message:'尺寸已知，支撑仍未知。',guidance:{goal:'探索摆放',itemIds:calls===1?[painting]:[painting,desk],steps:[{kind:'group',items:[painting,desk],text:'把画与桌作为同一摆放候选，保留支撑条件待核对',conditions:['支撑尚未验证']}],sourceIds:[],conditions:['仅为探索方向']}})}}]};
 }};
 const result=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:painting,question:'请探索这幅画的摆放可能',mode:'auto',memoryPolicy:'off'},provider);
 assert.equal(calls,2);assert.equal(result.reply.outcome,'answered');assert.ok(result.reply.usedItems?.some(i=>i.id===desk));assert.ok(result.trace.some(t=>t.stage==='practical_final_context_expanded'));assert.equal((f.read().plans||[]).length,0,'读取新资源不暗写业务计划');
});
