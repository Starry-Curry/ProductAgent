import test from 'node:test';import assert from 'node:assert/strict';import {qwenResearch} from '../src/lib/ai/qwen-native.ts';
const env={AI_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',AI_API_KEY:'fixture-only',AI_MODEL:'qwen3.8-max-0902',AI_ALLOW_PAID_CALLS:'true',WUJIAN_ALLOW_PAID_CALLS:'true',WUJIAN_ALLOW_SEARCH:'true'};
test('原生SDK流：只采结构化来源，拆分UTF8、正文伪链接、非厂家域名不提升为资料',async()=>{
 const bytes=new TextEncoder().encode('event: response.completed\ndata: '+JSON.stringify({type:'response.completed',response:{status:'completed',model:env.AI_MODEL,usage:{input_tokens:12,output_tokens:3},output:[{type:'web_search_call',action:{sources:[{url:'https://support.brother.com/actual',title:'官方型号页'},{url:'https://evil.example/not-official'}]}},{type:'message',content:[{type:'output_text',text:'https://support.brother.com/guessed'}]}]}})+'\n\n');
 let sent=0;
 const r=await qwenResearch(env,async(url,init)=>{sent++;assert.match(String(url),/\/responses$/);const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.stream,true);assert.deepEqual(body.tools,[{type:'web_search'}]);return new Response(new ReadableStream({start(c){for(let n=0;n<bytes.length;n+=7)c.enqueue(bytes.slice(n,n+7));c.close();}}),{headers:{'content-type':'text/event-stream'}});},'陌生型号',['brother.com']);
 assert.equal(sent,1);assert.deepEqual(r.hits,[{url:'https://support.brother.com/actual',title:'官方型号页'}]);assert.equal(r.usage.input_tokens,12);assert.ok(!r.hits.some(h=>h.url.includes('guessed')));
});
test('原生抽取必须是已限定厂家页面，调用使用web_search+web_extractor与正式Responses思考参数',async()=>{
 let called=false;
 const request:typeof fetch=async(_url,init)=>{called=true;const b=JSON.parse(String(init?.body));assert.deepEqual(b.tools,[{type:'web_search'},{type:'web_extractor'}]);assert.deepEqual(b.reasoning,{effort:'low'});assert.equal(b.thinking_budget,undefined);return new Response('event: response.completed\ndata: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[],usage:{input_tokens:1,output_tokens:1}}})+'\n\n',{headers:{'content-type':'text/event-stream'}});};
 await assert.rejects(qwenResearch(env,request,'read',['brother.com'],'https://not-brother.com/'),/unverified/);assert.equal(called,false);
 await qwenResearch(env,request,'read',['brother.com'],'https://support.brother.com/real');assert.equal(called,true);
});
test('未授权、不可信供应商地址及流无终态都不算成功，不自动重试',async()=>{
 let calls=0;const request:typeof fetch=async()=>{calls++;return new Response('event: response.created\ndata: {"type":"response.created"}\n\n',{headers:{'content-type':'text/event-stream'}});};
 await assert.rejects(qwenResearch({...env,WUJIAN_ALLOW_SEARCH:'false'},request,'x'),/not_authorized/);
 await assert.rejects(qwenResearch({...env,AI_BASE_URL:'https://fake.example/v1'},request,'x'),/not_verified/);assert.equal(calls,0);
 await assert.rejects(qwenResearch(env,request,'x'),/terminal_missing/);assert.equal(calls,1);
});
