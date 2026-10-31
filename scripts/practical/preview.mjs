import {spawn} from 'node:child_process';import {pathToFileURL} from 'node:url';import path from 'node:path';import fs from 'node:fs';
import {practicalGateway} from './gateway.mjs';
if(!process.argv.includes('--authorized-60-cny15'))throw Error('current_authorization_required');
const gate=await practicalGateway({recordContent:process.argv.includes('--record-synthetic-evidence')}),project=process.cwd(),port=3232;
const child=spawn(process.execPath,['--import',pathToFileURL(path.join(project,'scripts/alpha/network-hook.mjs')).href,'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:project,windowsHide:true,stdio:'inherit',env:{...process.env,
 PRODUCT_AGENT_DATA_DIR:path.join(project,'.runtime','practical-preview'),WUJIAN_BUILD_DIR:'.next-practical',AUTH_MODE:'authenticated',
 AI_ALLOW_PAID_CALLS:'true',WUJIAN_ALLOW_PAID_CALLS:'true',AI_API_KEY:'fixture-only',AI_BASE_URL:'https://fixture.invalid/v1',AI_MODEL:gate.model,AI_TASK_MODEL:gate.model,AI_CREATIVE_MODEL:gate.model,
 AI_ENABLE_THINKING:'false',AI_JSON_MODE:'true',AI_REQUEST_TIMEOUT_MS:'45000',WUJIAN_AGENT_RUNTIME:'native',WUJIAN_EXPERIMENTAL_KERNEL_V3:'false',WUJIAN_EXPERIMENTAL_FACT_QA:'false',
 WUJIAN_ALLOW_PUBLIC_FETCH:'true',ALPHA_GATEWAY:gate.url,LANGSMITH_TRACING:'false',LANGCHAIN_TRACING_V2:'false',NEXT_TELEMETRY_DISABLED:'1'}});
let stopping=false;async function stop(){if(stopping)return;stopping=true;child.kill();await gate.close();}
process.on('SIGINT',()=>stop().then(()=>process.exit(0)));process.on('SIGTERM',()=>stop().then(()=>process.exit(0)));child.on('exit',c=>stop().then(()=>process.exit(c||0)));
const monitor=setInterval(()=>{if(fs.existsSync('.runtime/stop-practical-preview-3232')){clearInterval(monitor);stop().then(()=>process.exit(0));}},1000);
// A delivery preview is bounded in wall time as well as by the persisted round
// ledger. Restarting this window never resets the 60 request / CNY15 counters.
const expiresAt=new Date(Date.now()+30*60*1000).toISOString();
fs.writeFileSync('.runtime/practical-preview-session.json',JSON.stringify({url:'http://127.0.0.1:3232',expiresAt,round:'practical-agent-20261031-r1'}));
setTimeout(()=>stop().then(()=>process.exit(0)),30*60*1000);
console.log('物间自然工具Agent： http://127.0.0.1:3232；独立测试数据；已授权60次/15元，不扩额度');
