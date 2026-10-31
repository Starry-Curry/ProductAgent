import fs from 'node:fs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {practicalGateway,ROOT} from './gateway.mjs';
import {validationFixture} from '../life-validation-fixture.ts';
import {fetchPublicDocument} from '../../src/lib/life/sources.ts';
import {makeKnowledgeDocument,storeOfficialDocument} from '../../src/lib/life/acquisition.ts';
import {createProvider} from '../../src/lib/ai/provider.ts';
import {respond} from '../../src/lib/agent/service.ts';
import {PRACTICAL_SYSTEM} from '../../src/lib/agent/practical.ts';
if(!process.argv.includes('--authorized-60-cny15'))throw Error('current_authorization_required');
const stage=process.argv.find(s=>s.startsWith('--stage='))?.slice(8)||'small-comparison';if(!/^[a-z0-9-]+$/.test(stage))throw Error('invalid_stage');const file=ROOT+'/'+stage+'.json';if(fs.existsSync(file))throw Error('preserve_previous_evidence');
const gate=await practicalGateway(),scope=new AsyncLocalStorage<{label:string;inputs:any[]}>();
const provider=createProvider({AI_BASE_URL:'https://fixture.invalid/v1',AI_API_KEY:'fixture-only',AI_MODEL:gate.model,AI_TASK_MODEL:gate.model,AI_CREATIVE_MODEL:gate.model,AI_ALLOW_PAID_CALLS:'true',AI_JSON_MODE:'true',AI_ENABLE_THINKING:'false'},(_url,init)=>{
 const s=scope.getStore();if(!s)throw Error('missing_label');s.inputs.push(JSON.parse(String(init?.body)));const headers=new Headers(init?.headers);headers.set('x-wujian-evaluation',s.label);return fetch(gate.url+'/eval/v1/chat/completions',{...init,headers});
});
const report:any={at:new Date().toISOString(),model:gate.model,syntheticOwnership:true,physicalTests:0,sameMaterials:'三个分支使用同一隔离物品和真实获取的完整文档；直接模型使用新执行器首回合同一输入、同一系统提示和同一温度/输出预算，禁用工具。旧默认路径按原有检索与格式执行；差异记录在请求台账。',sources:[],rows:[]};
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
async function run(id:string,arm:string,fn:()=>Promise<any>){const s={label:stage+'/'+id+'/'+arm,inputs:[] as any[]},start=performance.now();let result,error;await scope.run(s,async()=>{try{result=await fn();}catch(e){error=(e as Error).message;}});const calls=JSON.parse(fs.readFileSync(ROOT+'/model-calls.json','utf8')).attempts.filter((a:any)=>a.evaluation===s.label);report.rows.push({id,arm,result,error,elapsedMs:Math.round(performance.now()-start),requests:calls.length,attempts:calls.map((a:any)=>a.number),tokens:calls.map((a:any)=>a.tokens),estimatedCny:calls.reduce((n:number,a:any)=>n+(a.estimatedCny??a.reservedCny),0)});save();console.log(id,arm,error||'returned',calls.length);return s.inputs;}
process.env.WUJIAN_ALLOW_PUBLIC_FETCH='false';process.env.WUJIAN_EXPERIMENTAL_KERNEL_V3='false';process.env.WUJIAN_EXPERIMENTAL_FACT_QA='false';
try{for(const c of [
 {id:'sony-pair',brand:'Sony',model:'WH-CH520',urls:['https://helpguide.sony.net/mdr/2958/v1/en/contents/TP1000776852.html','https://helpguide.sony.net/mdr/2958/v1/en/contents/TP1000783325.html'],question:'这副WH-CH520以前连过另一台手机，现在怎样重新配对新手机？请给完整步骤。'},
 {id:'canon-paper',brand:'Canon',model:'SELPHY CP1500',urls:['https://cam.start.canon/en/P001/manual/html/UG-01_Preparations_0030.html'],question:'SELPHY CP1500装相纸时，光面朝哪边、最多放多少张、纸盒内盖和外盖各怎么处理？请完整回答。'}
]){
 const f=validationFixture('.runtime/practical-compare-'+c.id+'-'+Date.now());try{
 const id=f.add('[合成持有]'+c.model,'其他',c.brand,c.model),item=f.read().items.find(i=>i.id===id)!;
 for(const url of c.urls){try{const page=await fetchPublicDocument(url);storeOfficialDocument(f.db,'lin',item,makeKnowledgeDocument(page,item,[url]));report.sources.push({caseId:c.id,url:page.url,characters:page.text.length,success:true});}catch(e){report.sources.push({caseId:c.id,url,success:false,error:(e as Error).message});throw e;}}
 process.env.WUJIAN_AGENT_RUNTIME='native';const requests=await run(c.id,'new-native',()=>respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:c.question,mode:'auto',memoryPolicy:'off'},provider));
 if(requests.length)await run(c.id,'direct-same-material',()=>provider.converse!([{role:'system',content:PRACTICAL_SYSTEM},requests[0].messages.find((m:any)=>m.role==='user')],[],{maxTokens:2400,timeoutMs:45000,toolChoice:'none'}));
 process.env.WUJIAN_AGENT_RUNTIME='legacy';await run(c.id,'original-default',()=>respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:c.question,mode:'auto',memoryPolicy:'off'},provider));
 }finally{f.db.close();}
}}finally{save();await gate.close();}
