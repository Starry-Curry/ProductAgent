import fs from 'node:fs';
import {gateway} from '../real-intelligence/gateway.mjs';
import {assertBudget} from '../real-intelligence/budget.mjs';
export const ROOT='docs/engineering/integrated-agent-2026-11-01/evidence';
export const ROUND='integrated-agent-20261101-r1';
export async function integratedGateway(options={}){
 const a=JSON.parse(fs.readFileSync(ROOT+'/authorization.json','utf8'));
 if(a.roundId!==ROUND||a.approved!==true||a.maxRequests!==150||a.maxEstimatedCny!==50)throw Error('authorization_missing');
 const limits={roundId:ROUND,requests:150,cny:50};
 if(fs.existsSync(ROOT+'/model-calls.json'))assertBudget(JSON.parse(fs.readFileSync(ROOT+'/model-calls.json','utf8')),Number.EPSILON,limits);
 return gateway('D:/ProductAgent-LifeContext/.env.local',{root:ROOT,lockFile:'.runtime/practical-model-round.lock',model:'qwen3.8-max-0902',allowThinking:true,allowResponses:true,reconcileInterrupted:true,recoverStaleLock:true,prices:{input:12,output:36},recordContent:options.recordContent===true,limits});
}
