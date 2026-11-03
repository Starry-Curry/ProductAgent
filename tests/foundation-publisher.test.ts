import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {discoverPublishers,publisherOwns} from '../src/lib/life/publisher.ts';
const entity='http://dbpedia.org/resource/Synthetic_Maker';
const record=JSON.stringify({[entity]:{'http://www.w3.org/1999/02/22-rdf-syntax-ns#type':[{value:'http://dbpedia.org/ontology/Company'}],'http://www.w3.org/2000/01/rdf-schema#label':[{value:'Synthetic Maker'}],'http://xmlns.com/foaf/0.1/homepage':[{type:'uri',value:'https://old-maker.example/'}]}});
const proof={version:1 as const,brand:'Synthetic Maker',directoryURL:'https://dbpedia.org/data/Synthetic_Maker.json',entity,record,recordHash:createHash('sha256').update(record).digest('hex'),homepage:'https://old-maker.example/',redirectChain:['https://old-maker.example/','https://new-maker.example/'],verifiedAt:'2026-11-03'};
test('generic directory publisher proof binds brand, independent entity, TLS migration and exact host, never lookalikes/community',()=>{
 assert.equal(publisherOwns('https://support.new-maker.example/manual','Synthetic Maker',proof),true);
 for(const [url,brand]of [['https://evil-new-maker.example/manual','Synthetic Maker'],['https://community.new-maker.example/manual','Synthetic Maker'],['https://new-maker.example/forums/post','Synthetic Maker'],['https://new-maker.example/manual','Other Maker']])assert.equal(publisherOwns(url,brand,proof),false);
 assert.equal(publisherOwns('https://new-maker.example','Synthetic Maker',{...proof,record:record+' '}),false);
 assert.equal(publisherOwns('https://new-maker.example','Synthetic Maker',{...proof,directoryURL:'https://evil.example/data/Synthetic_Maker.json'}),false);
});
test('generic discovery gets structured company record; native search URL and model declaration alone cannot authenticate publisher',async()=>{
 const calls:string[]=[];
 const r=await discoverPublishers('Synthetic Maker',['https://new-maker.example/model-77'],{fetchDocument:async url=>{calls.push(url);return {url,title:'offline directory',text:url.includes('lookup.')?JSON.stringify({docs:[{resource:[entity],label:['Synthetic Maker']}]}):record,links:[]};},resolveHomepage:async homepage=>({url:'https://new-maker.example/',chain:[homepage,'https://new-maker.example/']})});
 assert.equal(r.proofs.length,1);assert.equal(calls.length,2);
 const wrong=await discoverPublishers('Synthetic Maker',['https://unverified.example'],{fetchDocument:async url=>({url,title:'offline',text:JSON.stringify({docs:[]}),links:[]})});assert.equal(wrong.proofs.length,0);
});

import {extractPublicHTML} from '../src/lib/life/sources.ts';
test('single-page manual keeps actual section index and reads selected article, without silently substituting the first truncated page',async()=>{
 const raw='<html><title>UNSEEN-731 Operation Manual</title><body><main><article id="intro"><h2>Introduction</h2><p>'+('unrelated text '.repeat(4000))+'</p></article><article id="actual-section"><h2>Operating the control</h2><p>UNSEEN-731. Release the lever before moving it.</p><img src="/figure.svg" alt="lever diagram"/></article></main></body></html>';
 const full=await extractPublicHTML(raw,'https://new-maker.example/manual/');assert.ok(full.links.some(l=>l.url.endsWith('#actual-section')));
 const focused=await extractPublicHTML(raw,'https://new-maker.example/manual/#actual-section');assert.match(focused.text,/Release the lever/);assert.ok(!focused.text.includes('unrelated text'));assert.equal(focused.reading.figures.length,1);
});

import {officialDomain} from '../src/lib/life/knowledge.ts';
test('旧目录也按完整品牌身份匹配，不能用嵌入Sony字符串伪造厂家',()=>{
 assert.equal(officialDomain('https://www.sony.com/manual','Sony'),true);assert.equal(officialDomain('https://www.sony.com/manual','FAKE-SONY-FORGED'),false);
});
