import type {DatabaseSync} from 'node:sqlite';
import type {State,Person} from '../domain.ts';
import {authorize} from '../foundation/policy.ts';
import {AgentError} from '../agent/contracts.ts';
import {readKnowledge} from '../life/acquisition.ts';
import {readSourceSelections} from './source-reference.ts';
import {projectReality} from './reality.ts';
import {scopedProductKnowledge} from './evidence-scope.ts';

/** Authorized read projection of existing Item + original knowledge records.
 * Domain/UI consumers reuse this service; it owns no parallel data store. */
export function readReality(db:DatabaseSync,state:State,actor:Person,itemId:string){
 const item=state.items.find(i=>i.id===itemId);
 if(!item||!authorize(db,state,actor,itemId).allowed)throw new AgentError('物品未获当前授权',403);
 const documents=readKnowledge(db,state,actor,itemId);
 const readings=scopedProductKnowledge(item,documents).flatMap(({document:d})=>(d.reading?.visualReadings||[]).filter(r=>r.documentHash===d.hash&&r.basis==='provider_visual_reading_not_verified_fact').map(r=>({...r,url:d.url})));
 return projectReality(item,readSourceSelections(item,documents),readings);
}
