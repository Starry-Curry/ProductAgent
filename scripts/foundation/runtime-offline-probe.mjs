// Zero-provider-cost transport/lifecycle probe. The HTTP model below is scripted,
// not Qwen. Passing this file proves no product intelligence or physical result.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import OpenAI from 'openai';
import {z} from 'zod';

const root=path.resolve('docs/engineering/qwen-foundation-2026-11-02/evidence');
const target=path.join(root,'runtime-offline.json');
if(fs.existsSync(target))throw Error('preserve_existing_runtime_offline_evidence');
const packageRoot=path.resolve('.runtime/agentscope-offline/node_modules/@agentscope-ai/agentscope');
const load=name=>import(pathToFileURL(path.join(packageRoot,'dist',name,'index.mjs')).href);
const {Agent}=await load('agent');
const {OpenAIChatModel}=await load('model');
const {Toolkit}=await load('tool');
const {UserMsg,getTextContent}=await load('message');
const {StorageBase}=await load('storage');
assert.equal(JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'))).version,'0.0.15');

const card={itemId:'synthetic-owned-labeler',name:'合成标签机',model:'UNSEEN-LABEL-42',basis:'synthetic_registered_user_report',properties:{material:null,battery:'用户报告可开机',supplies:'用户报告色带已用完'},capabilities:[{name:'标签打印',status:'conditional',requires:['适用耗材','对应型号操作资料']}],unknowns:['外壳材质','当前打印能力'],source:{id:'synthetic-manual:1',url:'https://example.invalid/synthetic/UNSEEN-LABEL-42',applicability:'synthetic_exact_model_not_real_official_source'}};
const question='只用我登记的标签机整理旅行纪念卡：现在能直接打印吗，外壳是什么材质？不要购买，不要编造未知属性。';
const system='只读取当前用户获准物品，区分用户报告、未知与操作条件。工具错误应保留原因，不读取其他用户物品，不进行写入。';
const answer='登记报告显示色带已用完，所以当前不能直接打印。外壳材质未知；不能凭名称补全。没有购买或执行任何操作。';
const schema=z.object({itemId:z.string()}).strict();
const toolDefinition={type:'function',function:{name:'read_knowledge',description:'取得当前用户获准的物品语义卡和资料；本工具执行实时权限检查。',parameters:z.toJSONSchema(schema)}};
const runs=new Map();
let blockedExternalRequests=0,localHttpRequests=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const u=new URL(typeof input==='string'?input:input.url||String(input));if(u.hostname!=='127.0.0.1'){blockedExternalRequests++;throw Error('offline_probe_external_network_denied');}return originalFetch(input,init);};

const server=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const body=JSON.parse(raw),key=req.url.split('/')[1],run=runs.get(key);localHttpRequests++;
 assert(run,'unknown_local_probe_run');run.requests.push({messages:body.messages,tools:body.tools,toolChoice:body.tool_choice,stream:body.stream});
 const n=run.requests.length,forceText=body.tool_choice==='none';
 const call=run.scenario==='loop-cap'&&!forceText||n===1||run.scenario==='tool-recovery'&&n===2;
 const denied=run.scenario==='denied-id';
 const choice=call?{role:'assistant',content:null,tool_calls:[{id:'call-'+n,type:'function',function:{name:'read_knowledge',arguments:JSON.stringify({itemId:denied?'private-other-owner':card.itemId})}}]}:{role:'assistant',content:denied?'该物品未获授权，没有读取其他人的资料。':forceText?'工具循环已停止；这是受限总结，不代表任务完成。':answer};
 const usage={prompt_tokens:100,completion_tokens:20,total_tokens:120};
 if(body.stream){res.writeHead(200,{'content-type':'text/event-stream'});const delta={...choice,...(call?{tool_calls:choice.tool_calls.map((t,index)=>({...t,index}))}:{})};const packet={id:'offline-'+n,object:'chat.completion.chunk',created:1,model:'offline-scripted-model',choices:[{index:0,delta,finish_reason:null}]};res.write('data: '+JSON.stringify(packet)+'\n\n');res.write('data: '+JSON.stringify({...packet,choices:[{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}],usage})+'\n\n');res.end('data: [DONE]\n\n');}
 else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'offline-'+n,object:'chat.completion',created:1,model:'offline-scripted-model',choices:[{index:0,message:choice,finish_reason:call?'tool_calls':'stop'}],usage}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
