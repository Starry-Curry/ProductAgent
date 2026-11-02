import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {migrateUnified} from '../src/lib/foundation/schema.ts';
import {visible} from '../src/lib/domain.ts';
import {authorizedVisible,requireVisibleItem} from '../src/lib/foundation/visibility.ts';
import type {State,Person} from '../src/lib/domain.ts';

function fixture(withGrantTable=true){
 const f=validationFixture(mkdtempSync(path.join(process.cwd(),'.runtime','visible-policy-')));
 if(withGrantTable)migrateUnified(f.db);
 const id=f.add('合成共享物品','其他','Synthetic','MODEL-UNSEEN');
 const state=f.read(),item=state.items.find(i=>i.id===id)!;
 item.owner='u_owner';item.shared=true;item.sharedWith=['u_guest'];item.note='owner-private-sentinel';item.photo='private-photo-sentinel';
 state.tasks.push({id:'shared-task',itemId:id,title:'当前处理事项',createdBy:'u_owner',assignee:'u_guest',status:'待处理',logs:[]});
 state.plans=[{id:'current-plan',actor:'u_guest',goal:'当前行动',itemIds:[id],at:new Date().toISOString(),checklist:[{label:'使用共享物品',status:'待执行'}]}];
 state.memories.push({id:'own-story',itemId:id,author:'u_guest',owner:'u_guest',text:'这是我写的私人经历',at:new Date().toISOString(),shared:false});
 state.memories.push({id:'shared-memory',itemId:id,author:'u_owner',owner:'u_owner',text:'对方共享的物品故事',at:new Date().toISOString(),shared:true});
 state.attempts.push({id:'own-attempt',actor:'u_guest',ideaId:'idea',itemIds:[id],text:'我自己的历史尝试',at:new Date().toISOString()});
 state.gifts.push({id:'own-gift',itemId:id,sender:'u_guest',token:'synthetic-gift-token',message:'我自己的赠礼留言',nickname:'礼物',stories:[],includeKnowledge:false,itemName:'原赠礼快照',revoked:false});
 f.write(state);
 const grant=(extra:Record<string,unknown>={})=>f.db.prepare('INSERT OR REPLACE INTO foundation_grants VALUES(?,?,?,?,?,?)').run('g','u_owner','u_guest',id,1,JSON.stringify({actions:['read'],...extra}));
 return {...f,id,grant};
}
test('共享过期/撤权后，各当前物品引用不再沿用legacy visible',()=>{
 for(const change of [{expiresAt:'2000-01-01T00:00:00Z'},{revokedAt:new Date().toISOString()},{actions:[]}]){
  const f=fixture();try{f.grant(change);const state=f.read(),before=JSON.stringify(state);
   assert(visible(state,'u_guest').items.some(i=>i.id===f.id),'真实旧可见投影仍受legacy share影响');
   const view=authorizedVisible(f.db,state,'u_guest');
   assert(!view.items.some(i=>i.id===f.id));assert(!view.tasks.some(t=>t.itemId===f.id));assert.equal(view.plans.length,0);
   assert(!view.memories.some(m=>m.id==='shared-memory'));
   assert(view.memories.some(m=>m.id==='own-story'));assert(view.gifts.some(g=>g.id==='own-gift'));
   assert.equal(view.attempts.at(-1)!.text,'我自己的历史尝试');assert.deepEqual(view.attempts.at(-1)!.itemIds,[]);
   assert.throws(()=>requireVisibleItem(f.db,state,'u_guest',f.id),{status:403});
   assert.equal(JSON.stringify(state),before,'仅投影，不能删除/重写作者历史');
  }finally{f.db.close();}
 }
});
test('有效跨账号授权保留当前物品、事项、计划与原有私密字段脱敏',()=>{
 const f=fixture();try{f.grant({expiresAt:'2099-01-01T00:00:00Z'});const state=f.read();
  const view=authorizedVisible(f.db,state,'u_guest'),item=view.items.find(i=>i.id===f.id)!;
  assert(item);assert.equal(item.note,'');assert.equal(item.photo,undefined);
  assert.equal(view.tasks.at(-1)!.id,'shared-task');assert.equal(view.plans.length,1);assert(view.memories.some(m=>m.id==='shared-memory'));
  assert(requireVisibleItem(f.db,state,'u_guest',f.id));assert(!authorizedVisible(f.db,state,'u_outside').items.some(i=>i.id===f.id));
 }finally{f.db.close();}
});
test('无foundation授权表的旧schema兼容合法分享',()=>{
 const f=fixture(false);try{assert(authorizedVisible(f.db,f.read(),'u_guest').items.some(i=>i.id===f.id));}finally{f.db.close();}
});
test('赠礼后作者保留私人经历、尝试和赠礼快照，但不取得现物权限',()=>{
 const f=fixture();try{const state=f.read(),item=state.items.find(i=>i.id===f.id)!;item.owner='u_recipient';item.shared=false;item.sharedWith=[];
  const before=JSON.stringify(state),view=authorizedVisible(f.db,state,'u_guest');
  assert(!view.items.some(i=>i.id===f.id));assert(view.memories.some(m=>m.id==='own-story'));assert(view.gifts.some(g=>g.id==='own-gift'));
  assert.equal(view.attempts.at(-1)!.text,'我自己的历史尝试');assert.deepEqual(view.attempts.at(-1)!.itemIds,[]);assert.equal(JSON.stringify(state),before);
 }finally{f.db.close();}
});

