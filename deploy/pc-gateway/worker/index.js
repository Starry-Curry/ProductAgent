const prefix = '/__wujian_host/';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = (value, status=200) => Response.json(value, {status,headers:{'Cache-Control':'no-store'}});
const idValid = id => /^[a-f0-9-]{36}$/.test(id);
const safeHeaders = ['accept','accept-language','content-type','cookie','origin','range','user-agent','sec-fetch-site','if-none-match','x-demo-actor','rsc','next-router-state-tree','next-router-prefetch','next-url','x-nextjs-data'];
const dropResponse = new Set(['connection','keep-alive','transfer-encoding','content-length','content-encoding','server']);
function offline() {
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="10"><title>物间 · 等电脑连接</title><style>body{margin:0;background:#f8f7f2;color:#344c54;font:17px/1.9 -apple-system,"PingFang SC",sans-serif;display:grid;min-height:100dvh;place-items:center}main{max-width:430px;padding:32px}small{color:#829397}h1{font-size:31px}button{background:#7f9fab;border:0;border-radius:13px;color:white;padding:13px 24px;font:inherit}p{color:#728184}</style><main><small>WUJIAN · 物间</small><h1>等电脑连接，<br>我们再接着聊。</h1><p>二维码地址没有变。提供服务的电脑暂时未连接；电脑开机、登录并联网后会自动恢复。</p><button onclick="location.reload()">重新连接</button><p><small>页面也会每 10 秒自动重试。</small></p></main></html>`,{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Retry-After':'10'}});
}
async function authenticated(request, env) {
  const supplied=request.headers.get('authorization')||'';
  const expected='Bearer '+(env.HOST_KEY||'');
  if(!env.HOST_KEY || supplied.length!==expected.length)return false;
  const a=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(supplied))),b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(expected)));
  let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a[i]^b[i];return mismatch===0;
}
async function heartbeat(bucket) {const raw=await bucket.get('host/heartbeat');return raw?raw.json():null;}
function online(info) {return !!info?.ready && Date.now()-info.at<25000;}
async function control(request, env) {
  if(!await authenticated(request,env))return json({error:'Unauthorized'},401);
  const bucket=env.MAILBOX,url=new URL(request.url),action=url.pathname.slice(prefix.length);
  if(action==='heartbeat' && request.method==='POST') {
    const body=await request.json();await bucket.put('host/heartbeat',JSON.stringify({at:Date.now(),ready:body.ready===true,build:String(body.build||'').slice(0,100)}));return json({ok:true});
  }
  if(action==='poll' && request.method==='GET') {
    const busy=new Set((url.searchParams.get('busy')||'').split(',').filter(idValid));
    const capacity=Math.max(0,Math.min(4,Number(url.searchParams.get('capacity'))||0));
    if(!capacity)return json({jobs:[]});
    const rows=await bucket.list({prefix:'q/',limit:40});const jobs=[];
    for(const row of rows.objects) {
      if(Date.now()-new Date(row.uploaded).getTime()>90000){await bucket.delete(row.key);continue;}
      const id=row.key.slice(2);if(!idValid(id)||busy.has(id))continue;
      const object=await bucket.get(row.key);if(object)jobs.push(await object.json());
      if(jobs.length>=capacity)break;
    }
    return json({jobs});
  }
  if(action.startsWith('reply/') && request.method==='POST') {
    const id=action.slice(6);if(!idValid(id))return json({error:'Invalid ID'},400);
    if(Number(request.headers.get('content-length')||0)>15000000)return json({error:'Too large'},413);
    const reply=await request.json();
    if(!Number.isInteger(reply.status)||reply.status<200||reply.status>599||!Array.isArray(reply.headers)||typeof reply.body!=='string'||reply.body.length>14000000)return json({error:'Invalid reply'},400);
    await bucket.put('r/'+id,JSON.stringify(reply));await bucket.delete('q/'+id);return json({ok:true});
  }
  if(action==='cleanup' && request.method==='POST') {
    const rows=await bucket.list({prefix:'r/',limit:100});const expired=rows.objects.filter(o=>Date.now()-new Date(o.uploaded).getTime()>120000).map(o=>o.key);if(expired.length)await bucket.delete(expired);return json({ok:true});
  }
  return json({error:'Not found'},404);
}
export default {
  async fetch(request,env,ctx) {
    try {
      if(!env.MAILBOX)return json({error:'Gateway storage is not configured'},503);
      const url=new URL(request.url);
      if(url.pathname.startsWith(prefix))return control(request,env);
      const info=await heartbeat(env.MAILBOX);
      if(url.pathname==='/__wujian/status')return json({online:online(info)});
      const asset=request.method==='GET' && /^\/(?:_next\/static\/|companion\/|products\/real-v1\/)/.test(url.pathname);
      const assetKey='assets/'+url.pathname;
      if(asset){const hit=await env.MAILBOX.get(assetKey);if(hit){const saved=await hit.json();const bytes=Uint8Array.from(atob(saved.body),c=>c.charCodeAt(0));return new Response(bytes,{headers:saved.headers});}}
      if(!online(info))return url.pathname.startsWith('/api/')?json({error:'电脑暂未连接，请在开机联网后重试。',code:'desktop_offline'},503):offline();
      const length=Number(request.headers.get('content-length')||0);if(length>6000000)return json({error:'照片太大，请使用小于 5MB 的照片。'},413);
      const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.length>6000000)return json({error:'请求过大'},413);
      let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
      const id=crypto.randomUUID(),headers=[];for(const key of safeHeaders){const v=request.headers.get(key);if(v!==null)headers.push([key,v]);}
      const row={id,method:request.method,path:url.pathname+url.search,headers,body:btoa(binary),at:Date.now()};
      const pending=await env.MAILBOX.list({prefix:'q/',limit:41});if(pending.objects.length>=40)return json({error:'当前访问较多，请稍后再试。'},503);
      await env.MAILBOX.put('q/'+id,JSON.stringify(row));
      for(let attempt=0;attempt<34;attempt++) {
        if(request.signal.aborted)break;
        const response=await env.MAILBOX.get('r/'+id);
        if(response) {
          const reply=await response.json(),responseHeaders=new Headers();
          for(const [k,v]of reply.headers)if(!dropResponse.has(String(k).toLowerCase()))responseHeaders.append(k,v);
          responseHeaders.set('X-Wujian-Host','desktop');
          const decoded=atob(reply.body),out=new Uint8Array(decoded.length);for(let i=0;i<decoded.length;i++)out[i]=decoded.charCodeAt(i);
          const result=new Response([204,205,304].includes(reply.status)?null:out,{status:reply.status,headers:responseHeaders});
          ctx.waitUntil(env.MAILBOX.delete(['q/'+id,'r/'+id]));
          if(asset&&result.ok&&!responseHeaders.has('set-cookie'))ctx.waitUntil(env.MAILBOX.put(assetKey,JSON.stringify(reply)));
          return result;
        }
        await wait(attempt<2?350:1300);
      }
      ctx.waitUntil(env.MAILBOX.delete('q/'+id));
      return json({error:'电脑连接暂时中断，请稍后刷新。写入请求未自动重试。',code:'host_timeout'},504);
    } catch {
      return json({error:'连接暂时未完成，请刷新重试。'},503);
    }
  }
};
