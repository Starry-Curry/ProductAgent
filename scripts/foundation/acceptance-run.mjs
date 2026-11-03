// Frozen acceptance runner. Default is integrity-only: no server/model/credentials.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {assistantResponse} from '../../tests/helpers/assistant-response.mjs';
const ROOT='docs/engineering/qwen-foundation-2026-11-02/evidence';
const FROZEN='docs/engineering/qwen-foundation-2026-11-02/acceptance';
const digest=v=>createHash('sha256').update(v).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const writeNew=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const manifest=read(FROZEN+'/FREEZE_SHA256.json');
for(const [name,sha]of Object.entries(manifest.frozenFiles))if(digest(fs.readFileSync(FROZEN+'/'+name))!==sha)throw Error('frozen_integrity_failed:'+name);
const questions=read(FROZEN+'/questions.frozen.json');
if(questions.cases.length!==18||questions.products.length!==6)throw Error('frozen_dimensions_changed');
const arg=(name,fallback)=>process.argv.find(v=>v.startsWith('--'+name+'='))?.slice(name.length+3)||fallback;
const roundId='qwen-foundation-20261102-r1';
const ledger=()=>read(ROOT+'/model-calls.json');
const usedCny=book=>book.attempts.reduce((n,a)=>n+(a.estimatedCny??a.reservedCny),0);
const before=ledger();
const requested=Number(arg('max-requests','64'));
if(!Number.isInteger(requested)||requested<1||requested>64)throw Error('batch_request_limit_must_be_1_to_64');
const remaining=Math.max(0,150-before.attempts.length);
const cap=Math.min(requested,remaining);
if(!process.argv.includes('--execute')){
 console.log(JSON.stringify({mode:'verify_only_no_paid_requests',frozenHashes:manifest.frozenFiles,questions:18,plannedFirstAnswers:18,plannedDirectControls:18,maxForwardedAttempts:cap,globalUsed:before.attempts.length,globalLimit:150,globalEstimatedCny:usedCny(before),globalCnyLimit:80,order:'all_product_first_answers_then_direct_if_budget',actualPaidRequests:0,requires:'gate4-release.json explicitly releases frozen candidate evaluation under the 2026-11-03 task; journey gates remain not_run until separately executed'}));
 process.exit(0);
}
const release=read(ROOT+'/gate4-release.json');
if(release.released!==true||release.roundId!==roundId||release.purpose!=='independent_core_candidate_acceptance'||release.questionsSha256!==manifest.frozenFiles['questions.frozen.json']||!release.candidateEvidence?.length||!Number.isInteger(release.maxRequests)||release.maxRequests>64||release.maxRequests<requested||typeof release.model!=='string'||!release.model.trim())throw Error('candidate_acceptance_not_released');
for(const file of release.candidateEvidence){const full=path.resolve(ROOT,file);if(!full.startsWith(path.resolve(ROOT)+path.sep)||!fs.existsSync(full))throw Error('missing_candidate_readiness_evidence');}
const candidateCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(release.candidateCommit!==candidateCommit||execFileSync('git',['status','--porcelain','--','src'],{encoding:'utf8'}).trim())throw Error('candidate_source_not_frozen_at_released_commit');
if(before.task!==roundId||before.authorizedLimits?.requests!==150||before.authorizedLimits?.cny!==80||usedCny(before)>=80||cap===0)throw Error('global_authorization_exhausted_or_mismatched');
const runId=arg('run-id','');if(!/^[a-z0-9-]{6,80}$/.test(runId))throw Error('explicit_new_run_id_required');
const cohort=arg('cohort','first');if(!['first','retest'].includes(cohort))throw Error('invalid_cohort');
const firstRunFile=ROOT+'/acceptance-runs/FIRST_RUN.json';
if(cohort==='first'&&fs.existsSync(firstRunFile))throw Error('first_run_already_frozen_use_retest_without_relabelling');
if(cohort==='retest'&&!fs.existsSync(firstRunFile))throw Error('no_original_first_run_for_retest');
const resultTag=cohort==='first'?'FIRST':'RETEST';
const output=path.join(ROOT,'acceptance-runs',runId),runtime=path.resolve('.runtime','foundation-acceptance',runId);
fs.mkdirSync(path.dirname(output),{recursive:true});fs.mkdirSync(output);fs.mkdirSync(runtime,{recursive:true});
const state={runId,roundId,cohort,originalFirstRun:cohort==='first'?runId:read(firstRunFile).runId,startedAt:new Date().toISOString(),sourceCommit:candidateCommit,frozenHashes:manifest.frozenFiles,mode:'real_authenticated_App_HTTP_not_browser_UI',syntheticOwnership:true,hardwareActions:0,maxForwardedAttempts:cap,globalStartRequests:before.attempts.length,globalStartCny:usedCny(before),browserJourneys:'not_run',priorGatesStatus:release.priorGatesStatus||'not_claimed_by_this_runner',cases:[],errors:[],status:'started_not_accepted'};
writeNew(output+'/RUN_START.json',state);
let active,forwarded=0,gate,proxy,child;
const transport=[];
const safeError=e=>String(e?.message||e).slice(0,1000);
const flush=()=>fs.writeFileSync(output+'/RUN_PROGRESS.json',JSON.stringify({...state,forwardedAttempts:forwarded,globalNowRequests:ledger().attempts.length,globalNowCny:usedCny(ledger())},null,2)+'\n');
const bounded=()=>{const b=ledger();if(b.task!==roundId||b.attempts.length>=150||usedCny(b)>=80||forwarded>=cap)throw Error('acceptance_or_global_budget_exhausted');};
try{
 // Reuse one existing authorized gateway only if explicitly supplied. Otherwise
 // the existing helper owns the one task ledger and its exclusive lock.
 const existing=arg('gateway-url','');
 if(existing){if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(existing))throw Error('only_explicit_loopback_gateway');gate={url:existing,model:release.model||'qwen3.8-max-0902',close:async()=>{}};}
 else{const {foundationGateway}=await import('./gateway.mjs');gate=await foundationGateway({phase:'integration',recordContent:true});}
 if(release.model&&release.model!==gate.model)throw Error('released_model_mismatch');
 proxy=http.createServer(async(req,res)=>{
  let record;
  try{
   if(!active||req.method!=='POST'||req.headers.authorization!=='Bearer fixture-only'||req.headers.origin)throw Error('isolated_case_scope_required');
   if(!/\/(chat\/completions|responses|(?:text|multimodal)-generation\/generation)$/.test(req.url||''))throw Error('unsupported_model_route');
   bounded();let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>700000)throw Error('bounded_model_input_exceeded');}
   const body=JSON.parse(raw);if(body.model!==gate.model)throw Error('same_pinned_model_required');
   bounded();forwarded++;
   record={number:forwarded,caseId:active.caseId,arm:active.arm,at:new Date().toISOString(),inputSha256:digest(raw),inputBytes:Buffer.byteLength(raw),path:req.url,status:'forwarded'};transport.push(record);
   fs.appendFileSync(runtime+'/requests.jsonl',JSON.stringify({...record,input:body})+'\n');
   const upstream=await fetch(gate.url+req.url,{method:'POST',headers:{authorization:'Bearer fixture-only','content-type':'application/json','x-wujian-evaluation':runId+':'+active.caseId+':'+active.arm},body:raw,redirect:'error',signal:AbortSignal.timeout(150000)});
   record.httpStatus=upstream.status;res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/json'});
   for await(const part of upstream.body){if(!res.destroyed)res.write(part);}res.end();record.status='returned';
  }catch(e){if(record){record.status='failed';record.error=safeError(e);}if(!res.headersSent)res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'acceptance_request_stopped'}}));}
  finally{flush();}
 });
 await new Promise(ok=>proxy.listen(0,'127.0.0.1',ok));const proxyUrl='http://127.0.0.1:'+proxy.address().port;
 const port=arg('port','3248');if(!/^32\d\d$/.test(port))throw Error('isolated_port_required');const appUrl='http://127.0.0.1:'+port;
 const build=arg('build-dir','.next-foundation');if(!/^\.next-foundation[a-z0-9-]*$/.test(build)||!fs.existsSync(path.join(build,'BUILD_ID')))throw Error('verified_production_build_required');
 const log=fs.openSync(runtime+'/app.log','wx');
 child=spawn(process.execPath,['--import',pathToFileURL(path.resolve('scripts/alpha/network-hook.mjs')).href,'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',port],{windowsHide:true,stdio:['ignore',log,log],env:{...process.env,AUTH_MODE:'authenticated',PRODUCT_AGENT_DATA_DIR:path.join(runtime,'data'),WUJIAN_BUILD_DIR:build,AI_ALLOW_PAID_CALLS:'true',WUJIAN_ALLOW_PAID_CALLS:'true',AI_API_KEY:'fixture-only',AI_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',AI_MODEL:gate.model,AI_TASK_MODEL:gate.model,AI_CREATIVE_MODEL:gate.model,AI_STRUCTURED_OUTPUT:'json_schema',AI_REQUEST_TIMEOUT_MS:'75000',WUJIAN_AGENT_RUNTIME:'native',WUJIAN_PRACTICAL_THINKING:'false',WUJIAN_ALLOW_PUBLIC_FETCH:'true',WUJIAN_ALLOW_SEARCH:'true',WUJIAN_EXPERIMENTAL_FACT_QA:'false',ALPHA_GATEWAY:proxyUrl,NEXT_TELEMETRY_DISABLED:'1',LANGSMITH_TRACING:'false',LANGCHAIN_TRACING_V2:'false'}});
 let ready=false;for(let n=0;n<90;n++){if(child.exitCode!==null)throw Error('isolated_app_exited');try{const r=await fetch(appUrl+'/api/account');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}if(!ready)throw Error('isolated_app_not_ready');
 const register=await fetch(appUrl+'/api/account',{method:'POST',headers:{'content-type':'application/json',origin:appUrl},body:JSON.stringify({action:'register',name:'holdout-'+randomBytes(8).toString('hex'),password:randomBytes(24).toString('hex')})});
 const account=await register.json(),cookie=register.headers.get('set-cookie')?.split(';')[0];if(!register.ok||!account.account?.id?.startsWith('u_')||!cookie)throw Error('real_isolated_test_account_failed');
 async function api(route,body){return fetch(appUrl+route,{method:'POST',headers:{cookie,origin:appUrl,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(190000)});}
 const owned=new Map();
 for(const p of questions.products){const response=await api('/api/life',{action:'createItem',input:{requestId:randomUUID(),name:'[模拟持有] '+p.brand+' '+p.model,brand:p.brand,model:p.model,category:p.category,region:'unspecified',lifecycle:'长期耐用',availability:'available',ownsConfirmed:true,synthetic:true}});const data=await response.json();if(!response.ok||data.item?.model!==p.model||data.item?.synthetic!==true||data.item?.owner!==account.account.id)throw Error('fixture_identity_scope_failed');owned.set(p.id,data.item);}
 writeNew(output+'/FIXTURE_CHECK.json',{at:new Date().toISOString(),actualItemIds:Object.fromEntries([...owned].map(([id,item])=>[id,{id:item.id,model:item.model,synthetic:item.synthetic,ownerVerified:true}])),inputURLSeeds:0,manualAnswersInjected:false,sourceRegion:'unspecified_at_intake_manual_region_requires_runtime_scope_check'});
 if(cohort==='first')writeNew(firstRunFile,{runId,sourceCommit:candidateCommit,questionsSha256:manifest.frozenFiles['questions.frozen.json'],startedAt:new Date().toISOString(),notice:'Authoritative first cohort; later runs cannot replace or relabel these first answers.'});
 // Complete all first answers before spending the remaining budget on direct controls.
 for(const c of questions.cases){
  const record={caseId:c.id,productId:c.productId,question:c.prompt,arm:'product',at:new Date().toISOString(),status:'not_run',quality:'not_scored',browserVerified:false};
  const start=performance.now(),firstBefore=ledger().attempts.length;
  try{
   bounded();active={caseId:c.id,arm:'product'};writeNew(output+'/'+c.id+'.product.START.json',{...record,requestStart:firstBefore});
   const response=await api('/api/assistant',{requestId:randomUUID(),itemId:owned.get(c.productId).id,question:c.prompt,mode:'service',memoryPolicy:'off',uiContext:{page:'item',useItemMemories:false}});
   record.httpStatus=response.status;record.result=await assistantResponse(response);record.status='returned_not_scored';
  }catch(e){record.error=safeError(e);record.status=forwarded>=cap||ledger().attempts.length>=150||/budget_exhausted/.test(record.error)?'blocked_budget':'failed';}
  finally{record.fullAnswerMs=Math.round(performance.now()-start);record.upstreamNumbers=ledger().attempts.slice(firstBefore).map(a=>a.number);record.transport=transport.filter(t=>t.caseId===c.id&&t.arm==='product');active=undefined;writeNew(output+'/'+c.id+'.product.'+resultTag+'.json',record);state.cases.push({caseId:c.id,arm:'product',status:record.status});flush();}
 }
 const {default:OpenAI}=await import('openai');
 const direct=new OpenAI({apiKey:'fixture-only',baseURL:proxyUrl+'/direct/v1',maxRetries:0,timeout:90000});
 for(const c of questions.cases){
  const record={caseId:c.id,productId:c.productId,question:c.prompt,arm:'direct',at:new Date().toISOString(),status:'not_run',quality:'not_scored',browserVerified:false};
  const start=performance.now(),directBefore=ledger().attempts.length;
  try{
   bounded();const tagged=ledger().attempts.filter(a=>a.evaluation===runId+':'+c.id+':product');
   const finalInput=tagged.findLast(a=>a.kind==='inference'&&a.tools?.length&&Array.isArray(a.input));
   if(!finalInput)throw Error('no_equivalent_product_model_context_recorded');
   const material=finalInput.input.filter(m=>['user','tool'].includes(m.role)).filter(m=>m.content!=null).map(m=>({role:'user',content:m.content}));
   if(!material.length)throw Error('no_equivalent_material');
   record.sameInformation={productRequestNumber:finalInput.number,materialSha256:digest(JSON.stringify(material)),method:'exact user/tool content of final product tool-loop request; excludes system policy and assistant drafts',caveat:'same effective supplied context, not independently rediscovered sources or equivalent runtime instructions'};
   active={caseId:c.id,arm:'direct'};writeNew(output+'/'+c.id+'.direct.START.json',{...record,requestStart:directBefore});
   const r=await direct.chat.completions.create({model:gate.model,messages:[{role:'system',content:'请根据提供的同等物品与官方资料回答用户当前问题。完整而自然，明确证据不足/适用条件；不要编造型号操作，不宣称实际执行。'},...material,{role:'user',content:c.prompt}],max_tokens:2400,temperature:0.35,enable_thinking:false});
   record.text=r.choices?.[0]?.message?.content||'';record.finishReason=r.choices?.[0]?.finish_reason;record.usage=r.usage;record.model=r.model;record.status='returned_not_scored';
  }catch(e){record.error=safeError(e);record.status=forwarded>=cap||ledger().attempts.length>=150?'blocked_budget':'failed';}
  finally{record.fullAnswerMs=Math.round(performance.now()-start);record.upstreamNumbers=ledger().attempts.slice(directBefore).map(a=>a.number);record.transport=transport.filter(t=>t.caseId===c.id&&t.arm==='direct');active=undefined;writeNew(output+'/'+c.id+'.direct.'+resultTag+'.json',record);state.cases.push({caseId:c.id,arm:'direct',status:record.status});flush();}
 }
 state.status='execution_recorded_quality_and_browser_not_scored';
}catch(e){state.errors.push(safeError(e));state.status='blocked_or_failed_not_accepted';process.exitCode=1;}
finally{
 if(child){child.kill();await new Promise(r=>{if(child.exitCode!==null)r();else{child.once('exit',r);setTimeout(r,5000);}});}
 if(proxy)await new Promise(r=>proxy.close(r));if(gate)await gate.close();
 state.finishedAt=new Date().toISOString();state.forwardedAttempts=forwarded;state.actualUpstreamRequests=ledger().attempts.length-before.attempts.length;state.estimatedCnyDelta=usedCny(ledger())-usedCny(before);
 writeNew(output+'/RUN_FINAL.json',state);flush();console.log(JSON.stringify({runId,status:state.status,recordedCases:state.cases.length,actualUpstreamRequests:state.actualUpstreamRequests,forwardedAttempts:forwarded,productAcceptance:'not_scored',browserJourneys:'not_run'}));
}
