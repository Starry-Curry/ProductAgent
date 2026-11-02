import test from 'node:test';import assert from 'node:assert/strict';import {validationFixture} from '../scripts/life-validation-fixture.ts';import {acquireKnowledge,trustedOfficialDocument} from '../src/lib/life/acquisition.ts';
import {extractPublicHTML} from '../src/lib/life/sources.ts';
import {compileTaskContext} from '../src/lib/context/compiler.ts';
import {migrateUnified} from '../src/lib/foundation/schema.ts';
test('大站导航不能挤掉正文实际型号链接，不按商品写固定地址',async()=>{
 const header=Array.from({length:100},(_,n)=>'<a href="/support/menu-'+n+'">Support menu '+n+'</a>').join('');const r=await extractPublicHTML('<title>产品目录</title><header>'+header+'</header><main>Current product directory. <a href="/product/NEW4321_10/support">NEW4321/10 User manual support</a></main>','https://www.philips.com/catalogue');assert.ok(r.links[0].url.includes('NEW4321_10'));
});
test('型号官网实际链接可授权单一CDN联册；不放开CDN全域或接受其他型号/法律PDF',async t=>{
 const f=validationFixture('.runtime/outcome-publisher-'+crypto.randomUUID());t.after(()=>f.db.close());const id=f.add('合成家电','其他','Philips','TEST4321/10');const root='https://www.philips.com/test4321_10/support',manual='https://cdn.example.com/opaque-file.pdf',law='https://cdn.example.com/legal.pdf';const reads:string[]=[];
 const r=await acquireKnowledge(f.db,f.read,'lin',id,{query:'装配操作',search:async q=>{assert.match(q,/装配操作/);return {hits:[{title:'TEST4321/10 support',url:root}],model:'offline-substitute',tokens:null,usage:null};},fetchDocument:async u=>{reads.push(u);return u===root?{url:u,title:'TEST4321/10 support',text:'Official TEST4321/10 support. Download the instructions below.',links:[{title:'User manual',url:manual},{title:'Legal declaration',url:law}]}:{url:u,title:'Family instructions',text:'Family manual: Before assembling disconnect the power supply.',links:[]};}});
 const d=r.documents.find(d=>d.url===manual)!;assert.ok(d);assert.equal(d.applicability,'manufacturer_linked_manual');assert.equal(trustedOfficialDocument(d,f.read().items.find(i=>i.id===id)!,r.documents),true);assert.ok(!reads.includes(law));assert.equal(trustedOfficialDocument({...d,url:manual+'?different'},f.read().items.find(i=>i.id===id)!,r.documents),false);
 migrateUnified(f.db);const c=compileTaskContext(f.db,f.read(),'lin',{itemId:id,known:{memoryPolicy:'off'},messages:[],tried:[]} as any,'assembling',false,[],[],18000);assert.equal(c.evidence.find(e=>e.url===manual)?.scopeBasis,'manufacturer_link_from_exact_model_page');
 assert.equal(trustedOfficialDocument(d,{...f.read().items.find(i=>i.id===id)!,model:'OTHER999'},r.documents),false);
});
