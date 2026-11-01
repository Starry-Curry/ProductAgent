import fs from 'node:fs';import {qwenResearch} from '../../src/lib/ai/qwen-native.ts';import {outcomeGateway,ROOT} from './gateway.mjs';
const target=ROOT+'/native-targeted.json';if(fs.existsSync(target))throw Error('preserve_evidence');
const prior=JSON.parse(fs.readFileSync(ROOT+'/responses-search.json','utf8'));
const page=prior.sources.find((s:any)=>{try{return ['support.brother.com','help.brother-usa.com','www.brother-usa.com'].includes(new URL(s.url).hostname)&&!s.url.endsWith('.pdf');}catch{return false;}})?.url;
if(!page)throw Error('actual_structured_source_missing');
const gate=await outcomeGateway({recordContent:true}),events:any[]=[],report:any={at:new Date().toISOString(),page,basis:'closed_scope_native_extraction_from_prior_structured_source',events};
try{report.result=await qwenResearch({AI_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',AI_API_KEY:'fixture-only',AI_MODEL:gate.model,AI_ALLOW_PAID_CALLS:'true',WUJIAN_ALLOW_PAID_CALLS:'true',WUJIAN_ALLOW_SEARCH:'true'},(url,init)=>fetch(gate.url+'/v1/'+String(url).split('/v1/')[1],{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),'x-wujian-evaluation':'native-targeted'}}),'页面标题和提到的应用名称，没标明型号或日期就明确未知；只读本页面，不打开PDF。',['brother.com','brother-usa.com'],page,e=>events.push(e));}
catch(e){report.error={name:(e as Error).name,message:(e as Error).message};process.exitCode=1;}
finally{fs.writeFileSync(target,JSON.stringify(report,null,2));await gate.close();console.log(JSON.stringify({error:report.error,events:events.length,status:report.result?.status,types:[...new Set(events.map(e=>e.itemType).filter(Boolean))]}));}
