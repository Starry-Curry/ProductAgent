import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gateway} from '../real-intelligence/gateway.mjs';
import {assertBudget} from '../real-intelligence/budget.mjs';
const BASE='docs/engineering/qwen-foundation-2026-11-02/evidence';
export const ROUND=process.env.WUJIAN_MODEL_ROUND||'qwen-foundation-20261102-r1';
if(!['qwen-foundation-20261102-r1','qwen-foundation-20261103-r2','qwen-foundation-20261103-r3'].includes(ROUND))throw Error('unknown_authorized_round');
const additional=ROUND!=='qwen-foundation-20261102-r1';
const currentLimits=ROUND==='qwen-foundation-20261103-r3'?{requests:12,cny:15}:additional?{requests:40,cny:20}:{requests:150,cny:80};
export const ROOT=additional?BASE+'/rounds/'+ROUND:BASE;
export function verifyLedgerAnchor(entry){
 const current=fs.readFileSync(entry.path),sha=b=>createHash('sha256').update(b).digest('hex');if(sha(current)===entry.sha256)return;
 // An authorized round may append to its unused balance. Preserve the exact
 // historical bytes, require an unchanged prefix, and never merge its limits.
 const snapshot=path.join(path.dirname(entry.path),'snapshots',entry.sha256+'.json');
 if(!fs.existsSync(snapshot))throw Error('historical_ledger_changed');const bytes=fs.readFileSync(snapshot);if(sha(bytes)!==entry.sha256)throw Error('historical_anchor_changed');
 const old=JSON.parse(bytes),next=JSON.parse(current),authorization=JSON.parse(fs.readFileSync(path.join(path.dirname(entry.path),'authorization.json')));
 if(next.task!==old.task||JSON.stringify(next.authorizedLimits)!==JSON.stringify(old.authorizedLimits)||!Array.isArray(next.attempts)||next.attempts.length<old.attempts.length||JSON.stringify(next.attempts.slice(0,old.attempts.length))!==JSON.stringify(old.attempts)||authorization.roundId!==next.task||authorization.approved!==true||next.attempts.length>authorization.maxRequests||next.attempts.some(a=>!Number.isFinite(a.estimatedCny??a.reservedCny)||(a.estimatedCny??a.reservedCny)<0)||next.attempts.reduce((n,a)=>n+(a.estimatedCny??a.reservedCny),0)>authorization.maxEstimatedCny)throw Error('historical_ledger_changed');
}
/** One ledger for the entire approved task, including failed calls. The first
 * phase is deliberately text-only; unbounded external input reservations do
 * not fit the approved 8 CNY early-elimination envelope. */
export async function foundationGateway({phase='pilot',recordContent=true}={}){
 const cachedRemainder=ROUND==='qwen-foundation-20261103-r2'&&process.env.WUJIAN_FOUNDATION_CACHED_REMAINDER==='true';
 if(ROUND==='qwen-foundation-20261103-r2'&&fs.existsSync(BASE+'/rounds/qwen-foundation-20261103-r3/authorization.json')&&!cachedRemainder)throw Error('previous_round_sealed_use_explicit_authorized_r3');
 if(!additional&&fs.existsSync(BASE+'/rounds/qwen-foundation-20261103-r2/authorization.json'))throw Error('previous_round_sealed_use_explicit_authorized_r2');
 const auth=JSON.parse(fs.readFileSync(ROOT+'/authorization.json','utf8'));
 if(auth.roundId!==ROUND||auth.approved!==true||auth.maxRequests!==currentLimits.requests||auth.maxEstimatedCny!==currentLimits.cny)throw Error('current_authorization_missing');
 for(const old of auth.historicalLedgers)verifyLedgerAnchor(old);
 const gates=JSON.parse(fs.readFileSync(BASE+'/gates.json','utf8'));
 if(gates.gate0!=='passed_offline'||gates.gate1!=='passed_offline')throw Error('preceding_gate_not_passed');
 const ledger=JSON.parse(fs.readFileSync(ROOT+'/model-calls.json','utf8'));
 assertBudget(ledger,Number.EPSILON,{roundId:ROUND,requests:auth.maxRequests,cny:auth.maxEstimatedCny});
 if(!['pilot','integration'].includes(phase))throw Error('unknown_budget_phase');
 if(phase==='integration'){
  const review=JSON.parse(fs.readFileSync(BASE+'/pilot-review.json','utf8'));
  if(review.proceed!==true||!review.evidence?.length)throw Error('pilot_not_reviewed');
 }
 const pilot=phase==='pilot',limits={roundId:ROUND,requests:pilot?Math.min(12,auth.maxRequests):auth.maxRequests,cny:pilot?Math.min(8,auth.maxEstimatedCny):auth.maxEstimatedCny};
 return gateway(process.env.WUJIAN_EVAL_CONFIG||path.resolve('.env.local'),{root:ROOT,lockFile:'.runtime/qwen-foundation-round.lock',model:'qwen3.8-max-0902',allowThinking:true,allowBoundedPageImages:true,allowResponses:!pilot&&!cachedRemainder,allowResponsesStream:!pilot&&!cachedRemainder,reserveExternalInputs:true,maxThinkingBudget:2048,requestTimeoutMs:90000,reconcileInterrupted:true,recoverStaleLock:true,recordContent,prices:{input:12,output:36},limits,
  validateRequest(body,{nativeSearch,responses}){
   if(pilot&&(nativeSearch||responses||(body.messages||[]).some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type!=='text'))))throw Error('pilot_text_only_use_integration_after_review');
   if(cachedRemainder&&(nativeSearch||responses||(body.messages||[]).some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='file'||c.type==='image_url'&&!/^data:image\/jpeg;base64,/.test(c.image_url?.url||'')))))throw Error('remainder_cached_text_or_bounded_rendered_pages_only');
  }});
}
