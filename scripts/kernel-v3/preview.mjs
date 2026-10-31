// A bounded, explicitly authorized preview; no real account database is opened.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {v3Gateway} from './gateway.mjs';
if(!process.argv.includes('--authorized-v3-250-cny50'))throw Error('current_round_authorization_required');
const port=3230, project=process.cwd(), gate=await v3Gateway();
const child=spawn(process.execPath,['--import',pathToFileURL(path.join(project,'scripts/alpha/network-hook.mjs')).href,'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{
 cwd:project,windowsHide:true,stdio:'inherit',env:{...process.env,
 PRODUCT_AGENT_DATA_DIR:path.join(project,'.runtime','kernel-browser-live'),WUJIAN_BUILD_DIR:'.next-kernel-v3',AUTH_MODE:'authenticated',
 AI_ALLOW_PAID_CALLS:'true',WUJIAN_ALLOW_PAID_CALLS:'true',AI_API_KEY:'fixture-only',AI_BASE_URL:'https://fixture.invalid/v1',
 AI_MODEL:gate.model,AI_TASK_MODEL:gate.model,AI_CREATIVE_MODEL:gate.model,AI_JSON_MODE:'true',AI_ENABLE_THINKING:'false',AI_REQUEST_TIMEOUT_MS:'60000',
 WUJIAN_EXPERIMENTAL_KERNEL_V3:'true',WUJIAN_EXPERIMENTAL_FACT_QA:'false',WUJIAN_ALLOW_PUBLIC_FETCH:'true',
 ALPHA_GATEWAY:gate.url,LANGSMITH_TRACING:'false',LANGCHAIN_TRACING_V2:'false',NEXT_TELEMETRY_DISABLED:'1'}});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;child.kill();await gate.close();}
process.on('SIGINT',()=>stop().then(()=>process.exit(0)));process.on('SIGTERM',()=>stop().then(()=>process.exit(0)));
child.on('exit',code=>stop().then(()=>process.exit(code||0)));
const monitor=setInterval(()=>{if(fs.existsSync('.runtime/stop-kernel-preview-3230')){clearInterval(monitor);stop().then(()=>process.exit(0));}},1000);
console.log('V3授权限额内隔离模型验收 http://127.0.0.1:3230；测试后关闭');
