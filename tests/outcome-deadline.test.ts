import test from 'node:test';import assert from 'node:assert/strict';import {createProvider} from '../src/lib/ai/provider.ts';
test('连接成功但流持续不终止，也必须在整段生成预算到达时中止且不重试',async()=>{
 let calls=0;const request:typeof fetch=async(_u,init)=>{calls++;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({id:'x',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:'未完成'},finish_reason:null}]})+'\n\n'));init?.signal?.addEventListener('abort',()=>c.error(new Error('aborted')));}}),{headers:{'content-type':'text/event-stream'}});};
 const p=createProvider({AI_ALLOW_PAID_CALLS:'true',AI_API_KEY:'fixture-only',AI_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',AI_MODEL:'offline-protocol-fixture'},request);const start=Date.now();await assert.rejects(p.converse!([{role:'user',content:'timeout'}],[],{timeoutMs:60,maxTokens:100}),/未完成/);assert.equal(calls,1);assert.ok(Date.now()-start<1000);
});
