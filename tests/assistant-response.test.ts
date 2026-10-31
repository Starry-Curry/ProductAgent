import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantResponse} from './helpers/assistant-response.mjs';
test('浏览器及Node传输解析：SSE最终结果不等于HTTP或首字成功',async()=>{
 const result={session:{id:'s'},reply:{answer:'最终核对后内容'}};
 const body='event: text\ndata: {"text":"未核对草稿"}\n\nevent: result\ndata: '+JSON.stringify(result)+'\n\n';
 const response=new Response(body,{headers:{'content-type':'text/event-stream'}});
 assert.deepEqual(await assistantResponse(response),result);
 const playwright={headers:()=>({'content-type':'text/event-stream'}),text:async()=>body};
 assert.deepEqual(await assistantResponse(playwright),result);
 await assert.rejects(()=>assistantResponse(new Response('event: text\ndata: {"text":"only draft"}\n\n',{headers:{'content-type':'text/event-stream'}})),/no_final/);
 await assert.rejects(()=>assistantResponse(new Response('event: failure\ndata: {"error":"权限变化"}\n\n',{headers:{'content-type':'text/event-stream'}})),/权限变化/);
 assert.deepEqual(await assistantResponse(new Response('{"ok":true}',{headers:{'content-type':'application/json'}})),{ok:true});
});
