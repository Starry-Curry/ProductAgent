import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gateway} from '../real-intelligence/gateway.mjs';

export const ROUND='finals-product-20261105-r1';
export const ROOT='docs/engineering/finals-product-2026-11-05/evidence';
/** @param {(path:string)=>Uint8Array} readFile */
export function verifyFinalsAuthorization(auth,readFile=fs.readFileSync){
 if(auth.roundId!==ROUND||auth.approved!==true||auth.maxRequests!==800||auth.maxEstimatedCny!==null||auth.noCnyCap!==true||auth.services!=='qwen_and_bailian_native_only')throw Error('finals_authorization_mismatch');
 if(!Array.isArray(auth.historicalLedgers)||auth.historicalLedgers.length!==3)throw Error('historical_anchors_missing');
 for(const anchor of auth.historicalLedgers){
  if(!/^docs\/engineering\/qwen-foundation-2026-11-02\/evidence\/(?:rounds\/qwen-foundation-20261103-r[23]\/)?model-calls\.json$/.test(anchor.path))throw Error('unexpected_historical_ledger');
  if(createHash('sha256').update(readFile(anchor.path)).digest('hex')!==anchor.sha256)throw Error('historical_ledger_changed');
 }
 if(new Set(auth.historicalLedgers.map(a=>a.path)).size!==3)throw Error('duplicate_historical_anchor');
 return {roundId:ROUND,requests:800,cny:null,noCnyCap:true};
}
export async function finalsGateway({recordContent=false,model='qwen3.8-max-0902',thinkingBudget=2048}={}){
 if(!['qwen3.8-max-0902','qwen3.7-plus-2026-05-26'].includes(model)||!Number.isInteger(thinkingBudget)||thinkingBudget<1||thinkingBudget>8192)throw Error('unsupported_finals_probe_configuration');
 const auth=JSON.parse(fs.readFileSync(ROOT+'/authorization.json','utf8'));
 const limits=verifyFinalsAuthorization(auth);
 const file=ROOT+'/model-calls.json';
 if(fs.existsSync(file)){
  const ledger=JSON.parse(fs.readFileSync(file,'utf8'));
  if(ledger.task!==ROUND||JSON.stringify(ledger.authorizedLimits)!==JSON.stringify(limits))throw Error('round_limits_changed');
 }
 return gateway(process.env.WUJIAN_EVAL_CONFIG||path.resolve('.env.local'),{
  root:ROOT,lockFile:'.runtime/finals-product-model.lock',model,
  allowThinking:true,allowBoundedPageImages:true,allowResponses:true,allowResponsesStream:true,
  reserveExternalInputs:true,maxThinkingBudget:thinkingBudget,requestTimeoutMs:90000,
  reconcileInterrupted:true,recoverStaleLock:true,recordContent,prices:model==='qwen3.7-plus-2026-05-26'?{input:2,output:8}:{input:12,output:36},limits,
 });
}
