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

test('对抗厂家链：多语言公司目录的旧主页失效时，可用独立Wikidata官方站点，不信任搜索声明',async()=>{
 const entity='http://fr.dbpedia.org/resource/Synthetic_Maker';
 const fields={'http://www.w3.org/1999/02/22-rdf-syntax-ns#type':[{value:'http://dbpedia.org/ontology/Company'}],'http://www.w3.org/2000/01/rdf-schema#label':[{value:'Synthetic Maker'}],'http://xmlns.com/foaf/0.1/homepage':[{type:'uri',value:'https://old-maker.example/'}],'http://www.w3.org/2002/07/owl#sameAs':[{type:'uri',value:'http://www.wikidata.org/entity/Q1234'}]};
 const e={id:'Q1234',labels:{en:{value:'Synthetic Maker'}},aliases:{},claims:{P31:[{rank:'normal',mainsnak:{datavalue:{value:{id:'Q4830453'}}}}],P856:[{rank:'normal',mainsnak:{snaktype:'value',datavalue:{value:'http://new-maker.example/'}}}]}};
 const resolveCalls:string[]=[];
 const result=await discoverPublishers('Synthetic Maker',['https://support.new-maker.example/manual'],{
  fetchDocument:async url=>({url,title:'synthetic directory',links:[],text:url.includes('lookup.')?JSON.stringify({docs:[{label:['Synthetic Maker'],resource:[entity]}]}):url.includes('wikidata.org')?JSON.stringify({entities:{Q1234:e}}):JSON.stringify({[entity]:fields})}),
  resolveHomepage:async url=>{resolveCalls.push(url);if(url.includes('old-maker'))throw Error('synthetic_404');return {url,chain:[url]};},
 });
 assert.equal(result.proofs.length,1);const p=result.proofs[0];assert.equal(p.version,2);
 assert.ok(resolveCalls.includes('https://new-maker.example/'),'仅升级同域到TLS，不请求HTTP');
 assert.equal(publisherOwns('https://support.new-maker.example/manual','Synthetic Maker',p),true);
 for(const changed of [{entity:'Q9999'},{directoryURL:'https://wikidata.org.evil.example/wiki/Special:EntityData/Q1234.json'},{homepage:'https://attacker.example/'},{brand:'Other Maker'}])assert.equal(publisherOwns('https://new-maker.example/manual','Synthetic Maker',{...p,...changed}),false);
 for(const entityChange of [{...e,labels:{en:{value:'Other Maker'}}},{...e,claims:{...e.claims,P31:[]}},{...e,claims:{...e.claims,P856:[{...e.claims.P856[0],rank:'deprecated'}]}}]){
  const record=JSON.stringify({entities:{Q1234:entityChange}});assert.equal(publisherOwns('https://new-maker.example/manual','Synthetic Maker',{...p,record,recordHash:createHash('sha256').update(record).digest('hex')}),false);
 }
 assert.equal(publisherOwns('https://community.new-maker.example/manual','Synthetic Maker',p),false);
});
