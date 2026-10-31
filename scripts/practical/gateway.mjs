import fs from 'node:fs';
import {gateway} from '../real-intelligence/gateway.mjs';
export const ROOT='docs/engineering/practical-agent-2026-10-31/evidence';
export const ROUND='practical-agent-20261031-r1';
export async function practicalGateway(options={}){
 const a=JSON.parse(fs.readFileSync(ROOT+'/authorization.json','utf8'));
 if(a.roundId!==ROUND||!a.approved||a.maxRequests!==60||a.maxEstimatedCny!==15)throw Error('current_authorization_missing');
 return gateway('D:/ProductAgent-LifeContext/.env.local',{root:ROOT,lockFile:'.runtime/practical-model-round.lock',model:'qwen3.8-max-0902',prices:{input:12,output:36},recordContent:options.recordContent,limits:{roundId:ROUND,requests:60,cny:15}});
}
