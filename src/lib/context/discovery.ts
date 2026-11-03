import type {DatabaseSync} from 'node:sqlite';
import type {State,Person} from '../domain.ts';
import {authorize} from '../foundation/policy.ts';
import {readReality} from './reality-service.ts';
import {resourceCatalogue} from './relevance.ts';
/** Shared authorized capability discovery. Goal ranking is lexical, not proof
 * of suitability. Empty matches can be browsed in pages, never silently replaced
 * by a fixed first inventory subset or by private stories. */
export function discoverCapabilities(db:DatabaseSync,state:State,actor:Person,input:{goal?:string;cursor?:number;limit?:number;scopeItemIds?:string[]}={}){
 const cursor=input.cursor??0,limit=input.limit??12;
 if(!Number.isInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>30)throw Error('invalid_discovery_page');
 const allowed=state.items.filter(i=>!i.demo&&authorize(db,state,actor,i.id).allowed&&(!input.scopeItemIds||input.scopeItemIds.includes(i.id)));
 const realities=new Map(allowed.map(i=>[i.id,readReality(db,state,actor,i.id)]));
 const effects=Object.fromEntries([...realities].map(([id,r])=>[id,r.capabilities.filter(c=>c.status==='conditional').map(c=>c.effect)]));
 const ranked=input.goal?resourceCatalogue(allowed,input.goal,[],allowed.length,effects).items.map(r=>allowed.find(i=>i.id===r.id)!):allowed.toSorted((a,b)=>a.id.localeCompare(b.id));
 const resources=ranked.slice(cursor,cursor+limit).map(i=>{const r=realities.get(i.id)!;return {id:i.id,name:r.name,identity:r.identity,instance:r.instance,capabilities:r.capabilities,facts:r.facts,unknowns:r.unknowns,revision:r.revision};});
 return {version:'capability-discovery/1' as const,resources,total:ranked.length,authorizedTotal:allowed.length,nextCursor:cursor+resources.length<ranked.length?cursor+resources.length:null,matching:input.goal?'lexical_goal_candidates_not_semantic_or_physical_proof':'authorized_catalogue',notice:'只有获准事实和条件化能力；没有实物验证或执行授权。无匹配可省略goal分页浏览，不假定前几件相关。'};
}
export type CapabilityDiscovery=ReturnType<typeof discoverCapabilities>;
