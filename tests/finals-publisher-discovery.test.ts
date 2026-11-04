import test from 'node:test';import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {acquireKnowledge} from '../src/lib/life/acquisition.ts';
import {publisherOwns} from '../src/lib/life/publisher.ts';

test('对抗发现：第一批搜索没有厂家站点时，独立目录验证出的站点可启动一次范围内搜索；不认证原命中',async t=>{
 const f=validationFixture('.runtime/finals-publisher-search-'+crypto.randomUUID());t.after(()=>f.db.close());
 const brand='Synthetic Unseen Manufacturer',model='UNSEEN-PUBLISHER-91';
 const id=f.add('[合成]陌生设备','其他',brand,model),entity='http://dbpedia.org/resource/Synthetic_Unseen_Manufacturer';
 const record=JSON.stringify({[entity]:{'http://www.w3.org/1999/02/22-rdf-syntax-ns#type':[{value:'http://dbpedia.org/ontology/Company'}],'http://www.w3.org/2000/01/rdf-schema#label':[{value:brand}],'http://xmlns.com/foaf/0.1/homepage':[{type:'uri',value:'https://real-manufacturer.example/'}]}});
 const queries:{q:string;sites:string[]}[]=[];
 const result=await acquireKnowledge(f.db,f.read,'lin',id,{
  search:async(q,sites=[])=>{queries.push({q,sites});return {model:'offline-search-protocol',tokens:null,usage:null,hits:queries.length===1?[{url:'https://unverified-merchant.example/manual',title:model}]:[{url:'https://real-manufacturer.example/manual',title:model+' guide'}]};},
  fetchDocument:async url=>({url,title:model+' synthetic guide',text:model+' Synthetic operation text. Not a real manual.',links:[]}),
  publisherDependencies:{fetchDocument:async url=>({url,title:'synthetic-directory',links:[],text:url.includes('lookup.')?JSON.stringify({docs:[{label:[brand],resource:[entity]}]}):record}),resolveHomepage:async url=>({url,chain:[url]})},
 });
 assert.equal(queries.length,2);assert.deepEqual(queries[1].sites,['real-manufacturer.example']);
 assert.equal(result.documents.length,1);assert.equal(new URL(result.documents[0].url).hostname,'real-manufacturer.example');
 assert.equal(publisherOwns('https://unverified-merchant.example/manual',brand,result.documents[0].publisherProof),false);
 assert.ok(!result.documents.some(d=>d.url.includes('unverified-merchant')));
});
