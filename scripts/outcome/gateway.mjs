import fs from 'node:fs';import {createHash} from 'node:crypto';
import {gateway} from '../real-intelligence/gateway.mjs';import {assertBudget} from '../real-intelligence/budget.mjs';
export const ROOT='docs/engineering/outcome-qwen-2026-11-02/evidence';
export const ROUND='outcome-qwen-20261102-r1';
export async function outcomeGateway(options={}){
 const auth=JSON.parse(fs.readFileSync(ROOT+'/authorization.json'));
 if(auth.roundId!==ROUND||auth.approved!==true||auth.maxRequests!==250||auth.maxEstimatedCny!==100)throw Error('new_authorization_missing');
 for(const old of auth.historicalLedgers)if(createHash('sha256').update(fs.readFileSync(old.path)).digest('hex')!==old.sha256)throw Error('historical_ledger_changed');
 const limits={roundId:ROUND,requests:250,cny:100};
 if(fs.existsSync(ROOT+'/model-calls.json'))assertBudget(JSON.parse(fs.readFileSync(ROOT+'/model-calls.json')),Number.EPSILON,limits);
 if(process.env.OUTCOME_REUSE_GATEWAY==='true'){
  const active=JSON.parse(fs.readFileSync('.runtime/outcome-gateway.json'));
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(active.url)||active.model!=='qwen3.8-max-0902')throw Error('invalid_active_gateway');
  return {...active,close:async()=>{}};
 }
 return gateway('D:/ProductAgent-LifeContext/.env.local',{root:ROOT,lockFile:'.runtime/outcome-round.lock',model:'qwen3.8-max-0902',allowThinking:true,allowResponses:true,allowResponsesStream:true,reserveExternalInputs:true,maxThinkingBudget:8192,requestTimeoutMs:150000,reconcileInterrupted:true,recoverStaleLock:true,recordContent:options.recordContent===true,prices:{input:12,output:36},limits});
}
