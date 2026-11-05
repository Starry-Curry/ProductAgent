import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
// @ts-ignore Isolated test gateway; no model call at import time.
import {verifyFinalsAuthorization,ROUND} from '../scripts/finals/gateway.mjs';
const bytes=Buffer.from('synthetic-historical-bytes'),sha=createHash('sha256').update(bytes).digest('hex');
const auth=()=>({roundId:ROUND,approved:true,maxRequests:800,maxEstimatedCny:null,noCnyCap:true,services:'qwen_and_bailian_native_only',historicalLedgers:['model-calls.json','rounds/qwen-foundation-20261103-r2/model-calls.json','rounds/qwen-foundation-20261103-r3/model-calls.json'].map(p=>({path:'docs/engineering/qwen-foundation-2026-11-02/evidence/'+p,sha256:sha}))});
test('本轮费用授权：800次，明确无金额上限，历史三轮必须逐字节保持',()=>{
 assert.deepEqual(verifyFinalsAuthorization(auth(),()=>bytes),{roundId:ROUND,requests:800,cny:null,noCnyCap:true});
 for(const change of [{approved:false},{maxRequests:801},{maxEstimatedCny:150},{noCnyCap:false},{roundId:'old'},{services:'third_party'}])assert.throws(()=>verifyFinalsAuthorization({...auth(),...change},()=>bytes),/authorization/);
 assert.throws(()=>verifyFinalsAuthorization(auth(),()=>Buffer.from('modified')),/historical_ledger_changed/);
 const duplicate=auth();duplicate.historicalLedgers[2]=duplicate.historicalLedgers[1];assert.throws(()=>verifyFinalsAuthorization(duplicate,()=>bytes),/duplicate/);
});
