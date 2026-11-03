import type {DatabaseSync} from 'node:sqlite';
import type {State,Person} from '../domain.ts';
import {authorize} from '../foundation/policy.ts';
import {AgentError} from '../agent/contracts.ts';
import {readKnowledge} from '../life/acquisition.ts';
import {readSourceSelections} from './source-reference.ts';
import {projectReality} from './reality.ts';

/** Authorized read projection of existing Item + original knowledge records.
 * Domain/UI consumers reuse this service; it owns no parallel data store. */
export function readReality(db:DatabaseSync,state:State,actor:Person,itemId:string){
 const item=state.items.find(i=>i.id===itemId);
 if(!item||!authorize(db,state,actor,itemId).allowed)throw new AgentError('物品未获当前授权',403);
 return projectReality(item,readSourceSelections(item,readKnowledge(db,state,actor,itemId)));
}
