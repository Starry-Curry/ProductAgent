import test from 'node:test';import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {makeKnowledgeDocument,storeOfficialDocument} from '../src/lib/life/acquisition.ts';
import {respond} from '../src/lib/agent/service.ts';
import type {Provider} from '../src/lib/ai/provider.ts';
import {recordSessionFeedback} from '../src/lib/repositories/sessions.ts';

test('对抗进度：有来源的模型指导必须保留步骤身份；用户报告一步完成后接续而不另起任务',async t=>{
 const f=validationFixture('.runtime/finals-progress-'+crypto.randomUUID());t.after(()=>f.db.close());
 const prior={runtime:process.env.WUJIAN_AGENT_RUNTIME,fetch:process.env.WUJIAN_ALLOW_PUBLIC_FETCH};
 process.env.WUJIAN_AGENT_RUNTIME='native';process.env.WUJIAN_ALLOW_PUBLIC_FETCH='false';
 t.after(()=>{for(const [key,v]of [['WUJIAN_AGENT_RUNTIME',prior.runtime],['WUJIAN_ALLOW_PUBLIC_FETCH',prior.fetch]])if(v===undefined)delete process.env[key!];else process.env[key!]=v;});
 const id=f.add('[合成]操作设备','其他','Sony','TEST-PROGRESS');const item=f.read().items.find(i=>i.id===id)!;
 const page={url:'https://helpguide.sony.net/synthetic-progress.html',title:'TEST-PROGRESS synthetic manual',text:'TEST-PROGRESS: First press the marked key. Then check the indicator. Synthetic source, no actual device.',links:[]};
 storeOfficialDocument(f.db,'lin',item,makeKnowledgeDocument(page,item,[page.url]));
 let calls=0;const provider:Provider={ready:true,structuredOutput:'json_schema',model:'offline-protocol',generate:async()=>{throw Error('no_review');},converse:async messages=>{
  calls++;const packet=JSON.parse(messages.find(m=>m.role==='user')!.content!);const source=packet.officialSemantics.originalSources[0];
  return {text:'',model:'offline-protocol',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'guidance',type:'function',function:{name:'complete_answer',arguments:JSON.stringify({message:'以下是合成操作说明，不是设备控制。',guidance:{kind:'procedure',itemId:id,steps:[{text:'先按标示键。',sourceId:source.id},{text:'再查看指示状态。',sourceId:source.id}],conditions:['只作离线协议验证']}})}}]};
 }};
 const first=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:'如何操作？',mode:'service',memoryPolicy:'off'},provider);
 assert.equal(first.reply.steps.length,2,'指导不能只剩一段文本而丢失可接续的步骤');
 assert.notEqual(first.reply.steps[0].id,first.reply.steps[1].id);
 const feedbackId=crypto.randomUUID();const feedback={requestId:feedbackId,sessionId:first.session.id,outcome:'tried',stepId:first.reply.steps[0].id};
 const marked=recordSessionFeedback(f.db,f.read,'lin',feedback);
 assert.ok(marked.tried.includes(first.reply.steps[0].id));
 assert.doesNotMatch(marked.messages.at(-1)!.text,/还需要帮助/,'试过某一步不能自动变成失败报告');
 const second=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),sessionId:first.session.id,itemId:id,question:'下一步呢？',mode:'service',memoryPolicy:'off'},provider);
 assert.equal(calls,1,'纯进度续接复用已有来源指导，无需重复模型调用');
 assert.equal(second.session.id,first.session.id);assert.equal(second.reply.steps.length,1);assert.match(second.reply.steps[0].text,/指示/);
 assert.ok(second.session.tried.includes(first.reply.steps[0].id));assert.match(second.reply.answer,/不代表设备已实际完成/);
 assert.equal(first.reply.stepsInAnswer,true);assert.equal(second.reply.stepsInAnswer,false);
 const another=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:'另一会话如何操作？',mode:'service',memoryPolicy:'off'},provider);
 assert.throws(()=>recordSessionFeedback(f.db,f.read,'lin',{...feedback,sessionId:another.session.id}),/重复请求.*会话|另一会话/,'同一请求不能静默当成另一个会话的成功反馈');
});
