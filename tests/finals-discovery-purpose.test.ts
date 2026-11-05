import test from 'node:test';import assert from 'node:assert/strict';import {validationFixture} from '../scripts/life-validation-fixture.ts';import {acquireKnowledge} from '../src/lib/life/acquisition.ts';import {isProductManual} from '../src/lib/life/manuals.ts';

test('查规格不强制搜索操作手册：准确型号厂家规格目录可读，不能被无关操作PDF挤掉或冒充手册',async t=>{
 const f=validationFixture('.runtime/finals-discovery-purpose-'+crypto.randomUUID());t.after(()=>f.db.close());const model='UNSEEN-FOCUS-63',id=f.add('[合成]未见商品','其他','Brother',model),spec='https://support.brother.com/info/catalogue-2026.pdf',law='https://support.brother.com/legal.pdf';const reads:string[]=[],queries:string[]=[];
 const r=await acquireKnowledge(f.db,f.read,'lin',id,{purpose:'specifications',query:'PRIVATE-TOPIC-FENCE 私人背景',search:async query=>{queries.push(query);return {hits:[...Array.from({length:8},(_,n)=>({title:'Operation manual',url:'https://support.brother.com/manual/chapter-'+n+'.pdf'})),{title:model+' product specifications catalogue',url:spec},{title:model+' legal registration',url:law}],model:'offline-protocol',tokens:null,usage:null,events:[]};},fetchDocument:async url=>{reads.push(url);return {url,title:url===spec?model+' product specifications catalogue':'Another model operation guide',text:url===spec?model+' Synthetic dimensions 12 x 8 cm; not real product facts.':'OTHER-DEVICE; unrelated synthetic manual.',links:[]};}});
 assert.match(queries[0],/specifications/i);assert.doesNotMatch(queries[0],/operating instructions|user manual|PRIVATE-TOPIC/);assert.ok(reads.includes(spec));assert.ok(!reads.includes(law));assert.equal(r.documents.length,1);assert.equal(r.documents[0].url,spec);assert.equal(isProductManual({url:spec,title:r.documents[0].title}),false,'目录不自动成为操作手册');
});

test('失败缓存按知识目的区分：同目的不重复联网，不同目的可找另一类资料',async t=>{
 const f=validationFixture('.runtime/finals-discovery-purpose-cache-'+crypto.randomUUID());t.after(()=>f.db.close());const id=f.add('[合成]查找缺口','其他','Brother','UNSEEN-FOCUS-CACHE-63');let searches=0;
 const options={search:async()=>{searches++;return {hits:[],model:'offline-protocol',tokens:null,usage:null,events:[]};},fetchDocument:async()=>{throw Error('no_document_in_fixture');}};
 await acquireKnowledge(f.db,f.read,'lin',id,{...options,purpose:'specifications'});assert.equal(searches,1);
 const same=await acquireKnowledge(f.db,f.read,'lin',id,{...options,purpose:'specifications'});assert.equal(same.cached,true);assert.equal(searches,1);
 await acquireKnowledge(f.db,f.read,'lin',id,{...options,purpose:'operation'});assert.equal(searches,2);
});
