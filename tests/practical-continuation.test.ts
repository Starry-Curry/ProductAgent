import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {acquireKnowledge} from '../src/lib/life/acquisition.ts';
import {extractPublicHTML} from '../src/lib/life/sources.ts';
import {gateway} from '../scripts/real-intelligence/gateway.mjs';
import {readSearchResponse} from '../src/lib/ai/provider.ts';

test('搜索流只采纳实际来源元数据，跨分块按钮与URL均不从生成正文猜测',async()=>{
 const packet='data: '+JSON.stringify({output:{choices:[{message:{content:[{text:'https://fake.example/guessed'}]}}],search_info:{search_results:[{url:'https://helpguide.sony.net/actual',title:'真实命中'}]}},usage:{input_tokens:23,output_tokens:4}})+'\r\n\r\n';const bytes=new TextEncoder().encode(packet);
 const r=await readSearchResponse(new Response(new ReadableStream({start(c){for(let n=0;n<bytes.length;n+=7)c.enqueue(bytes.slice(n,n+7));c.close();}}),{headers:{'content-type':'text/event-stream'}}));
 assert.equal(r.output.search_info.search_results.length,1);assert.equal(r.usage.input_tokens,23);assert.doesNotMatch(JSON.stringify(r),/fake.example/);
});

test('失效种子不截断未知型号官方发现；重复URL不重试；搜索正文不能替代实际原文',async()=>{
 const f=validationFixture('.runtime/continuation-discovery-'+crypto.randomUUID());try{
 const bad='https://www.sony.com/broken.pdf',good='https://helpguide.sony.net/new/manual.html',id=f.add('合成陌生音箱','其他','Sony','NEW-871',{supportUrl:bad});const reads:string[]=[];let searches=0;
 const result=await acquireKnowledge(f.db,f.read,'lin',id,{seedURLs:[bad],fetchDocument:async u=>{reads.push(u);if(u!==good)throw Error('offline_404');return {url:u,title:'NEW-871 Help Guide',text:'NEW-871: Press the power button to start. Unrelated policy links are not operating instructions.',links:[]};},search:async()=>{searches++;return{hits:[{title:'Official guide',url:good},{title:'Untrusted summary',url:'https://thirdparty.example/manual.pdf'}],model:'offline-substitute',tokens:null,usage:null};}});
 assert.equal(searches,1);assert.equal(reads.filter(u=>u===bad).length,1);assert.equal(result.documents.length,1);assert.equal(result.documents[0].url,good);assert.equal(result.acquisition?.searchCompleted,true);
 }finally{f.db.close();}
});

test('HTML保留按钮替代文字和同册真实章节；无替代文字的图示明确缺失，不假装理解',async()=>{
 const d=await extractPublicHTML('<title>NEW-871 Guide</title><main><p>按<img src="power.png" alt="电源 ⏻">两秒。按<img src="unknown.png" alt="">选择方向。</p><a href="chapter.html">Music playback</a></main>','https://helpguide.sony.net/mdr/test/v1/en/index.html');
 assert.match(d.text,/电源 ⏻/);assert.match(d.text,/图示未读取/);assert.equal(d.reading.limitations.length,1);assert.ok(d.links.some(l=>l.url.endsWith('/chapter.html')));
});

test('原生官方搜索进入同一费用台账，保留真实来源字段和附加搜索费（离线HTTP替身）',async t=>{
 const root=path.resolve('.runtime/continuation-budget-'+crypto.randomUUID());fs.mkdirSync(root,{recursive:true});const config=path.join(root,'.env.local');fs.writeFileSync(config,'AI_API_KEY=fixture-only\nAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1\nAI_MODEL=qwen3.8-max-0902\n');
 const real=globalThis.fetch;let endpoint='';globalThis.fetch=(async(u:any,init:any)=>{if(String(u).endsWith('/models'))return Response.json({data:[{id:'qwen3.8-max-0902'}]});endpoint=String(u);assert.equal(JSON.parse(init.body).parameters.max_tokens,180);return Response.json({output:{choices:[{message:{role:'assistant',content:'search summary not trusted'},finish_reason:'stop'}],search_info:{search_results:[{url:'https://helpguide.sony.net/new',title:'Actual source'}]}},usage:{input_tokens:10,output_tokens:1}});}) as typeof fetch;t.after(()=>{globalThis.fetch=real;});
 const g=await gateway(config,{root,model:'qwen3.8-max-0902',prices:{input:12,output:36},lockFile:path.join(root,'lock'),limits:{roundId:'offline-search',requests:1,cny:15}});t.after(()=>g.close());
 const r=await real(g.url+'/browser/text-generation/generation',{method:'POST',headers:{Authorization:'Bearer fixture-only','Content-Type':'application/json'},body:JSON.stringify({model:g.model,input:{messages:[{role:'user',content:'NEW-871 official manual'}]},parameters:{enable_search:true,max_tokens:180,search_options:{search_strategy:'turbo',forced_search:true,enable_source:true}}})});assert.equal(r.status,200);assert.equal((await r.json()).output.search_info.search_results.length,1);assert.match(endpoint,/\/api\/v1\/services\/aigc\/text-generation\/generation$/);const a=JSON.parse(fs.readFileSync(path.join(root,'model-calls.json'),'utf8')).attempts;assert.equal(a.length,1);assert.equal(a[0].kind,'official_search');assert.equal(a[0].tokens.prompt_tokens,10);assert.equal(a[0].estimatedCny,0.003156);
});
