import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gateway} from '../real-intelligence/gateway.mjs';
import {assertBudget} from '../real-intelligence/budget.mjs';
export const ROOT='docs/engineering/qwen-foundation-2026-11-02/evidence';
export const ROUND='qwen-foundation-20261102-r1';
/** One ledger for the entire approved task, including failed calls. The first
 * phase is deliberately text-only; unbounded external input reservations do
 * not fit the approved 8 CNY early-elimination envelope. */
export async function foundationGateway({phase='pilot',recordContent=true}={}){
 const auth=JSON.parse(fs.readFileSync(ROOT+'/authorization.json','utf8'));
 if(auth.roundId!==ROUND||auth.approved!==true||auth.maxRequests!==150||auth.maxEstimatedCny!==80)throw Error('current_authorization_missing');
 for(const old of auth.historicalLedgers)if(createHash('sha256').update(fs.readFileSync(old.path)).digest('hex')!==old.sha256)throw Error('historical_ledger_changed');
 const gates=JSON.parse(fs.readFileSync(ROOT+'/gates.json','utf8'));
 if(gates.gate0!=='passed_offline'||gates.gate1!=='passed_offline')throw Error('preceding_gate_not_passed');
 const ledger=JSON.parse(fs.readFileSync(ROOT+'/model-calls.json','utf8'));
 assertBudget(ledger,Number.EPSILON,{roundId:ROUND,requests:150,cny:80});
 if(!['pilot','integration'].includes(phase))throw Error('unknown_budget_phase');
 if(phase==='integration'){
  const review=JSON.parse(fs.readFileSync(ROOT+'/pilot-review.json','utf8'));
  if(review.proceed!==true||!review.evidence?.length)throw Error('pilot_not_reviewed');
 }
 const pilot=phase==='pilot',limits={roundId:ROUND,requests:pilot?12:150,cny:pilot?8:80};
 return gateway(process.env.WUJIAN_EVAL_CONFIG||path.resolve('.env.local'),{root:ROOT,lockFile:'.runtime/qwen-foundation-round.lock',model:'qwen3.8-max-0902',allowThinking:true,allowBoundedPageImages:true,allowResponses:!pilot,allowResponsesStream:!pilot,reserveExternalInputs:true,maxThinkingBudget:2048,requestTimeoutMs:90000,reconcileInterrupted:true,recoverStaleLock:true,recordContent,prices:{input:12,output:36},limits,
  validateRequest(body,{nativeSearch,responses}){
   if(pilot&&(nativeSearch||responses||(body.messages||[]).some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type!=='text'))))throw Error('pilot_text_only_use_integration_after_review');
  }});
}
