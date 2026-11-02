import type { DatabaseSync } from 'node:sqlite';
import { visible, type Person, type State } from '../domain.ts';
import { AgentError } from '../agent/contracts.ts';
import { authorize } from './policy.ts';

/** Current API projection only. Never changes the stored workspace or removes
 * the author's private history when an item is gifted or sharing expires. */
export function authorizedVisible(db:DatabaseSync,state:State,actor:Person){
 const legacy=visible(state,actor);
 const ids=new Set(legacy.items.filter(i=>authorize(db,state,actor,i.id).allowed).map(i=>i.id));
 return {...legacy,
  items:legacy.items.filter(i=>ids.has(i.id)),
  tasks:legacy.tasks.filter(t=>!t.itemId||ids.has(t.itemId)),
  // These are active plan cards. A plan that lost a resource must not look
  // executable; its original history remains unchanged in the domain store.
  plans:legacy.plans.filter(p=>p.itemIds.every(id=>ids.has(id))),
  memories:legacy.memories.filter(m=>(m.owner??m.author)===actor||ids.has(m.itemId)),
  // Keep the author's actual attempt text, while withdrawing live item links.
  attempts:legacy.attempts.map(a=>({...a,itemIds:a.itemIds.filter(id=>ids.has(id))})),
 };
}

/** Guard focused reads before legacy sources/fragments can access any row. */
export function requireVisibleItem(db:DatabaseSync,state:State,actor:Person,itemId:string){
 if(!authorize(db,state,actor,itemId).allowed)throw new AgentError('物品不存在或未获授权',403);
 return state.items.find(i=>i.id===itemId)!;
}
