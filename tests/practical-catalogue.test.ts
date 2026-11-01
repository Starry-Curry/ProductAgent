import test from 'node:test';import assert from 'node:assert/strict';
import {extractPublicHTML} from '../src/lib/life/sources.ts';
import {findOfficial} from '../src/lib/life/knowledge.ts';
import {readSearchResponse} from '../src/lib/ai/provider.ts';
test('无href的公开型号控件保留为ID，不虚构成真实链接',async()=>{
 const d=await extractPublicHTML('<title>Official catalogue</title><main><a id="item_C999">EOS TEST 900</a><p>Choose your product for manuals.</p></main>','https://cam.start.canon/en/');assert.deepEqual(d.navigationItems,[{id:'item_C999',label:'EOS TEST 900'}]);assert.equal(d.links.length,0);
});
test('陌生目录型号经实时ID映射、实际手册及JSON章节核对，无预置SKU答案',async()=>{
 const reads:string[]=[];const result=await findOfficial({brand:'Canon',model:'EOS TEST 900'},async url=>{reads.push(url);if(url==='https://cam.start.canon/en/')return {url,title:'Live catalogue',text:'Catalogue of available models.',links:[],navigationItems:[{id:'item_C998',label:'EOS TEST 900 II'},{id:'item_C999',label:'EOS TEST 900'}]};if(url.endsWith('/js/contents.json'))return {url,title:'Navigation',text:JSON.stringify([{title:'Movie shooting',link:'movie.html'},{title:'wrong scope',link:'https://evil.example/a.html'},{title:'wrong model',link:'../../other/index.html'}]),links:[]};return {url,title:'Canon : EOS TEST 900',text:'EOS TEST 900 firmware 9.0 or later. Advanced User Guide.',links:[]};});
 assert.equal(result.documents.length,1);assert.equal(result.documents[0].links.length,1);assert.ok(result.documents[0].links[0].url.endsWith('/C999/manual/html/movie.html'));assert.equal(reads.some(u=>u.includes('C998')),false);assert.ok(result.discoveryChains[result.documents[0].url].includes('manufacturer_catalogue_id:item_C999'));
});
test('目录ID候选若返回别的型号，拒绝采用；动态目录不是来源事实认证',async()=>{
 const result=await findOfficial({brand:'Canon',model:'EOS TEST 900'},async url=>({url,title:url.endsWith('/en/')?'Catalogue':'EOS WRONG 901',text:'Public manufacturer document for a different product.',links:[],navigationItems:[{id:'item_C999',label:'EOS TEST 900'}]}));assert.equal(result.documents.length,0);
});
test('结构化搜索来源可在顶层流字段返回，生成正文的URL仍不采纳',async()=>{
 const r=await readSearchResponse(new Response('data: '+JSON.stringify({search_info:{search_results:[{title:'Actual hit',url:'https://canon.com/actual'}]},output:{choices:[{message:{content:'https://fake.example/guess'}}]}})+'\n\n',{headers:{'content-type':'text/event-stream'}}));assert.equal(r.output.search_info.search_results.length,1);assert.doesNotMatch(JSON.stringify(r),/fake.example/);
});
