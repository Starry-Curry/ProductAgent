import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Offline budget module has no application runtime dependency.
import { assertBudget,ROUND_ID } from '../scripts/real-intelligence/budget.mjs';
test('新评测轮次计入失败/重试/未回报usage；150次与50元任一到达即停',()=>{
 const ledger={task:ROUND_ID,attempts:Array.from({length:149},()=>({status:'failed',reservedCny:0.1}))};
 assert.doesNotThrow(()=>assertBudget(ledger,0.1));ledger.attempts.push({status:'started',reservedCny:0.1});assert.throws(()=>assertBudget(ledger,0.1),/budget_exhausted/);
 assert.throws(()=>assertBudget({task:ROUND_ID,attempts:[{reservedCny:49.99}]},0.02),/budget_exhausted/);
 assert.throws(()=>assertBudget({task:'historical',attempts:[]},0.01),/identity/);
 assert.throws(()=>assertBudget({task:ROUND_ID,attempts:[{reservedCny:NaN}]},0.01),/invalid/);
 assert.doesNotThrow(()=>assertBudget({task:ROUND_ID,attempts:[{reservedCny:1,estimatedCny:0.01}]},0.01));
});

test('明确无金额上限授权仍保留请求硬上限与有限用量核对，不把缺失金额误当无限',()=>{
 const limits={roundId:'finals-800-synthetic',requests:800,cny:null,noCnyCap:true};
 const ledger={task:limits.roundId,attempts:Array.from({length:799},()=>({status:'failed',reservedCny:1}))};
 assert.doesNotThrow(()=>assertBudget(ledger,1000,limits));
 ledger.attempts.push({status:'started',reservedCny:1000});assert.throws(()=>assertBudget(ledger,1,limits),/budget_exhausted/);
 assert.throws(()=>assertBudget({task:limits.roundId,attempts:[]},1,{...limits,noCnyCap:false}),/invalid_authorized/);
 assert.throws(()=>assertBudget({task:limits.roundId,attempts:[{reservedCny:Infinity}]},1,limits),/invalid_historical/);
 assert.throws(()=>assertBudget({task:'previous-round',attempts:[]},1,limits),/identity/);
});
