import {spawn} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import net from 'node:net';
import {foundationGateway,ROUND} from './gateway.mjs';
const offline=process.argv.includes('--offline'),dev=process.argv.includes('--dev');
const port=process.argv.find(a=>a.startsWith('--port='))?.slice(7)||'3240';if(!/^32\d\d$/.test(port))throw Error('invalid_local_port');
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(Number(port),'127.0.0.1',()=>probe.close(resolve));});
const gate=offline?{url:'',model:'qwen3.8-max-0902',close:async()=>{}}:await foundationGateway({phase:'integration',recordContent:process.argv.includes('--record-synthetic-evidence')});
const child=spawn(process.execPath,['--import',pathToFileURL(path.resolve('scripts/alpha/network-hook.mjs')).href,'node_modules/next/dist/bin/next',dev?'dev':'start','--hostname','127.0.0.1','--port',port],{windowsHide:true,stdio:'inherit',env:{...process.env,
 AUTH_MODE:'authenticated',PRODUCT_AGENT_DATA_DIR:path.resolve('.runtime/foundation-preview'),WUJIAN_BUILD_DIR:'.next-foundation',
 AI_ALLOW_PAID_CALLS:offline?'false':'true',WUJIAN_ALLOW_PAID_CALLS:offline?'false':'true',AI_API_KEY:offline?'':'fixture-only',AI_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',AI_MODEL:gate.model,AI_TASK_MODEL:gate.model,AI_CREATIVE_MODEL:gate.model,AI_REQUEST_TIMEOUT_MS:'75000',AI_STRUCTURED_OUTPUT:'json_schema',
 WUJIAN_AGENT_RUNTIME:'native',WUJIAN_PRACTICAL_THINKING:'false',WUJIAN_ALLOW_SEARCH:offline?'false':'true',WUJIAN_ALLOW_PUBLIC_FETCH:'true',WUJIAN_EXPERIMENTAL_FACT_QA:'false',WUJIAN_EXPERIMENTAL_KERNEL_V3:'false',ALPHA_GATEWAY:gate.url,
 WUJIAN_ENABLE_DEVICE_LAB:'true',LANGSMITH_TRACING:'false',LANGCHAIN_TRACING_V2:'false',NEXT_TELEMETRY_DISABLED:'1'}});
fs.writeFileSync('.runtime/foundation-preview-'+port+'.json',JSON.stringify({url:'http://127.0.0.1:'+port,round:ROUND,syntheticDataOnly:true,paid:!offline}));
let stopping=false;async function stop(){if(stopping)return;stopping=true;child.kill();await gate.close();}
process.on('SIGINT',()=>stop().then(()=>process.exit(0)));process.on('SIGTERM',()=>stop().then(()=>process.exit(0)));child.on('exit',c=>stop().then(()=>process.exit(c||0)));
setTimeout(()=>stop().then(()=>process.exit(0)),60*60*1000);
