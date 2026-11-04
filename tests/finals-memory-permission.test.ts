import test from 'node:test';import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {saveMemory,listMemories} from '../src/lib/memory/store.ts';
import {mirrorItemGrant} from '../src/lib/foundation/policy.ts';
import {migrateUnified} from '../src/lib/foundation/schema.ts';

test('对抗记忆：显式撤权不能被legacy shared绕过；本人旧经历保留为归档但不能新绑撤权物品',t=>{
 const f=validationFixture('.runtime/finals-memory-revocation-'+crypto.randomUUID());t.after(()=>f.db.close());
 migrateUnified(f.db);
 const id=f.add('[合成]曾获准共享的物品','其他','','');const state=f.read(),item=state.items.find(i=>i.id===id)!;item.owner='dad';item.shared=true;item.sharedWith=['lin'];f.write(state);
 const memory=saveMemory(f.db,f.read,'lin',{kind:'experience',text:'[合成]我自己的既有经历，保留归档',itemId:id,allowCloud:false});
 mirrorItemGrant(f.db,f.read(),'dad','lin',id,false);
 assert.equal(listMemories(f.db,f.read(),'lin').find(m=>m.id===memory.id)?.archived,true,'当前权限已失效，不能仍显示为可供物品任务使用');
 assert.throws(()=>saveMemory(f.db,f.read,'lin',{kind:'relationship',text:'新的绑定不应获准',itemId:id,allowCloud:true}),/访问权限|授权/);
 const changed=saveMemory(f.db,f.read,'lin',{kind:'experience',text:'[合成]只纠正我自己的旧记录',itemId:id,allowCloud:false},memory.id);
 assert.equal(changed.id,memory.id);assert.equal(listMemories(f.db,f.read(),'lin').find(m=>m.id===memory.id)?.archived,true);
 assert.equal(listMemories(f.db,f.read(),'dad').some(m=>m.id===memory.id),false);
});
