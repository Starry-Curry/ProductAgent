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
