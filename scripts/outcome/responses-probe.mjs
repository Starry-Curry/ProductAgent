import fs from 'node:fs';import OpenAI from 'openai';import {outcomeGateway,ROOT} from './gateway.mjs';
const stage=process.argv.find(a=>a.startsWith('--stage='))?.slice(8)||'responses-basic';if(!/^[a-z0-9-]+$/.test(stage)||fs.existsSync(ROOT+'/'+stage+'.json'))throw Error('unique_stage_required');
const tools=stage==='responses-basic'?[]:stage==='responses-search'?[{type:'web_search'}]:[{type:'web_search'},{type:'web_extractor'}];
const gate=await outcomeGateway({recordContent:true}),client=new OpenAI({apiKey:'fixture-only',baseURL:gate.url+'/v1',maxRetries:0,timeout:155000});
const report={stage,startedAt:new Date().toISOString(),events:[],sources:[]},start=Date.now();
try{
 const stream=await client.responses.create({model:gate.model,input:tools.length?'查找Brother PT-P710BT官方用户指南，确认它与手机首次连接时在哪个App操作。必须实际搜索'+(tools.length>1?'并读取官方正文':'')+'；不要编造来源。':'只回答：连接验证成功。',stream:true,store:false,max_output_tokens:8192,max_tool_calls:3,tools,...(tools.length>1?{reasoning:{effort:'low'}}:{enable_thinking:false})},{headers:{'x-wujian-evaluation':stage}});
 for await(const e of stream){report.events.push({type:e.type,elapsedMs:Date.now()-start,itemType:e.item?.type});if(e.type==='response.output_item.done'&&e.item?.type!=='reasoning'){(report.partialOutput??=[]).push(e.item);}if(e.type==='response.completed'||e.type==='response.incomplete'){report.status=e.response.status;report.usage=e.response.usage;report.output=e.response.output.filter(i=>i.type!=='reasoning');report.sources=report.output.filter(i=>i.type==='web_search_call').flatMap(i=>i.action?.sources||[]);}}
 if(!report.status)throw Error('terminal_response_missing_not_success');
}catch(e){report.error={name:e.name,status:e.status,message:String(e.message).slice(0,500)};process.exitCode=1;}
finally{report.elapsedMs=Date.now()-start;fs.writeFileSync(ROOT+'/'+stage+'.json',JSON.stringify(report,null,2));await gate.close();console.log(JSON.stringify({stage,status:report.status,error:report.error,events:report.events.length,sources:report.sources.length,elapsedMs:report.elapsedMs}));}