test('真实Request处理器：两个独立账号的workspace/life/collaboration一致执行当前授权',async()=>{
 // Load actual Next route handlers through Node's source resolver. No server,
 // paid provider or browser substitute is involved in these HTTP-handler tests.
 const hooks=registerHooks({resolve(specifier,context,nextResolve){
  const candidate=specifier.startsWith('@/')?pathToFileURL(path.resolve('src',specifier.slice(2))):specifier.startsWith('.')&&context.parentURL?new URL(specifier,context.parentURL):undefined;
  if(candidate&&candidate.protocol==='file:'&&!path.extname(candidate.pathname)&&existsSync(fileURLToPath(candidate)+'.ts'))return nextResolve(candidate.href+'.ts',context);
  return nextResolve(specifier,context);
 }});
 process.env.PRODUCT_AGENT_DATA_DIR=mkdtempSync(path.join(process.cwd(),'.runtime','visible-api-'));
 process.env.AUTH_MODE='authenticated';process.env.AI_ALLOW_PAID_CALLS='false';process.env.WUJIAN_ALLOW_PAID_CALLS='false';
 process.env.WUJIAN_ALLOW_PUBLIC_FETCH='false';process.env.WUJIAN_ENABLE_DEVICE_LAB='false';
 const {login,accountDB}=await import('../src/lib/accounts.ts');
 const store=await import('../src/lib/db.ts');
 const workspace=await import('../src/app/api/workspace/route.ts');
 const life=await import('../src/app/api/life/route.ts');
 const collaboration=await import('../src/app/api/collaboration/route.ts');
 const owner=login('visible_owner','synthetic-visible-owner-password',true),guest=login('visible_guest','synthetic-visible-guest-password',true);
 const db=store.database();
 try{
  const state=store.read(),template=state.items[0];
  const shared={...template,id:'synthetic-api-shared',name:'synthetic-current-item',owner:owner.account.id,shared:true,sharedWith:[guest.account.id],demo:undefined};
  const own={...template,id:'synthetic-api-own',name:'synthetic-owned-item',owner:guest.account.id,shared:false,sharedWith:[],demo:undefined};
  state.items.push(shared,own);state.tasks.push({id:'synthetic-api-task',itemId:shared.id,title:'授权共享任务',createdBy:owner.account.id,assignee:guest.account.id,status:'待处理',logs:[]});
  db.prepare('UPDATE workspace SET body=? WHERE id=1').run(JSON.stringify(state));
  const setGrant=(extra:Record<string,unknown>)=>db.prepare('INSERT OR REPLACE INTO foundation_grants VALUES(?,?,?,?,?,?)').run('api-grant',owner.account.id,guest.account.id,shared.id,1,JSON.stringify({actions:['read'],...extra}));
  const request=(url:string,body?:unknown)=>new Request('http://127.0.0.1:3299'+url,{method:body?'POST':'GET',headers:{host:'127.0.0.1:3299',origin:'http://127.0.0.1:3299',cookie:guest.cookie.split(';')[0],...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  for(const change of [{expiresAt:'2000-01-01T00:00:00Z'},{revokedAt:new Date().toISOString()}]){
   setGrant(change);
   const w=await workspace.GET(request('/api/workspace'));assert.equal(w.status,200);const wbody=await w.json();assert(!wbody.items.some((i:any)=>i.id===shared.id));assert(!wbody.tasks.some((t:any)=>t.itemId===shared.id));
   const c=await collaboration.GET(request('/api/collaboration'));assert.equal(c.status,200);assert(!(await c.json()).workspace.items.some((i:any)=>i.id===shared.id));
   const l=await life.GET(request('/api/life'));assert.equal(l.status,200);const lbody=await l.json();assert(!lbody.workspace.items.some((i:any)=>i.id===shared.id));assert.equal(lbody.stats.items,lbody.workspace.items.filter((i:any)=>!i.demo).length);
   const focused=await life.GET(request('/api/life?itemId='+shared.id));assert.equal(focused.status,403);assert(!JSON.stringify(await focused.json()).includes(shared.name));
   const wp=await workspace.POST(request('/api/workspace',{action:'updateItem',itemId:own.id,name:'synthetic-own-update'}));assert.equal(wp.status,200);assert(!(await wp.json()).items.some((i:any)=>i.id===shared.id));
   const lp=await life.POST(request('/api/life',{action:'updateItem',input:{itemId:own.id,name:'synthetic-own-update-2'}}));assert.equal(lp.status,200);assert(!(await lp.json()).workspace.items.some((i:any)=>i.id===shared.id));
  }
  setGrant({expiresAt:'2099-01-01T00:00:00Z'});
  const w=await workspace.GET(request('/api/workspace'));assert((await w.json()).items.some((i:any)=>i.id===shared.id));
  assert.equal((await life.GET(request('/api/life?itemId='+shared.id))).status,200);
  const c=await collaboration.GET(request('/api/collaboration'));assert((await c.json()).workspace.items.some((i:any)=>i.id===shared.id));
  assert.equal(store.read().items.find(i=>i.id===shared.id)!.owner,owner.account.id);
 }finally{hooks.deregister();db.close();accountDB().close();}
});