function createRun(runtime,scenario){const key=runtime+'-'+scenario;const run={runtime,scenario,requests:[],toolAttempts:[],knowledgeReads:0,successfulReads:0,unauthorizedReads:0,events:[],cache:new Map()};runs.set(key,run);return {key,run};}
function reader(run){return raw=>{const p=schema.parse(raw);run.toolAttempts.push({itemId:p.itemId});if(p.itemId!==card.itemId)throw Error('permission_denied');if(run.cache.has(p.itemId))return run.cache.get(p.itemId);run.knowledgeReads++;if(run.scenario==='tool-recovery'&&run.knowledgeReads===1)throw Error('temporary_source_unavailable');run.successfulReads++;const value=JSON.stringify(card);run.cache.set(p.itemId,value);return value;};}
const inputMessages=()=>[{role:'system',content:system},{role:'user',content:JSON.stringify({question,item:card})}];

async function sdkProbe(scenario){
 const {key,run}=createRun('sdk',scenario),client=new OpenAI({apiKey:'fixture-only',baseURL:base+'/'+key+'/v1',maxRetries:0,timeout:3000}),read=reader(run);
 const messages=inputMessages();let pending=[],paused=false;
 const invoke=()=>{for(const t of pending){run.events.push({type:'TOOL_RESULT_START'});let result;try{result={state:'success',output:read(JSON.parse(t.function.arguments))};}catch(e){result={state:'error',reason:e.message};}messages.push({role:'tool',tool_call_id:t.id,content:JSON.stringify(result)});run.events.push({type:'TOOL_RESULT_END',state:result.state});}pending=[];};
 for(let turn=0;turn<3;turn++){
  if(pending.length)invoke();
  run.events.push({type:'MODEL_CALL_START'});
  const response=await client.chat.completions.create({model:'offline-scripted-model',messages,tools:[toolDefinition],max_tokens:500});
  const m=response.choices[0].message;messages.push(m);run.events.push({type:'MODEL_CALL_END'});
  if(!m.tool_calls?.length){run.text=m.content;break;}
  pending=m.tool_calls;
  if(scenario==='pause-resume'&&!paused){run.pausedBeforeRead=run.knowledgeReads===0;run.checkpoint=structuredClone({messages,pending});paused=true;run.events.push({type:'APP_CHECKPOINT'});}
  invoke();
 }
 if(!run.text){run.events.push({type:'APP_HARD_MODEL_REQUEST_LIMIT'});run.text='工具循环已停止；本次未完成最终答复。';}
 run.finishedReason=run.events.some(e=>e.type==='APP_HARD_MODEL_REQUEST_LIMIT')?'request_limit':'completed';
 return run;
}
class MemoryStorage extends StorageBase{
 constructor(){super();this.state={context:[],metadata:{}};this.loads=0;this.saves=0;}
 async loadAgentState(){this.loads++;return structuredClone(this.state);}
 async saveAgentState(value){this.saves++;this.state=structuredClone(value);}
}
async function scopeProbe(scenario){
 const {key,run}=createRun('agentscope',scenario),read=reader(run),toolkit=new Toolkit({builtInSkillTool:false});
 toolkit.registerToolFunction({name:'read_knowledge',description:toolDefinition.function.description,inputSchema:schema,call:p=>read(p)});
 const storage=new MemoryStorage();
 const makeAgent=()=>{const model=new OpenAIChatModel({modelName:'offline-scripted-model',apiKey:'fixture-only',baseURL:base+'/'+key+'/v1',maxRetries:0,presetGenParams:{max_tokens:500,stream_options:{include_usage:true}}});model.client.maxRetries=0;return new Agent({name:'物间离线实验',sysPrompt:system,model,toolkit,maxIters:3,storage,compressionConfig:{enabled:false,triggerThreshold:100000}});};
 let agent=makeAgent(),iterator=agent.replyStream({msgs:UserMsg({name:'合成用户',content:JSON.stringify({question,item:card})})}),response;
 while(true){const step=await iterator.next();if(step.done){response=step.value;break;}run.events.push(structuredClone(step.value));
  if(scenario==='pause-resume'&&step.value.type==='TOOL_RESULT_START'&&!run.pausedBeforeRead){run.pausedBeforeRead=run.knowledgeReads===0;await iterator.return();run.checkpoint=structuredClone(storage.state);agent=makeAgent();iterator=agent.replyStream({});}
 }
 run.text=response?getTextContent(response):null;run.storage={loads:storage.loads,saves:storage.saves};run.context=structuredClone(agent.context);run.finishedReason=run.events.findLast(e=>e.type==='REPLY_END')?.finished_reason;
 return run;
}
const report={at:new Date().toISOString(),basis:'offline_scripted_model_transport_tool_lifecycle_not_qwen_not_product_quality',model:'offline-scripted-model',externalPaidRequests:0,semanticCard:card,semanticCardSha256:createHash('sha256').update(JSON.stringify(card)).digest('hex'),question,results:[]};
try{
 for(const scenario of ['known-and-unknown','tool-recovery','denied-id','pause-resume','loop-cap']){
  for(const execute of [sdkProbe,scopeProbe]){
   const started=performance.now(),run=await execute(scenario);run.elapsedMs=Math.round(performance.now()-started);
   const strings=JSON.stringify(run.requests);
   assert.equal(run.unauthorizedReads,0);
   if(scenario==='denied-id'){assert.equal(run.successfulReads,0);assert(!strings.includes('PRIVATE_SENTINEL'));assert.match(run.text,/未获授权/);}
   if(scenario==='tool-recovery'){assert.equal(run.knowledgeReads,2);assert.equal(run.successfulReads,1);assert(strings.includes('temporary_source_unavailable'));}
   if(scenario==='pause-resume'){assert.equal(run.pausedBeforeRead,true);assert.equal(run.successfulReads,1);assert.equal(run.requests.length,2);if(run.runtime==='agentscope')assert.equal(run.storage.saves,2);}
   if(scenario==='known-and-unknown'){assert.equal(run.requests.length,2);assert.equal(run.successfulReads,1);assert.match(run.text,/材质未知/);}
   const {cache,...published}=run;published.assertions='passed_for_scripted_transport_and_tool_lifecycle_only';report.results.push(published);
  }
 }
 report.localHttpRequests=localHttpRequests;report.blockedExternalRequests=blockedExternalRequests;
 report.observations={sdkLoopCapRequests:report.results.find(r=>r.runtime==='sdk'&&r.scenario==='loop-cap').requests.length,agentScopeLoopCapRequests:report.results.find(r=>r.runtime==='agentscope'&&r.scenario==='loop-cap').requests.length,agentScopeLimitReportedAs:report.results.find(r=>r.runtime==='agentscope'&&r.scenario==='loop-cap').finishedReason,domainGuards:'same server-owned tool closure; framework itself does not grant item access',pause:'new Agent instance loads saved pending tool context; the underlying tool executes once',caveat:'scripted model knows next response by scenario; no evidence of Qwen reasoning, search, latency or product quality'};
 assert.equal(report.observations.sdkLoopCapRequests,3);assert.equal(report.observations.agentScopeLoopCapRequests,4);
}catch(e){report.error={name:e.name,message:e.message,stack:e.stack};process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));fs.mkdirSync(root,{recursive:true});fs.writeFileSync(target,JSON.stringify(report,null,2));console.log(JSON.stringify({basis:report.basis,error:report.error?.message,results:report.results.map(r=>({runtime:r.runtime,scenario:r.scenario,calls:r.requests.length,reads:r.successfulReads,finished:r.finishedReason})),observations:report.observations,externalPaidRequests:0},null,2));}
