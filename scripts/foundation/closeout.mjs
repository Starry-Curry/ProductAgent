// Read-only ledger/frozen evidence verification. No network/provider creation.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {verifyLedgerAnchor} from './gateway.mjs';
const root='docs/engineering/qwen-foundation-2026-11-02/evidence',out=root+'/core-closeout-summary-r2.json';assert.ok(!fs.existsSync(out),'preserve_closeout_evidence');
const sha=b=>createHash('sha256').update(b).digest('hex');
const dirs=[root,root+'/rounds/qwen-foundation-20261103-r2',root+'/rounds/qwen-foundation-20261103-r3'];
const rounds=dirs.map(dir=>{
 const bytes=fs.readFileSync(dir+'/model-calls.json'),j=JSON.parse(bytes),auth=JSON.parse(fs.readFileSync(dir+'/authorization.json'));
 for(const h of auth.historicalLedgers||[])verifyLedgerAnchor(h);
 assert.ok(j.attempts.length<=auth.maxRequests);assert.ok(!j.attempts.some(a=>a.status==='started'));
 const sum=j.attempts.reduce((n,a)=>n+(a.estimatedCny??a.reservedCny),0);assert.ok(sum<=auth.maxEstimatedCny);
 return {round:j.task,requests:j.attempts.length,limits:{requests:auth.maxRequests,cny:auth.maxEstimatedCny},knownEstimatedCny:Number(j.attempts.reduce((n,a)=>n+(a.estimatedCny??0),0).toFixed(6)),unknownUsageReservedCny:Number(j.attempts.filter(a=>a.estimatedCny===undefined).reduce((n,a)=>n+a.reservedCny,0).toFixed(6)),totalEstimateWithReservation:Number(sum.toFixed(6)),statuses:j.attempts.reduce((n,a)=>(n[a.status]=(n[a.status]||0)+1,n),{}),tokens:j.attempts.reduce((n,a)=>({input:n.input+(a.tokens?.prompt_tokens||a.tokens?.input_tokens||a.tokens?.input||0),output:n.output+(a.tokens?.completion_tokens||a.tokens?.output_tokens||a.tokens?.output||0)}),{input:0,output:0}),sha256:sha(bytes)};
});
const samples=['core-j01-discovery-r5','core-j01-continuity-r1','core-cached-visual-r2','core-cached-original-r1','core-cached-goal-r1','core-cached-goal-r2'].map(name=>{
 const j=JSON.parse(fs.readFileSync(root+'/'+name+'.json'));return {path:name+'.json',basis:j.basis,requests:j.upstreamRequests,responses:(j.responses||[]).map(r=>({fullAnswerMs:r.fullAnswerMs??null,modelCalls:r.result?.modelCalls,tokens:r.result?.tokens,outcome:r.result?.reply?.outcome,quality:'raw_manual_review_required_not_HTTP_or_model_self_score'}))};
});
const report={at:new Date().toISOString(),status:'NOT_ACCEPTED',reason:'fresh autonomous J01 contained unsupported/incorrect operational details; later essential-fact retests improved but do not replace initial failures or demonstrate robust unseen correctness',newModelRequestsInCloseout:0,rounds,samples,physicalValidation:false,publicManagedKnowledgeBaseCreated:false,fullFoundationFirstScore:'0/18 unchanged',notes:['R1 remains sealed at 142; unused 8 not reused. R2 and R3 reached request caps; no further paid calls.', 'R2 original 27-entry bytes preserved by exact SHA snapshot before append to 40 within its original 40/20 authorization; timeout #24 retains full unknown-usage reservation. R3 authorization unchanged.', 'Costs are estimates/reservations, not an invoice. No private user data or hardware test.']};
report.corrects='core-closeout-summary.json: derived token totals used the wrong property names and were incorrectly zero; raw ledgers, costs, request counts and model outputs unchanged.';
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,rounds,newModelRequestsInCloseout:0}));
