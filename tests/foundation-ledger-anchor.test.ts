import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {verifyLedgerAnchor} from '../scripts/foundation/gateway.mjs';
test('费用历史只能在原授权内追加，旧请求、未知用量预留和历史字节快照不可改写',()=>{
 const dir=path.resolve('.runtime/ledger-anchor-'+crypto.randomUUID());fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'model-calls.json');
 const old={task:'offline-test',authorizedLimits:{requests:3,cny:2},attempts:[{number:1,status:'failed',reservedCny:0.8,error:'unknown_usage_reserved'}]};const bytes=JSON.stringify(old),sha=createHash('sha256').update(bytes).digest('hex'),entry={path:file,sha256:sha};fs.writeFileSync(file,bytes);verifyLedgerAnchor(entry);
 fs.mkdirSync(path.join(dir,'snapshots'));fs.writeFileSync(path.join(dir,'snapshots',sha+'.json'),bytes);fs.writeFileSync(path.join(dir,'authorization.json'),JSON.stringify({roundId:old.task,approved:true,maxRequests:3,maxEstimatedCny:2}));
 const next={...old,attempts:[...old.attempts,{number:2,status:'returned',reservedCny:0.2}]};fs.writeFileSync(file,JSON.stringify(next));verifyLedgerAnchor(entry);
 for(const changed of [{...next,attempts:[{...old.attempts[0],reservedCny:0.1},next.attempts[1]]},{...next,attempts:[...old.attempts,{number:2,reservedCny:2}]},{...next,attempts:[...old.attempts,{number:2}]},{...next,authorizedLimits:{requests:30,cny:20}}]){fs.writeFileSync(file,JSON.stringify(changed));assert.throws(()=>verifyLedgerAnchor(entry),/historical_ledger_changed/);}
});
