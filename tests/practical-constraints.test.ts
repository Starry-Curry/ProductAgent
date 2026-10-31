import test from 'node:test';import assert from 'node:assert/strict';
import {practicalConstraints,readKnownConstraints} from '../src/lib/agent/practical-constraints.ts';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {respond} from '../src/lib/agent/service.ts';
import {makeKnowledgeDocument,storeOfficialDocument} from '../src/lib/life/acquisition.ts';
import type {Provider} from '../src/lib/ai/provider.ts';
const fixture=(question='把相机装到手机云台上吗？我的手机实测310克、宽75毫米、厚8毫米。')=>({question,items:[],necessaryConditionChecks:[],evidence:[{id:'official:1',itemId:'mount',basis:'official',model:'FOREIGN-12',url:'https://www.dji.com/example',text:'Compatible Phone Weight 170-290 g\nCompatible Phone Width 67-84 mm\nCompatible Phone Thickness 6.9-10 mm'}]} as any);
test('陌生型号官方区间与用户报告绑定；310g真实比较失败且手机范围不扩展到相机',()=>{
 const checks=practicalConstraints(fixture());assert.equal(checks.length,3);assert.equal(checks[0].satisfied,false);assert.match(checks[0].detail,/超出 20 g/);assert.equal(checks[1].satisfied,true);assert.equal(checks[0].operands[1].sourceId,'official:1');assert.match(checks[0].scope,/不得据此确认相机/);assert.equal(checks[0].physicallyVerified,false);
});
test('单位换算、矛盾资料不静默选一条、用户数字不够则不伪造',()=>{
 const c=fixture('我的手机重量0.310kg，宽7.5cm，厚0.8cm。');const a=practicalConstraints(c);assert.equal(a[0].satisfied,false);assert.equal(a[1].satisfied,true);
 c.evidence.push({...c.evidence[0],id:'official:2',text:'Compatible Phone Weight 170-350 g'});assert.equal(practicalConstraints(c)[0].satisfied,null);
 assert.equal(practicalConstraints(fixture('相机重310g，可以装上吗？')).length,0);
});
test('没有官方依据的数字、其他工具返回文本不能升格成兼容条件；伪造条件ID被拒',()=>{
 const c=fixture();c.evidence[0].basis='user_report';assert.equal(practicalConstraints(c).length,0);assert.throws(()=>readKnownConstraints(practicalConstraints(fixture()),['some-other-user-condition']),/不属于/);
});
test('已有登记尺寸的必要条件进入原生执行器，不把外尺寸当净尺寸或稳定验证',()=>{
 const c=fixture('尺寸如何？');c.items=[{physicalFacts:[{id:'outer',value:[400,300,40]},{id:'inner',value:[300,200,50]}]}];c.necessaryConditionChecks=[{itemIds:['box','desk'],operandIds:['outer','inner'],result:{satisfied:false,notice:'未核对稳定'}}];const checks=practicalConstraints(c);assert.equal(checks[0].satisfied,false);assert.deepEqual(checks[0].operands[0].value,[400,300,40]);assert.match(checks[0].scope,/不证明稳定/);
});
test('真实执行器先提供带来源的必要条件；模型篡改区间仅得到假设结果，不能覆盖已知条件',async t=>{
 const f=validationFixture('.runtime/constraint-integrated-'+crypto.randomUUID());const id=f.add('[合成]陌生手机夹具','其他','DJI','FOREIGN-12');const item=f.read().items.find(i=>i.id===id)!;const d={url:'https://www.dji.com/foreign-12',title:'FOREIGN-12',text:'FOREIGN-12\nCompatible Phone Weight 170-290 g.',links:[]};storeOfficialDocument(f.db,'lin',item,makeKnowledgeDocument(d,item,[d.url]));
 const old=process.env.WUJIAN_AGENT_RUNTIME;process.env.WUJIAN_AGENT_RUNTIME='native';t.after(()=>{f.db.close();if(old===undefined)delete process.env.WUJIAN_AGENT_RUNTIME;else process.env.WUJIAN_AGENT_RUNTIME=old;});
 let calls=0;const p:Provider={ready:true,model:'offline-substitute',generate:async()=>{throw Error('not_used');},converse:async messages=>{
  if(++calls===1){const initial=JSON.parse(messages[1].content!);assert.equal(initial.necessaryConditionChecks[0].satisfied,false);return{text:'',model:'offline-substitute',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'spoof',type:'function',function:{name:'check_constraints',arguments:JSON.stringify({kind:'range',actual:310,min:100,max:999,unit:'g'})}}]};}
  const data=JSON.parse(messages.at(-1)!.content!);assert.equal(data.satisfied,true);assert.equal(data.inputVerification,'unverified_model_operands_hypothetical_only');assert.equal(data.necessaryConditionChecks[0].satisfied,false);return{text:'真实范围不满足，假设计算不能代替规格。',model:'offline-substitute',tokens:null,finishReason:'stop',toolCalls:[]};}};
 const r=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:'我的手机实测310克，能用吗？',memoryPolicy:'off',mode:'service'},p);assert.equal(r.reply.necessaryConditionChecks?.[0].satisfied,false);
});
test('普通“连接手机”不再自动纳入手机云台的官方资料',async t=>{
 const f=validationFixture('.runtime/native-entity-'+crypto.randomUUID()),speaker=f.add('[合成]音箱','其他','Sony','NEW-871'),gimbal=f.add('[合成]手机云台','其他','DJI','FOREIGN-12');const item=f.read().items.find(i=>i.id===gimbal)!;const d={url:'https://www.dji.com/foreign-12',title:'FOREIGN-12',text:'FOREIGN-12 phone clamp only.',links:[]};storeOfficialDocument(f.db,'lin',item,makeKnowledgeDocument(d,item,[d.url]));const old=process.env.WUJIAN_AGENT_RUNTIME;process.env.WUJIAN_AGENT_RUNTIME='native';t.after(()=>{f.db.close();if(old===undefined)delete process.env.WUJIAN_AGENT_RUNTIME;else process.env.WUJIAN_AGENT_RUNTIME=old;});
 const p:Provider={ready:true,model:'offline-substitute',generate:async()=>{throw Error('not_used');},converse:async m=>{const c=JSON.parse(m[1].content!);assert.equal(c.items.length,1);assert.equal(c.items[0].id,speaker);assert.equal(c.officialSources.length,0);assert.ok(c.catalogue.some((i:any)=>i.id===gimbal));return{text:'没有此音箱资料，不能猜操作。',model:'offline-substitute',tokens:null,finishReason:'stop',toolCalls:[]};}};
 const r=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:speaker,question:'连接手机怎么操作？',memoryPolicy:'off',mode:'service'},p);assert.equal(r.reply.citations.length,0);
});

