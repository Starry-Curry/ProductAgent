import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
process.umask(0o077);
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const config = JSON.parse(fs.readFileSync(path.join(root, 'host-config.json'), 'utf8'));
const origin = new URL(config.origin);
if(origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') throw Error('Invalid gateway');
const key = fs.readFileSync(path.join(root, 'host-key'), 'utf8').trim();
if(!/^[a-f0-9]{64}$/.test(key)) throw Error('Host key missing');
const port = 3214;
const localOrigin = `http://127.0.0.1:${port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const journal = new DatabaseSync(path.join(root, 'relay.sqlite'));
journal.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,at INTEGER NOT NULL,reply TEXT);');
const active = new Map();
let stopping = false, ready = false, child, lastHeartbeat = 0, lastCleanup = 0, failures = 0;
const log = message => console.log(new Date().toISOString(), message);
const dropHeaders = new Set(['connection','keep-alive','transfer-encoding','content-length','content-encoding','host','authorization','set-cookie']);
async function control(action, data) {
  const response = await fetch(new URL('/__wujian_host/' + action, origin), {
    method: data === undefined ? 'GET' : 'POST',
    headers: {Authorization: 'Bearer ' + key, ...(data === undefined ? {} : {'Content-Type':'application/json'})},
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(20000),
  });
  if(!response.ok) throw Error('Gateway HTTP ' + response.status);
  return response.json();
}
const replyError = (status, message) => ({status, headers:[['content-type','application/json; charset=utf-8'],['cache-control','no-store']], body:Buffer.from(JSON.stringify({error:message})).toString('base64')});
export function localPath(input, base) {
  if(typeof input !== 'string' || !input.startsWith('/') || input.startsWith('//') || input.includes('\\') || /[\r\n]/.test(input)) throw Error('Invalid path');
  const target = new URL(input, base);
  if(target.origin !== base) throw Error('Invalid destination');
  return target;
}
async function forward(job) {
  const target = localPath(job.path, localOrigin);
  if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(job.method)) throw Error('Invalid method');
  const headers = new Headers();
  for(const [k,v] of job.headers) if(!dropHeaders.has(k.toLowerCase())) headers.append(k,v);
  headers.set('host', origin.host);
  headers.set('x-forwarded-host', origin.host);
  headers.set('x-forwarded-proto', 'https');
  headers.set('accept-encoding','identity');
  return new Promise((resolve,reject)=>{
    const request=http.request(target,{method:job.method,headers:Object.fromEntries(headers)},response=>{
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>10000000){request.destroy(Error('Response too large'));return;}chunks.push(chunk);});
      response.on('error',reject);
      response.on('end',()=>{
        const pairs=[];
        for(let i=0;i<response.rawHeaders.length;i+=2){const k=response.rawHeaders[i],v=response.rawHeaders[i+1];if(k.toLowerCase()==='set-cookie'||!dropHeaders.has(k.toLowerCase()))pairs.push([k,v]);}
        resolve({status:response.statusCode,headers:pairs,body:Buffer.concat(chunks).toString('base64')});
      });
    });
    const timer=setTimeout(()=>request.destroy(Error('Local timeout')),36000);
    request.on('close',()=>clearTimeout(timer));request.on('error',reject);
    request.end(['GET','HEAD'].includes(job.method)?undefined:Buffer.from(job.body,'base64'));
  });
}
async function processJob(job) {
  if(!/^[a-f0-9-]{36}$/.test(job.id)) return;
  const existing = journal.prepare('SELECT reply FROM requests WHERE id=?').get(job.id);
  let reply;
  if(existing?.reply) reply = JSON.parse(existing.reply);
  else if(existing && !['GET','HEAD'].includes(job.method)) reply = replyError(503,'电脑刚刚恢复连接，请先查看记录，避免重复提交。');
  else {
    journal.prepare('INSERT OR IGNORE INTO requests(id,at) VALUES(?,?)').run(job.id,Date.now());
    try { reply = await forward(job); } catch { reply = replyError(502,'电脑上的服务正在恢复，请稍后重试。'); }
  }
  journal.prepare('UPDATE requests SET reply=? WHERE id=?').run(JSON.stringify(reply),job.id);
  for(let attempt=0;attempt<3&&!stopping;attempt++) {
    try { await control('reply/'+job.id,reply); return; } catch { await delay(1000*(attempt+1)); }
  }
}
async function healthy() {
  try {
    const r = await fetch(localOrigin+'/api/health',{headers:{Host:origin.host},signal:AbortSignal.timeout(3000)});
    return r.ok;
  } catch {return false;}
}
async function startApp() {
  // Never take over an unrelated process using this dedicated port.
  const {createServer} = await import('node:net');
  await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
  child = spawn(process.execPath,['scripts/mobile-demo-start.mjs',origin.origin],{
    cwd:root, env:{...process.env,PORT:String(port),WUJIAN_HOST_DATA_DIR:path.join(root,'.runtime/public-data')},stdio:'inherit'});
  child.on('exit',()=>{ready=false;});
}
const awake = spawn('/usr/bin/caffeinate',['-i'],{stdio:'ignore'});
async function shutdown() {
  if(stopping) return;
  stopping=true;ready=false;
  try { await control('heartbeat',{ready:false}); } catch {}
  child?.kill('SIGTERM');awake.kill();
  await Promise.race([Promise.allSettled([...active.values()]),delay(3000)]);
  journal.close();process.exit(0);
}
process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
await startApp();
log('电脑共享服务已启动。网址固定，等待应用就绪。');
while(!stopping) {
  try {
    if(child?.exitCode!==null || child?.signalCode) {await delay(3000);await startApp();}
    if(Date.now()-lastHeartbeat>8000) {
      ready=await healthy();await control('heartbeat',{ready,build:config.build});lastHeartbeat=Date.now();
      if(ready&&failures) log('公网连接已恢复。');
    }
    if(ready&&active.size<4) {
      const {jobs} = await control('poll?capacity='+(4-active.size)+'&busy='+[...active.keys()].join(','));
      for(const job of jobs) if(!active.has(job.id)) {
        const work=processJob(job).catch(()=>{}).finally(()=>active.delete(job.id));active.set(job.id,work);
      }
    }
    if(Date.now()-lastCleanup>60000) {
      await control('cleanup',{});
      journal.prepare('DELETE FROM requests WHERE at < ?').run(Date.now()-300000);lastCleanup=Date.now();
    }
    failures=0;await delay(active.size?250:1000);
  } catch {
    failures++;if(failures===1) log('网络连接暂时中断，将自动重连。');
    await delay(Math.min(15000,1000*failures));
  }
}
