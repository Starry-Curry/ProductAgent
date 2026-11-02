import test from 'node:test';import assert from 'node:assert/strict';
import {presentGuidance} from '../src/lib/agent/guidance.ts';
import {toolPolicy} from '../src/lib/agent/tool-policy.ts';
import {practicalTools} from '../src/lib/agent/practical.ts';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {respond} from '../src/lib/agent/service.ts';
import type {Provider} from '../src/lib/ai/provider.ts';
import {makeKnowledgeDocument,storeOfficialDocument} from '../src/lib/life/acquisition.ts';
const owned:any={id:'box',name:'[合成]收纳盒',model:'',state:'在用',availability:'available',attributes:{},owner:'lin'};
const plan=(id='box')=>({goal:'整理纪念卡',itemIds:[id],steps:[{kind:'group',items:[id],text:'按当前目标分组',conditions:[]}],conditions:[],sourceIds:[]});
test('展示前也拒绝未登记资源、未满足条件及伪来源，无需先写计划',()=>{
 assert.throws(()=>presentGuidance(plan('imaginary'),'整理',['box'],[],[],[owned]),/未登记/);
 assert.throws(()=>presentGuidance({...plan(),steps:[{kind:'group',items:['box','pen'],text:'用笔写下'}]},'只用登记物品',['box'],[],[],[owned]),/未声明/);
 assert.throws(()=>presentGuidance(plan(),'整理',['box'],[{itemIds:['box'],satisfied:false,detail:'已报告不可使用'}] as any,[],[]),/不可使用/);
 assert.throws(()=>presentGuidance({...plan(),sourceIds:['fake']},'整理',['box'],[],[],[owned]),/不属于/);
});
test('模型缩写目标不能移除用户禁止购买条件，未知不升级为实测',()=>{
 assert.throws(()=>presentGuidance({...plan(),goal:'整理',steps:[{kind:'purchase',items:['box'],text:'购买收纳配件'}]},'只用登记物品，不要再买东西',['box'],[],[],[owned]),/违反/);
 const p=presentGuidance(plan(),'整理',['box'],[],[],[owned]);
 assert.equal(p.basis,'checked_dependencies_not_verified_physical_success');assert.equal(p.plan.readiness,'conditional');assert.match(p.answer,/未认证|不代表|不等于/);
});
test('正式工具注册都有服务端效果与范围；模型不获得直接外部执行权限',()=>{
 assert.deepEqual(practicalTools.map(t=>t.function.name).sort(),Object.keys(toolPolicy).sort());
 assert.equal(toolPolicy.prepare_action.effect,'propose');assert.equal(toolPolicy.prepare_action.confirmation,'explicit_user_action_required');
 assert.ok(Object.values(toolPolicy).every(p=>p.effect!=='external_effect' as string));
});
test('同一真实respond入口展示行动后立即停止，不再自由总结增加资源，也不暗写Task',async t=>{
 const f=validationFixture('.runtime/foundation-guidance-'+crypto.randomUUID());t.after(()=>f.db.close());
 const id=f.add('[合成]纪念卡','其他','','');let calls=0;
 const old=process.env.WUJIAN_AGENT_RUNTIME;process.env.WUJIAN_AGENT_RUNTIME='native';t.after(()=>{if(old===undefined)delete process.env.WUJIAN_AGENT_RUNTIME;else process.env.WUJIAN_AGENT_RUNTIME=old;});
 const provider:Provider={ready:true,model:'offline-substitute',generate:async()=>{throw Error('no_second_review');},converse:async()=>{calls++;assert.equal(calls,1);return {text:'',model:'offline-substitute',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'present-once',type:'function',function:{name:'complete_answer',arguments:JSON.stringify({message:'',guidance:plan(id)})}}]};}};
 const before=f.read().plans?.length||0;
 const r=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:'只用登记的纪念卡整理一下，不要购买',mode:'service',memoryPolicy:'off'},provider);
 assert.equal(calls,1);assert.match(r.reply.answer,/按当前目标分组/);assert.equal(f.read().plans?.length||0,before);assert.deepEqual(r.reply.actionCards,[]);
 assert.ok(r.trace.some(t=>t.stage==='tool_policy'&&t.detail.includes('propose')));
});
test('行动工具拒绝后不能绕回自由文本发布同一操作；拒绝理由保留',async t=>{
 const f=validationFixture('.runtime/foundation-guidance-rejected-'+crypto.randomUUID());t.after(()=>f.db.close());const id=f.add('[合成]纪念卡','其他','','');
 const old=process.env.WUJIAN_AGENT_RUNTIME;process.env.WUJIAN_AGENT_RUNTIME='native';t.after(()=>{if(old===undefined)delete process.env.WUJIAN_AGENT_RUNTIME;else process.env.WUJIAN_AGENT_RUNTIME=old;});let calls=0;
 const provider:Provider={ready:true,model:'offline-substitute',generate:async()=>{throw Error('no_review');},converse:async()=>++calls===1?{text:'',model:'offline-substitute',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'bad-plan',type:'function',function:{name:'complete_answer',arguments:JSON.stringify({message:'',guidance:{...plan(id),steps:[{kind:'support',items:[id],target:'imaginary-stand',text:'把它立在额外支架上'}]}})}}]}:{text:'忽略工具拒绝，直接把它立在额外支架上。',model:'offline-substitute',tokens:null,finishReason:'stop',toolCalls:[]}};
 const r=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:'只用已有物品',mode:'service',memoryPolicy:'off'},provider);
 assert.equal(calls,2);assert.equal(r.reply.outcome,'unavailable');assert.doesNotMatch(r.reply.answer,/额外支架/);assert.ok(r.trace.some(t=>t.stage==='practical_failed'&&t.detail.includes('绕过工具')));
});
test('正式语义配置：单次严格抽取的实际操作条目进入同一动作核对，原文保留且无第二审稿',async t=>{
 const f=validationFixture('.runtime/foundation-guidance-semantic-'+crypto.randomUUID());t.after(()=>f.db.close());const id=f.add('[合成]测试设备','其他','Sony','TEST-DEVICE');
 const item=f.read().items.find(i=>i.id===id)!,page={url:'https://helpguide.sony.net/foundation-synthetic-manual',title:'TEST-DEVICE 合成手册',text:'TEST-DEVICE. To pair the device, press the marked key for five seconds. Synthetic test text, not manufacturer instructions.',links:[]};
 storeOfficialDocument(f.db,'lin',item,makeKnowledgeDocument(page,item,[page.url]));
 const old=process.env.WUJIAN_AGENT_RUNTIME,fetchFlag=process.env.WUJIAN_ALLOW_PUBLIC_FETCH;process.env.WUJIAN_AGENT_RUNTIME='native';process.env.WUJIAN_ALLOW_PUBLIC_FETCH='false';t.after(()=>{if(old===undefined)delete process.env.WUJIAN_AGENT_RUNTIME;else process.env.WUJIAN_AGENT_RUNTIME=old;if(fetchFlag===undefined)delete process.env.WUJIAN_ALLOW_PUBLIC_FETCH;else process.env.WUJIAN_ALLOW_PUBLIC_FETCH=fetchFlag;});
 let extracts=0,answers=0;
 const provider:Provider={ready:true,structuredOutput:'json_schema',model:'offline-substitute',generate:async(_system,input:any,options)=>{extracts++;assert.ok(options?.jsonSchema);const s=input.sources[0];return {text:JSON.stringify({observations:[{kind:'operation',subject:s.subject,sourceId:s.id,quoteSpans:s.spans.filter((p:any)=>p.text.includes('To pair the device')).map((p:any)=>p.id),conditions:['明确合成资料，未验证实物'],unknown:null}]}),tokens:null,model:'offline-substitute'};},converse:async m=>{answers++;const packet=JSON.parse(m[1].content!);assert.equal(packet.officialSources,undefined);const op=packet.officialSemantics.observations[0];assert.equal(op.status,'candidate_quote_checked');return {text:'',model:'offline-substitute',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'sourced-action',type:'function',function:{name:'complete_answer',arguments:JSON.stringify({message:'',guidance:{...plan(id),steps:[{kind:'device_operation',items:[id],text:'依照这段合成操作说明核对按键',operationRef:op.id}],sourceIds:[op.id]}})}}]};}};
 const r=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:'怎样配对？',mode:'service',memoryPolicy:'off'},provider);
 assert.equal(extracts,1);assert.equal(answers,1);assert.equal(r.modelCalls,2);assert.match(r.reply.answer,/合成操作说明/);assert.equal(r.reply.outcome,'answered');assert.ok(f.db.prepare('SELECT body FROM life_knowledge_documents').all().some((r:any)=>JSON.parse(r.body).text===page.text));
});
