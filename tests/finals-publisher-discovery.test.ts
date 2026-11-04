import test from 'node:test';import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {acquireKnowledge} from '../src/lib/life/acquisition.ts';
import {discoverPublishers,publisherOwns} from '../src/lib/life/publisher.ts';

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

test('旧目录缺失不阻断当前目录发现；搜索命中、近似名字和非公司不能自行成为官方认证',async()=>{
 const brand='Synthetic New Maker',id='Q1234567',site='https://new-maker.example/';
 const entity={id,labels:{en:{value:brand}},aliases:{},claims:{P31:[{rank:'normal',mainsnak:{datavalue:{value:{id:'Q136675338'}}}}],P856:[{rank:'normal',mainsnak:{snaktype:'value',datavalue:{value:site}}}]}};
 for(const mode of ['valid','wrong-name','not-company','search-declaration-only']){
  const calls:string[]=[];const result=await discoverPublishers(brand,[site+'manual'],{fetchDocument:async url=>{calls.push(url);if(url.includes('lookup.'))throw Error('old_directory_unavailable');const e=mode==='wrong-name'?{...entity,labels:{en:{value:brand+' Partners'}}}:mode==='not-company'?{...entity,claims:{...entity.claims,P31:[]}}:entity;return {url,title:'synthetic',links:[],text:url.includes('/w/api.php')?JSON.stringify({search:[{id,label:brand}]}):JSON.stringify({entities:{[id]:mode==='search-declaration-only'?undefined:e}})};},resolveHomepage:async url=>({url,chain:[url]})});
  assert.ok(calls.some(u=>u.includes('/w/api.php')));assert.equal(result.proofs.length,mode==='valid'?1:0,mode);
  if(mode==='valid')assert.equal(publisherOwns(site+'manual',brand,result.proofs[0]),true);
 }
});
