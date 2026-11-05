import test from 'node:test';import assert from 'node:assert/strict';import {validationFixture} from '../scripts/life-validation-fixture.ts';import {makeKnowledgeDocument,storeOfficialDocument,readKnowledge} from '../src/lib/life/acquisition.ts';
function fixture(t:any){const f=validationFixture('.runtime/finals-source-publication-'+crypto.randomUUID());t.after(()=>f.db.close());const id=f.add('[合成]资料原子发布','其他','Sony','SYNTH-PUBLISH-1'),item=f.read().items.find(i=>i.id===id)!,url='https://www.sony.com/synth-publish-1';const doc=(address:string,text:string)=>makeKnowledgeDocument({url:address,title:item.model,text:item.model+' '+text+' Synthetic content, not manufacturer data.',links:[]},item,[]);return {f,id,item,url,doc};}
test('同一HTTP原文的fragment别名换版时旧hash全部失效，不误伤查询参数不同的资料',t=>{
 const {f,id,item,url,doc}=fixture(t),base=doc(url,'OLD SOURCE'),anchor=doc(url+'#pairing','OLD SOURCE'),other=doc(url+'?version=alternate','OTHER SOURCE');for(const d of [base,anchor,other])storeOfficialDocument(f.db,'lin',item,d);assert.equal(readKnowledge(f.db,f.read(),'lin',id).length,3);
 storeOfficialDocument(f.db,'lin',item,doc(url,'NEW SOURCE'));const current=readKnowledge(f.db,f.read(),'lin',id);assert.ok(!current.some(d=>d.hash===base.hash),'旧fragment不能伪装仍有效的另一份资料');assert.ok(current.some(d=>d.url===other.url));assert.equal((f.db.prepare("SELECT count(*) n FROM life_knowledge_documents WHERE item_id=? AND status='superseded'").get(id) as any).n,2);
});
test('同内容更新定位元数据不能使另一fragment的有效旧引用失效',t=>{
 const {f,id,item,url,doc}=fixture(t),base=doc(url,'UNCHANGED'),anchor=doc(url+'#battery','UNCHANGED');storeOfficialDocument(f.db,'lin',item,base);storeOfficialDocument(f.db,'lin',item,anchor);storeOfficialDocument(f.db,'lin',item,{...base,reading:{mode:'html_text',figures:[],limitations:['新增阅读说明，不改变原文']}});assert.equal(readKnowledge(f.db,f.read(),'lin',id).length,2);
});
test('新版插入失败时旧资料仍active，不能先撤掉旧版再留下空缓存',t=>{
 const {f,id,item,url,doc}=fixture(t),old=doc(url,'PREVIOUS ACTIVE');storeOfficialDocument(f.db,'lin',item,old);f.db.exec("CREATE TRIGGER reject_synthetic_new_source BEFORE INSERT ON life_knowledge_documents BEGIN SELECT RAISE(ABORT,'synthetic_storage_failure'); END");assert.throws(()=>storeOfficialDocument(f.db,'lin',item,doc(url,'FAILED NEW VERSION')),/synthetic_storage_failure/);assert.equal(readKnowledge(f.db,f.read(),'lin',id).some(d=>d.hash===old.hash),true,'失败不丢失上个有效原文');
});


test('兼容旧缓存：只给仍active的既有原文补定位，不把同HTTP页面历史别名当新抓取而撤销',t=>{
 const {f,id,item,url,doc}=fixture(t),base=doc(url,'CURRENT BASE'),legacy=doc(url+'#pairing','LEGACY ALIAS DIFFERENT EXTRACT');storeOfficialDocument(f.db,'lin',item,base);
 // Reconstruct the older cache format, not a new publisher fetch.
 f.db.prepare('INSERT INTO life_knowledge_documents VALUES(?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),'lin',id,JSON.stringify([item.brand||'',item.model,item.region||'',item.productBinding?.packId||'']),legacy.url,legacy.hash,JSON.stringify(legacy),'active',legacy.fetchedAt);
 storeOfficialDocument(f.db,'lin',item,{...base,reading:{mode:'html_text',figures:[],limitations:['仅本轮补充阅读记录']}});
 assert.ok(readKnowledge(f.db,f.read(),'lin',id).some(d=>d.hash===legacy.hash),'原文未换版，补定位不能使已供应给同轮模型的原文消失');
});
