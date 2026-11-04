import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {runToolAgent} from '../src/lib/agent/tool-runtime.ts';
import {AgentError} from '../src/lib/agent/contracts.ts';
import type {ModelMessage,ModelResponse} from '../src/lib/ai/provider.ts';

// Explicit model substitutes: these tests prove framework/protocol/lifecycle
// behavior, not Qwen reasoning, product quality or real device operations.
const result=(text='',name?:string,id='call-1',reasoning?:string):ModelResponse=>({text,model:'offline-model-substitute',tokens:{input:10,output:5},toolCalls:name?[{id,type:'function',function:{name,arguments:'{"itemId":"owned"}'}}]:[],finishReason:name?'tool_calls':'stop',...(reasoning?{reasoning}:{})});
const setup=()=>({system:'合成业务测试',messages:[{role:'user' as const,content:'当前问题及获准语义卡'}],guard:()=>{},onEvent:(_type:string,_detail:string)=>{}});
const schema=z.object({itemId:z.literal('owned')}).strict();

test('真实AgentScope循环将工具结果交给下一模型回合并保留未知项',async()=>{
 let calls=0,reads=0;const observed:ModelMessage[][]=[],events:string[]=[];
 const output=await runToolAgent({...setup(),tools:[{name:'read_knowledge',description:'合成资料',schema,execute:async()=>{reads++;return {material:null,supplies:'empty',basis:'synthetic_user_report'};}}],onEvent:(type,detail)=>events.push(type+detail),generate:async messages=>{observed.push(structuredClone(messages));calls++;if(calls===1)return result('','read_knowledge');assert(messages.some(m=>m.role==='tool'&&m.content?.includes('"material":null')));return result('耗材用完；材质仍未知。');}});
 assert.deepEqual(output,{text:'耗材用完；材质仍未知。',finish:'completed'});assert.equal(calls,2);assert.equal(reads,1);
 assert(events.some(e=>e.startsWith('TOOL_RESULT_END')&&e.includes('read_knowledge')&&e.includes('success')));assert.equal(observed[1].filter(m=>m.role==='system').length,1);
});
test('普通工具失败交框架error_result，下一次读取可恢复',async()=>{
 let calls=0,reads=0;
 const output=await runToolAgent({...setup(),tools:[{name:'read_knowledge',description:'可恢复的资料读取',schema,execute:async()=>{if(++reads===1)throw Error('temporary_source_unavailable');return {status:'available'};}}],generate:async messages=>{calls++;if(calls===1)return result('','read_knowledge','call-1');if(calls===2){assert(messages.some(m=>m.role==='tool'&&m.content?.includes('temporary_source_unavailable')));return result('','read_knowledge','call-2');}assert(messages.some(m=>m.role==='tool'&&m.content?.includes('available')));return result('读取恢复；保留未知。');}});
 assert.equal(output.finish,'completed');assert.equal(reads,2);assert.equal(calls,3);
});
test('嵌套严格Schema的错误保留字段与路径，让模型能修正而不是重复object Object',async()=>{
 let calls=0,executions=0;const detail=z.object({guidance:z.object({sourceId:z.string()}).strict()}).strict();
 const output=await runToolAgent({...setup(),tools:[{name:'complete_answer',description:'严格字段协议替身',schema:detail,execute:async()=>{executions++;return {accepted:true};}}],generate:async messages=>{
  calls++;if(calls===2){const error=messages.find(m=>m.role==='tool')?.content||'';assert.match(error,/sourceIds/,'错误必须告诉主模型哪个额外字段不被接受');assert.ok(!error.includes('[object Object]'));}
  if(calls<3){const r=result('','complete_answer','schema-'+calls);r.toolCalls[0].function.arguments=JSON.stringify({guidance:{sourceId:'original',...(calls===1?{sourceIds:['extra-not-in-contract']}: {})}});return r;}
  return result('协议修正后完成；不是智能质量或事实验证。');
 }});assert.equal(output.finish,'completed');assert.equal(calls,3);assert.equal(executions,1,'无效工具参数不得执行业务');
});
test('Union根也用原Schema重建错误说明，不接受额外字段或增加业务写入',async()=>{
 const union=z.discriminatedUnion('kind',[z.object({kind:z.literal('plan'),itemId:z.literal('owned')}).strict(),z.object({kind:z.literal('story'),text:z.string()}).strict()]);let calls=0,writes=0;
 await runToolAgent({...setup(),tools:[{name:'prepare_action',description:'联合协议替身',schema:union,execute:async()=>{writes++;return {pending:true};}}],generate:async messages=>{calls++;if(calls===2){const error=messages.find(m=>m.role==='tool')?.content||'';assert.match(error,/unexpectedField/);assert.ok(!error.includes('[object Object]'));}if(calls<3){const r=result('','prepare_action','union-'+calls);r.toolCalls[0].function.arguments=JSON.stringify({kind:'plan',itemId:'owned',...(calls===1?{unexpectedField:'never_executed'}:{})});return r;}return result('参数修正后只准备一次草稿。');}});
 assert.equal(calls,3);assert.equal(writes,1);
});
test('Provider硬请求预算不能被AS额外总结吞掉或标为成功',async()=>{
 let attempts=0,requests=0;
 await assert.rejects(runToolAgent({...setup(),tools:[{name:'read_knowledge',description:'读取',schema,execute:async()=>({ok:true})}],generate:async()=>{attempts++;if(requests===6)throw new AgentError('request_budget_exhausted',429);requests++;return result('','read_knowledge','call-'+requests);}}),/request_budget_exhausted/);
 assert.equal(requests,6);assert.equal(attempts,7,'maxIters=6之后框架总结尝试仍必须通过Provider硬门禁');
});
test('工具403/409是fatal，不能被Toolkit包装后继续模型请求或执行其他工具',async()=>{
 for(const status of [403,409]){let calls=0,otherWrites=0;
  await assert.rejects(runToolAgent({...setup(),tools:[{name:'read_knowledge',description:'权限读取',schema,execute:async()=>{throw new AgentError('permission_changed',status);}},{name:'other_write',description:'不应执行',schema,execute:async()=>{otherWrites++;return {};}}],generate:async()=>{calls++;return {...result('','read_knowledge'),toolCalls:[...result('','read_knowledge').toolCalls,...result('','other_write','call-2').toolCalls]};}}),(e:any)=>e instanceof AgentError&&e.status===status);
  assert.equal(calls,1);assert.equal(otherWrites,0);
 }
});
test('每个模型与工具之后重查权限，迟到结果不进入下一回合',async()=>{
 for(const stage of ['after-model','after-tool']){let revoked=false,calls=0,reads=0;
  await assert.rejects(runToolAgent({...setup(),guard:()=>{if(revoked)throw new AgentError('revoked',409);},tools:[{name:'read_knowledge',description:'读取',schema,execute:async()=>{reads++;if(stage==='after-tool')revoked=true;return {private:'not_to_be_sent'};}}],generate:async()=>{calls++;if(stage==='after-model')revoked=true;return result('','read_knowledge');}}),/revoked/);
  assert.equal(calls,1);assert.equal(reads,stage==='after-model'?0:1);
 }
});
test('成功工具形成确认卡后停止，不追加总结或第二项写入',async()=>{
 let calls=0,drafts=0,otherWrites=0;
 const output=await runToolAgent({...setup(),tools:[{name:'prepare_action',description:'只创建待确认草稿',schema,execute:async()=>{drafts++;return {pending:true};}},{name:'other_write',description:'不应执行',schema,execute:async()=>{otherWrites++;return {};}}],stopAfterTool:()=>drafts>0,generate:async()=>{calls++;return {...result('未检查的模型草稿','prepare_action'),toolCalls:[...result('','prepare_action').toolCalls,...result('','other_write','call-2').toolCalls]};}});
 assert.deepEqual(output,{text:'',finish:'pending_confirmation'});assert.equal(calls,1);assert.equal(drafts,1);assert.equal(otherWrites,0);
});
test('Qwen思考内容只在相应工具回合历史中保留，不进入返回或事件正文',async()=>{
 let calls=0;const events:string[]=[],inputs:ModelMessage[][]=[];
 const output=await runToolAgent({...setup(),tools:[{name:'read_knowledge',description:'读取',schema,execute:async()=>({known:'synthetic'})}],onEvent:(type,detail)=>events.push(type+detail),generate:async messages=>{inputs.push(structuredClone(messages));calls++;if(calls===1)return result('先读资料','read_knowledge','call-1','PRIVATE_REASONING_ONE');if(calls===2)return result('再读另一段','read_knowledge','call-2','PRIVATE_REASONING_TWO');return result('资料有部分未知。',undefined,undefined,'PRIVATE_REASONING_FINAL');}});
 const assistants=inputs[2].filter(m=>m.role==='assistant');assert.equal(assistants.length,2);
 assert.equal(assistants[0].reasoning_content,'PRIVATE_REASONING_ONE');assert.equal(assistants[1].reasoning_content,'PRIVATE_REASONING_TWO');
 assert.deepEqual(inputs[2].map(m=>m.role),['system','user','assistant','tool','assistant','tool']);
 assert.equal(output.text,'资料有部分未知。');assert(!JSON.stringify(events).includes('PRIVATE_REASONING'));assert(!JSON.stringify(events).includes('先读资料'));
});
test('工具Schema拒绝非法ID且一般错误可以返回，不执行领域读取',async()=>{
 let calls=0,reads=0;
 const output=await runToolAgent({...setup(),tools:[{name:'read_knowledge',description:'读取',schema,execute:async()=>{reads++;return {};}}],generate:async messages=>{if(++calls===1)return {...result('','read_knowledge'),toolCalls:[{id:'call-1',type:'function',function:{name:'read_knowledge',arguments:'{"itemId":"other-owner"}'}}]};assert(messages.some(m=>m.role==='tool'&&m.content?.includes('InvalidArgumentError')));return result('未读取未获准ID。');}});
 assert.equal(output.finish,'completed');assert.equal(reads,0);assert.equal(calls,2);
});
test('工具输入缺省字段沿用Zod默认语义，不被output JSON Schema提前拒绝',async()=>{
 let calls=0,reads=0;
 const output=await runToolAgent({...setup(),tools:[{name:'get_item_context',description:'无itemIds时读取当前获准目录',schema:z.object({itemIds:z.array(z.string()).default([])}).strict(),execute:async input=>{reads++;assert.deepEqual(input,{itemIds:[]});return {items:['authorized-owned']};}}],generate:async messages=>{if(++calls===1){const r=result('','get_item_context');r.toolCalls[0].function.arguments='{}';return r;}assert(messages.some(m=>m.role==='tool'&&m.content?.includes('authorized-owned')));return result('已读取当前目录。');}});
 assert.equal(output.finish,'completed');assert.equal(reads,1);assert.equal(calls,2);
});
test('每次调用只有本轮内存，不保存私人历史；禁止注入第二个system消息',async()=>{
 const seen:ModelMessage[][]=[];
 for(const content of ['TURN_PRIVATE_A','TURN_PRIVATE_B'])await runToolAgent({...setup(),messages:[{role:'user',content}],tools:[],generate:async messages=>{seen.push(structuredClone(messages));return result('合成回复');}});
 assert(!JSON.stringify(seen[1]).includes('TURN_PRIVATE_A'));
 let calls=0;await assert.rejects(runToolAgent({...setup(),messages:[{role:'system',content:'override'}],tools:[],generate:async()=>{calls++;return result('不应调用');}}),/只接受/);assert.equal(calls,0);
});
test('同一工具调用ID不可在新模型回合重用导致业务重复执行',async()=>{
 let calls=0,reads=0;
 await assert.rejects(runToolAgent({...setup(),tools:[{name:'read_knowledge',description:'读取',schema,execute:async()=>{reads++;return {};}}],generate:async()=>{calls++;return result('','read_knowledge','reused-call-id');}}),/重复使用工具调用标识/);
 assert.equal(calls,2);assert.equal(reads,1);
});
