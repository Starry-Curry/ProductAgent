import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import path from 'node:path';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {migrateUnified} from '../src/lib/foundation/schema.ts';
import {authorize} from '../src/lib/foundation/policy.ts';
import {readItemContext,accessibleItemContexts,itemContextPage} from '../src/lib/context/items.ts';
import {sharedItemKnowledge} from '../src/lib/context/knowledge.ts';
import {buildContext} from '../src/lib/context/builder.ts';
import {readKnowledge,makeKnowledgeDocument,storeOfficialDocument,acquireKnowledge} from '../src/lib/life/acquisition.ts';

function fixture(grants=true){
 const f=validationFixture(mkdtempSync(path.join(process.cwd(),'.runtime','read-permission-')));
 if(grants)migrateUnified(f.db);
 const id=f.add('合成共享耳机','电子','Sony','WH-CH520');
 const s=f.read(),item=s.items.find(i=>i.id===id)!;
 item.owner='u_owner';item.shared=true;item.sharedWith=['u_guest'];f.write(s);
 const doc=makeKnowledgeDocument({url:'https://helpguide.sony.net/synthetic/WH-CH520',title:'WH-CH520 synthetic test source',text:'WH-CH520 synthetic official passage sentinel.',links:[]},item,[]);
 storeOfficialDocument(f.db,'u_owner',item,doc);
 return {...f,id,grant:(extra:Record<string,unknown>={})=>f.db.prepare('INSERT OR REPLACE INTO foundation_grants VALUES(?,?,?,?,?,?)').run('g','u_owner','u_guest',id,1,JSON.stringify({actions:['read'],...extra}))};
}
test('过期或撤回明确授权在实例、目录、共享知识和正文读取中一致拒绝',()=>{
 for(const grant of [{expiresAt:'2000-01-01T00:00:00Z'},{revokedAt:new Date().toISOString()},{actions:[]}]){
  const f=fixture();try{f.grant(grant);const s=f.read();assert.equal(authorize(f.db,s,'u_guest',f.id).allowed,false);
   assert.equal(readItemContext(s,'u_guest',f.id,false,f.db),undefined);
   assert(!accessibleItemContexts(s,'u_guest',false,f.db).some(i=>i.id===f.id));
   assert(!itemContextPage(s,'u_guest',false,0,20,f.db).items.some(i=>i.id===f.id));
   assert.throws(()=>sharedItemKnowledge(s,'u_guest',[f.id],{db:f.db}));
   assert.deepEqual(readKnowledge(f.db,s,'u_guest',f.id),[]);
   assert.throws(()=>buildContext(f.db,s,'u_guest',{question:'资料',mode:'service',itemId:f.id}));
  }finally{f.db.close();}
 }
});
test('有效明确授权保留共享实例与官方正文读取；纯投影不能越过数据库授权',()=>{
 const f=fixture();try{f.grant({expiresAt:'2099-01-01T00:00:00Z'});const s=f.read();
  assert(readItemContext(s,'u_guest',f.id,false,f.db));
  assert.equal(sharedItemKnowledge(s,'u_guest',[f.id],{db:f.db}).items.length,1);
  assert.equal(readKnowledge(f.db,s,'u_guest',f.id).length,1);
  assert.equal(buildContext(f.db,s,'u_guest',{question:'资料',mode:'service',itemId:f.id}).sharedKnowledge.items.length,1);
  assert.equal(readItemContext(s,'u_guest',f.id),undefined);
  assert.throws(()=>sharedItemKnowledge(s,'u_guest',[f.id]));
  assert(readItemContext(s,'u_owner',f.id));
 }finally{f.db.close();}
});
test('无新授权表的正常旧数据库保留旧共享；显式拒绝不回退旧共享',()=>{
 const f=fixture(false);try{const s=f.read();assert.equal(authorize(f.db,s,'u_guest',f.id).allowed,true);
  assert(readItemContext(s,'u_guest',f.id,false,f.db));
  assert.equal(readKnowledge(f.db,s,'u_guest',f.id).length,1);
 }finally{f.db.close();}
});
test('明确授权不覆盖旧共享撤回或转移所有权',()=>{
 const f=fixture();try{f.grant();const s=f.read();s.items.find(i=>i.id===f.id)!.shared=false;
  assert.equal(readItemContext(s,'u_guest',f.id,false,f.db),undefined);
  assert.deepEqual(readKnowledge(f.db,s,'u_guest',f.id),[]);
  s.items.find(i=>i.id===f.id)!.shared=true;s.items.find(i=>i.id===f.id)!.owner='u_new_owner';
  s.items.find(i=>i.id===f.id)!.sharedWith=[];
  assert.equal(readItemContext(s,'u_guest',f.id,false,f.db),undefined);
 }finally{f.db.close();}
});
test('异步官方获取期间授权撤回，不能落库或返回旧共享资料',async()=>{
 const f=fixture();try{f.grant();const s=f.read();s.items.find(i=>i.id===f.id)!.supportUrl='https://helpguide.sony.net/synthetic/WH-CH520';f.write(s);
  let reads=0;const before=f.db.prepare('SELECT COUNT(*) AS n FROM life_knowledge_documents').get();
  await assert.rejects(acquireKnowledge(f.db,f.read,'u_guest',f.id,{force:true,persist:true,fetchDocument:async(url)=>{reads++;f.grant({revokedAt:new Date().toISOString()});return {url:String(url),title:'WH-CH520 synthetic official page',text:'WH-CH520 synthetic fetched instruction.',links:[]};}}),/权限或型号已变化/);
  assert(reads>0);assert.deepEqual(f.db.prepare('SELECT COUNT(*) AS n FROM life_knowledge_documents').get(),before);
  assert.deepEqual(readKnowledge(f.db,f.read(),'u_guest',f.id),[]);
 }finally{f.db.close();}
});
test('无焦点创意目录也按当前数据库授权过滤',()=>{
 const f=fixture();try{f.grant({expiresAt:'2000-01-01T00:00:00Z'});
  const ctx=buildContext(f.db,f.read(),'u_guest',{question:'利用现有物品',mode:'ideas'});
  assert(!ctx.resources.some(i=>i.id===f.id));assert(!JSON.stringify(ctx).includes('合成共享耳机'));
 }finally{f.db.close();}
});
