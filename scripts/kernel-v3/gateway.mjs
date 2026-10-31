import fs from 'node:fs';
import {gateway} from '../real-intelligence/gateway.mjs';
export const V3_ROUND='intelligence-kernel-v3-20261031-r1';
export const V3_ROOT='docs/engineering/intelligence-kernel-v3-2026-10-31/evidence';
/** Separate explicitly authorized round, never copied from a historical counter. */
export async function v3Gateway(){
 const authorization=JSON.parse(fs.readFileSync(V3_ROOT+'/authorization.json','utf8'));
 if(authorization.roundId!==V3_ROUND||authorization.maxRequests!==250||authorization.maxEstimatedCny!==50||authorization.approved!==true)throw Error('v3_authorization_missing');
 return gateway('D:/ProductAgent-LifeContext/.env.local',{root:V3_ROOT,lockFile:'.runtime/kernel-v3-model-round.lock',limits:{roundId:V3_ROUND,requests:250,cny:50}});
}
