import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import net from 'node:net';
import {finalsGateway,ROUND} from './gateway.mjs';
const port=process.argv.find(a=>a.startsWith('--port='))?.slice(7)||'3242';
if(!/^32\d\d$/.test(port))throw Error('invalid_local_port');
const offline=process.argv.includes('--offline');
// Proxy-aware Node must keep the local accounting gateway on loopback. Without
// NO_PROXY the OS proxy can close these requests before they reach the ledger.
process.env.NO_PROXY=[process.env.NO_PROXY,'127.0.0.1','localhost','::1'].filter(Boolean).join(',');
await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(Number(port),'127.0.0.1',()=>s.close(resolve));});
const gate=offline?{url:'',model:'qwen3.8-max-0902',close:async()=>{}}:await finalsGateway({recordContent:process.argv.includes('--record-synthetic-evidence'),rerank:process.argv.includes('--rerank')});
fs.mkdirSync('.runtime',{recursive:true});
fs.writeFileSync('.runtime/finals-preview-'+port+'.json',JSON.stringify({url:'http://127.0.0.1:'+port,gatewayUrl:gate.url,round:ROUND,syntheticDataOnly:true,paid:!offline,features:{rerank:process.argv.includes('--rerank'),vision:process.argv.includes('--vision'),naturalChat:process.argv.includes('--natural-chat')}}));
const child=spawn(process.execPath,['--import',pathToFileURL(path.resolve('scripts/alpha/network-hook.mjs')).href,'node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',port],{windowsHide:true,stdio:'inherit',env:{...process.env,
 AUTH_MODE:'authenticated',PRODUCT_AGENT_DATA_DIR:path.resolve('.runtime/finals-product-preview'),WUJIAN_BUILD_DIR:'.next-finals-product',
 AI_ALLOW_PAID_CALLS:offline?'false':'true',WUJIAN_ALLOW_PAID_CALLS:offline?'false':'true',AI_API_KEY:offline?'':'fixture-only',
 AI_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',AI_MODEL:gate.model,AI_TASK_MODEL:gate.model,AI_CREATIVE_MODEL:gate.model,
 AI_REQUEST_TIMEOUT_MS:'75000',AI_STRUCTURED_OUTPUT:'json_schema',WUJIAN_AGENT_RUNTIME:'native',
 AI_RERANK_MODEL:process.argv.includes('--rerank')&&!offline?'qwen3.7-text-rerank':'',
 AI_VISION_MODEL:process.argv.includes('--vision')&&!offline?gate.model:'',
 WUJIAN_PRACTICAL_NATURAL_CHAT:process.argv.includes('--natural-chat')?'true':'false',
 WUJIAN_PRACTICAL_THINKING:process.argv.includes('--thinking-all')?'always':process.argv.includes('--thinking')?'true':'false',WUJIAN_ALLOW_SEARCH:offline?'false':'true',WUJIAN_ALLOW_PUBLIC_FETCH:'true',
 WUJIAN_EXPERIMENTAL_FACT_QA:'false',WUJIAN_EXPERIMENTAL_KERNEL_V3:'false',ALPHA_GATEWAY:gate.url,
 WUJIAN_ENABLE_DEVICE_LAB:'true',LANGSMITH_TRACING:'false',LANGCHAIN_TRACING_V2:'false',NEXT_TELEMETRY_DISABLED:'1',
}});
let closing=false,gateClosing;
const closeGate=()=>gateClosing??=gate.close();
async function stop(){if(closing)return;closing=true;child.kill();await closeGate();}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
child.on('exit',code=>void closeGate().catch(()=>{}).finally(()=>process.exit(code||0)));
