import test from 'node:test';import assert from 'node:assert/strict';
import {seed,mutate} from '../src/lib/domain.ts';
test('同一真实账号认领重放返回原实例；不同账号/未确认/已流转不借旧链接越权',()=>{
 const s=seed(),item=s.items.find(i=>i.id==='frame')!;item.owner='u_giver';
 mutate(s,'u_giver','gift',{itemId:item.id,memoryIds:[]});const gift=s.gifts.at(-1)!;
 mutate(s,'u_receiver','claim',{token:gift.token,received:true});
 const before=JSON.stringify(s),count=s.items.length;
 mutate(s,'u_receiver','claim',{token:gift.token,received:true});
 assert.equal(s.items.length,count);assert.equal(JSON.stringify(s),before);assert.equal(s.items.filter(i=>i.transferredFrom?.giftId===gift.id).length,1);
 assert.throws(()=>mutate(s,'u_other','claim',{token:gift.token,received:true}),/认领/);
 assert.throws(()=>mutate(s,'u_receiver','claim',{token:gift.token,received:false}),/取得|认领/);
 const received=s.items.find(i=>i.id===gift.receivedItemId)!;received.owner='u_next';
 assert.throws(()=>mutate(s,'u_receiver','claim',{token:gift.token,received:true}),/认领/);
});
