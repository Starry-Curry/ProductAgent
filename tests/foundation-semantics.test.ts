import test from 'node:test';
import assert from 'node:assert/strict';
import {projectReality} from '../src/lib/context/reality.ts';
import {resourceCatalogue} from '../src/lib/context/relevance.ts';
import {compileTaskContext} from '../src/lib/context/compiler.ts';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {migrateUnified} from '../src/lib/foundation/schema.ts';
import {mutate} from '../src/lib/domain.ts';
import {documentEvidence,makeKnowledgeDocument} from '../src/lib/life/acquisition.ts';

test('Gate1 商业商品事实与私人实例状态分层，官方功能不等于执行权限，原始数据不被覆盖',t=>{
 const f=validationFixture('.runtime/semantic-commercial-'+crypto.randomUUID());t.after(()=>f.db.close());
 const id=f.add('[合成持有]SAMLA','收纳','IKEA','194.408.48',{attributes:{material:'用户报告贴有布套'}});
 f.write(mutate(f.read(),'lin','bindProduct',{itemId:id,packId:'ikea-samla-19440848',confirmed:true}));
 const raw=f.read().items.find(i=>i.id===id)!,before=JSON.stringify(raw),r=projectReality(raw);
 assert.equal(r.identity.model,'194.408.48');
 assert.ok(r.facts.some(x=>x.basis==='official_source'&&x.scope==='product'&&!!x.source.url));
 assert.ok(r.facts.some(x=>x.basis==='user_report'&&x.scope==='instance'&&x.value==='用户报告贴有布套'));
 assert.ok(r.capabilities.length>0&&r.capabilities.every(x=>!x.executable&&!x.verifiedForThisInstance));
 assert.ok(r.facts.some(x=>x.predicate==='food_contact'&&x.value===false));
 assert.equal(JSON.stringify(raw),before);
});

test('Gate1 无型号纪念物保留身份，已报告物理事实冲突不被摘要抹平',t=>{
 const f=validationFixture('.runtime/semantic-unique-'+crypto.randomUUID());t.after(()=>f.db.close());
 const id=f.add('朋友做的纪念灯形画','纪念物','','未确认',{attributes:{physicalFacts:[{id:crypto.randomUUID(),component:'本体',key:'magnetic',value:true,basis:'user_report'},{id:crypto.randomUUID(),component:'本体',key:'magnetic',value:false,basis:'user_report'}]}});
 const r=projectReality(f.read().items.find(i=>i.id===id)!);
 assert.equal(r.identity.kind,'unique');assert.equal(r.identity.model,null);
 assert.ok(!r.capabilities.some(c=>c.effect==='light'));
 assert.equal(r.facts.filter(x=>x.predicate==='magnetic'&&x.status==='conflicting').length,2);
 assert.ok(r.unknowns.some(x=>x.includes('冲突')));
});

test('Gate1 修订取决于事实状态而非私人备注，重新编译按最新授权和状态',t=>{
 const f=validationFixture('.runtime/semantic-revision-'+crypto.randomUUID());t.after(()=>f.db.close());migrateUnified(f.db);
 const id=f.add('独特盘子','其他','','待确认');
 const session:any={itemId:id,known:{memoryPolicy:'off'},messages:[],tried:[]};
 const one=compileTaskContext(f.db,f.read(),'lin',session,'盘子怎样使用',false,[],[],18000);
 let s=f.read();s.items.find(i=>i.id===id)!.note='PRIVATE-NEVER-CLOUD';f.write(s);
 const two=compileTaskContext(f.db,f.read(),'lin',session,'盘子怎样使用',false,[],[],18000);
 assert.equal(one.revision,two.revision);assert.ok(!JSON.stringify(two.semanticItems).includes('PRIVATE-NEVER-CLOUD'));
 s=f.read();s.items.find(i=>i.id===id)!.availability='loaned';f.write(s);
 const three=compileTaskContext(f.db,f.read(),'lin',session,'盘子怎样使用',false,[],[],18000);
 assert.notEqual(three.revision,one.revision);assert.equal(three.semanticItems[0].instance.usable,false);
});

test('Gate1 资源目录按当前目标匹配，陌生无匹配目标不退化为取前N件',t=>{
 const f=validationFixture('.runtime/semantic-relevance-'+crypto.randomUUID());t.after(()=>f.db.close());
 for(let n=0;n<20;n++)f.add('无关资源'+n,'其他','','待确认');
 const id=f.add('旅行封套','其他','','待确认',{attributes:{capabilities:['容纳卡片']}});
 const r=resourceCatalogue(f.read().items,'找旅行封套');assert.equal(r.items[0].id,id);assert.ok(r.items.length<5);
 assert.deepEqual(resourceCatalogue(f.read().items,'完全未登记的蒸汽熨烫目标').items,[]);
});

test('Gate1 退役词项能力抽取，否定原文不会因playback单词成为正向能力',()=>{
 const item:any={id:'fake',name:'合成记录器',model:'DEVELOPMENT-27',brand:'Sony'};
 const text='DEVELOPMENT-27. This model does not support playback of audio.';
 const d=makeKnowledgeDocument({title:'DEVELOPMENT-27',text,url:'https://helpguide.sony.net/test',links:[]},item,[]);
 assert.deepEqual(documentEvidence([d]),[]);assert.equal(d.text,text);
 d.observations=[{kind:'limitation',topic:'playback',quote:'This model does not support playback of audio.',value:'模型候选不能作为认证'}];
 const projected=documentEvidence([d]);assert.equal(projected[0].text,d.observations[0].quote);assert.equal(projected[0].basis,'quoted_source_candidate_not_capability');
});
