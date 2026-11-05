import type {State,Person} from '../domain.ts';

/** Existing immutable, selectively shared gift snapshots. No original private
 * stories, persona or new holder history are joined into this projection. */
export function receivedGiftStories(state:State,actor:Person,itemId:string){
 const item=state.items.find(i=>i.id===itemId&&i.owner===actor);if(!item)return [];
 return state.memories.filter(m=>m.itemId===itemId&&m.owner===actor&&!!m.origin?.giftId&&state.gifts.some(g=>g.id===m.origin!.giftId&&g.claimedBy===actor&&(g.receivedItemId||g.itemId)===itemId));
}
export function giftStoryMemoryText(text:string){return (text.length>1400?'赠送者选择分享的故事节选（不是我本人的亲历）：':'赠送者选择分享的故事（不是我本人的亲历）：')+text.slice(0,1400);}
