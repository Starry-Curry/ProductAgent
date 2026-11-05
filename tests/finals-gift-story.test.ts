import test from 'node:test';import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';import {mutate} from '../src/lib/domain.ts';import {migrateUnified} from '../src/lib/foundation/schema.ts';
import {receivedGiftStories,giftStoryMemoryText} from '../src/lib/memory/gift-story.ts';import {saveMemory,listMemories,forgetMemory} from '../src/lib/memory/store.ts';import {buildContext} from '../src/lib/context/builder.ts';

test('赠礼故事：只有选定快照可显示；收礼人另行确认，来源、幂等、纠正/撤云/遗忘保持独立',t=>{
 const f=validationFixture('.runtime/finals-gift-memory-'+crypto.randomUUID());t.after(()=>f.db.close());migrateUnified(f.db);
 const original=f.add('[合成]分享的画','其他','','');let s=f.read();s.items.find(i=>i.id===original)!.owner='u_donor';
 const chosen=crypto.randomUUID(),privateId=crypto.randomUUID();s.memories.push({id:chosen,itemId:original,owner:'u_donor',author:'u_donor',text:'[合成分享]我曾带这幅画搬家，日期未记录。',at:new Date().toISOString(),shared:false},{id:privateId,itemId:original,owner:'u_donor',author:'u_donor',text:'PRIVATE-NOT-SHARED',at:new Date().toISOString(),shared:false});
 s=mutate(s,'u_donor','gift',{itemId:original,message:'合成寄语',memoryIds:[chosen]});const gift=s.gifts.at(-1)!;s=mutate(s,'u_receiver','claim',{token:gift.token,received:true});f.write(s);const received=gift.receivedItemId!,snapshots=receivedGiftStories(f.read(),'u_receiver',received);assert.equal(snapshots.length,1);assert.ok(!JSON.stringify(snapshots).includes('PRIVATE-NOT-SHARED'));assert.deepEqual(receivedGiftStories(f.read(),'u_intruder',received),[]);assert.equal(listMemories(f.db,f.read(),'u_receiver').length,0,'仅认领不等于个人记忆/云端同意');
 const source=snapshots[0],requestId=crypto.randomUUID(),input={kind:'story',itemId:received,text:giftStoryMemoryText(source.text),allowCloud:false,status:'active'},binding={kind:'gift_snapshot' as const,id:source.id,expectedText:source.text};
 const memory=saveMemory(f.db,f.read,'u_receiver',input,undefined,requestId,binding);assert.equal(memory.allowCloud,false);assert.equal(memory.provenance?.basis,'app_record');assert.equal(memory.provenance?.extractor,'gift-snapshot-consent-v1');assert.match(memory.text,/不是我本人的亲历/);assert.equal(saveMemory(f.db,f.read,'u_receiver',input,undefined,requestId,binding).id,memory.id);
 assert.throws(()=>saveMemory(f.db,f.read,'u_receiver',{...input,allowCloud:true},undefined,requestId,binding),/重复保存的内容不同/);
 assert.throws(()=>saveMemory(f.db,f.read,'u_receiver',input,undefined,crypto.randomUUID(),binding),/已保留/);
 assert.throws(()=>saveMemory(f.db,f.read,'u_receiver',{...input,text:'冒充我自己的亲历'},undefined,crypto.randomUUID(),binding),/已变化/);
 assert.throws(()=>saveMemory(f.db,f.read,'u_receiver',input,undefined,crypto.randomUUID(),{...binding,id:privateId}),/未获当前持有者授权/);
 assert.throws(()=>saveMemory(f.db,f.read,'u_intruder',input,undefined,crypto.randomUUID(),binding),/未获当前持有者授权/);
 const context=()=>buildContext(f.db,f.read(),'u_receiver',{question:'回忆这幅画随赠礼分享的故事',mode:'service',itemId:received,includeItemRelationships:true,taskMemoryOnly:true});assert.ok(!context().cloudMemories.some(m=>m.id===memory.id));
 saveMemory(f.db,f.read,'u_receiver',{...input,text:'[合成更正]赠送者曾带画搬家；不是我搬家，日期仍未知。',allowCloud:true},memory.id);assert.ok(context().cloudMemories.some(m=>m.id===memory.id&&m.text.includes('合成更正')));assert.ok(!JSON.stringify(listMemories(f.db,f.read(),'u_donor')).includes('合成更正'));
 saveMemory(f.db,f.read,'u_receiver',{...input,allowCloud:false},memory.id);assert.ok(!context().cloudMemories.some(m=>m.id===memory.id));forgetMemory(f.db,'u_receiver',memory.id);assert.ok(!context().memories.some(m=>m.id===memory.id));assert.equal(receivedGiftStories(f.read(),'u_receiver',received).length,1,'遗忘个人记忆不删除赠礼历史，也不会自动重新导入');
});
