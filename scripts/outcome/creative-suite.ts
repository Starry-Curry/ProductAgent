import fs from 'node:fs';import {createHash} from 'node:crypto';
import {validationFixture} from '../life-validation-fixture.ts';import {createProvider} from '../../src/lib/ai/provider.ts';import {respond as currentRespond} from '../../src/lib/agent/service.ts';import {createTask} from '../../src/lib/foundation/tasks.ts';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {outcomeGateway,ROOT} from './gateway.mjs';
const stage=process.argv.find(a=>a.startsWith('--stage='))?.slice(8)||'baseline-f0';
if(!/^[a-z0-9-]+$/.test(stage)||fs.existsSync(ROOT+'/'+stage+'.json'))throw Error('unique_stage_required');
const text=fs.readFileSync('docs/engineering/outcome-qwen-2026-11-02/acceptance-frozen.json');if(createHash('sha256').update(text).digest('hex')!==fs.readFileSync('docs/engineering/outcome-qwen-2026-11-02/acceptance-frozen.sha256','utf8').trim())throw Error('frozen_set_changed');
const cases=JSON.parse(text.toString()).creative,gate=await outcomeGateway({recordContent:true});
const baseline=process.argv.includes('--baseline');
const respond=baseline?(await import(pathToFileURL(path.resolve('.runtime/baseline-f0/src/lib/agent/service.ts')).href)).respond:currentRespond;
Object.assign(process.env,{AI_ALLOW_PAID_CALLS:'true',WUJIAN_ALLOW_PAID_CALLS:'true',WUJIAN_AGENT_RUNTIME:'native',WUJIAN_PRACTICAL_THINKING:process.env.OUTCOME_THINKING||'true',WUJIAN_ALLOW_PUBLIC_FETCH:'false',WUJIAN_ALLOW_SEARCH:'false',AUTH_MODE:'authenticated'});
const result:any={stage,basis:'real_qwen_isolated_domain_service_synthetic_facts_not_browser_or_physical',startedAt:new Date().toISOString(),cases:[]};
try{for(const c of cases){
 const f=validationFixture('.runtime/acceptance-'+stage+'-'+c.id);let s=f.read();s.items=[];s.plans=[];s.tasks=[];f.write(s);
 const ids=new Map<string,string>();for(const i of c.items){
  const id=f.add('[模拟持有]'+i.name,'其他','','待确认',{attributes:{physicalFacts:[{id:crypto.randomUUID(),key:'contents',component:'用户登记的结构与状态说明',value:i.facts,basis:'user_report'}]}});ids.set(i.id,id);
  const state=f.read();const registered=state.items.find(x=>x.id===id)!;registered.synthetic=true;f.write(state);
  if(f.read().items.find(x=>x.id===id)?.attributes?.physicalFacts?.[0]?.value!==i.facts)throw Error('fixture_dropped_frozen_facts');
 }
 const focus=c.focus?ids.get(c.focus):undefined;
 const task=c.entry==='single_item'?createTask(f.db,f.read,'lin',{requestId:crypto.randomUUID(),goal:c.goal,intent:'explore',itemInstanceIds:[focus!]}):undefined;
 const provider=createProvider({AI_ALLOW_PAID_CALLS:'true',WUJIAN_ALLOW_PAID_CALLS:'true',AI_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',AI_API_KEY:'fixture-only',AI_MODEL:gate.model},(url,init)=>fetch(gate.url+'/v1/'+String(url).split('/v1/')[1],{...init,headers:{...Object.fromEntries(new Headers(init?.headers)), 'x-wujian-evaluation':stage+':'+c.id}}));
 const start=Date.now();try{const r=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),question:c.goal,itemId:focus,taskId:task?.taskId,mode:'auto',memoryPolicy:'off',uiContext:{page:focus?'item':'assistant'}},provider);result.cases.push({id:c.id,input:c,resourceIds:Object.fromEntries(ids),result:r,elapsedMs:Date.now()-start});console.log(c.id+' '+r.reply.outcome+' '+(Date.now()-start)+'ms');}catch(e){result.cases.push({id:c.id,error:(e as Error).message,elapsedMs:Date.now()-start});console.log(c.id+' failed');}finally{f.db.close();fs.writeFileSync(ROOT+'/'+stage+'.json',JSON.stringify(result,null,2));}
 }}finally{await gate.close();}
