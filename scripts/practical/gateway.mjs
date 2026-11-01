import fs from 'node:fs';
import {gateway} from '../real-intelligence/gateway.mjs';
import {assertBudget} from '../real-intelligence/budget.mjs';
export const ROOT='docs/engineering/practical-agent-2026-10-31/evidence';
export const ROUND='practical-agent-20261031-r1';
export const ADDITIONAL_ROOT='docs/engineering/practical-continuation-2026-11-01/evidence/additional-r1';
export const ADDITIONAL_ROUND='practical-continuation-20261101-r1';
export async function practicalGateway(options={}){
 const additional=options.additional===true,root=additional?ADDITIONAL_ROOT:ROOT,roundId=additional?ADDITIONAL_ROUND:ROUND,requests=additional?20:60,cny=additional?10:15;
 const a=JSON.parse(fs.readFileSync(root+'/authorization.json','utf8'));
 if(a.roundId!==roundId||!a.approved||a.maxRequests!==requests||a.maxEstimatedCny!==cny)throw Error('current_authorization_missing');
 if(fs.existsSync(root+'/model-calls.json'))assertBudget(JSON.parse(fs.readFileSync(root+'/model-calls.json','utf8')),Number.EPSILON,{roundId,requests,cny});
 return gateway('D:/ProductAgent-LifeContext/.env.local',{root,lockFile:'.runtime/practical-model-round.lock',model:'qwen3.8-max-0902',searchModel:additional?'qwen-plus-2025-12-01':undefined,prices:{input:12,output:36},recordContent:options.recordContent,limits:{roundId,requests,cny}});
}