test('长手册工具往返按实报前缀加增量预留，不被重复全字节估算吞掉最终回答',async t=>{
 const f=validationFixture('.runtime/constraint-long-'+crypto.randomUUID()),id=f.add('[合成]长手册设备','其他','Sony','LONG-12');const item=f.read().items.find(i=>i.id===id)!;
 const page={url:'https://helpguide.sony.net/long',title:'LONG-12',text:'LONG-12\n'+('配对操作与参数说明。 '.repeat(5000)),links:[]};storeOfficialDocument(f.db,'lin',item,makeKnowledgeDocument(page,item,[page.url]));const old=process.env.WUJIAN_AGENT_RUNTIME;process.env.WUJIAN_AGENT_RUNTIME='native';t.after(()=>{f.db.close();if(old===undefined)delete process.env.WUJIAN_AGENT_RUNTIME;else process.env.WUJIAN_AGENT_RUNTIME=old;});
 let calls=0;const p:Provider={ready:true,model:'offline-substitute',generate:async()=>{throw Error('not_used');},converse:async m=>{calls++;if(calls===1){assert.ok(Buffer.byteLength(JSON.stringify(m))>80000);return{text:'',model:'offline-substitute',tokens:{input:28000,output:30},finishReason:'tool_calls',toolCalls:[{id:'item',type:'function',function:{name:'get_item_context',arguments:JSON.stringify({itemIds:[id]})}}]};}return{text:'资料和工具结果均已读完。',model:'offline-substitute',tokens:{input:29000,output:30},finishReason:'stop',toolCalls:[]};}};
 const r=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:'读完已有资料，再核对设备身份。',memoryPolicy:'off',mode:'service'},p);assert.equal(calls,2);assert.equal(r.reply.outcome,'answered');assert.equal(r.trace.some(t=>t.stage==='practical_failed'),false);
});
