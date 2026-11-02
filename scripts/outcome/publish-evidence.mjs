import fs from 'node:fs';import {createHash} from 'node:crypto';import {ROOT} from './gateway.mjs';
const file=ROOT+'/model-calls.json',raw=fs.readFileSync(file),ledger=JSON.parse(raw),hash=v=>createHash('sha256').update(v).digest('hex');
if(ledger.publication){console.log('Already projected; accounting and raw recovery reference retained.');process.exit(0);}
if(ledger.attempts.some(a=>a.status==='started'))throw Error('active_ledger_do_not_publish');
const accounting=l=>hash(JSON.stringify(l.attempts.map(({number,stage,evaluation,kind,model,status,reservedCny,estimatedCny,tokens,startedAt,elapsedMs,error})=>({number,stage,evaluation,kind,model,status,reservedCny,estimatedCny,tokens,startedAt,elapsedMs,error}))));
const originalAccounting=accounting(ledger),backup='.runtime/outcome-raw/model-calls.json';fs.mkdirSync('.runtime/outcome-raw',{recursive:true});if(fs.existsSync(backup))throw Error('raw_backup_exists');fs.writeFileSync(backup,raw);let count=0;
function project(value){if(Array.isArray(value))return value.map(project);if(!value||typeof value!=='object')return value;
 const copy={...value};if(typeof copy.text==='string'&&(copy.basis==='official'||copy.documentId&&copy.url)){
  const original=copy.text;copy.text='[公开记录以来源URL、段落位置与SHA256引用厂家原文；原始字节保留本地恢复副本]';copy.sourceTextSha256=hash(original);copy.sourceTextBytes=Buffer.byteLength(original);count++;
 }
 for(const [key,v]of Object.entries(copy))if(typeof v==='string'&&/^[\[{]/.test(v.trim())){try{const parsed=JSON.parse(v),before=count,next=project(parsed);if(count!==before)copy[key]=JSON.stringify(next);}catch{}}else if(v&&typeof v==='object')copy[key]=project(v);
 return copy;
}
for(const attempt of ledger.attempts)if(attempt.input)attempt.input=project(attempt.input);
if(accounting(ledger)!==originalAccounting)throw Error('accounting_must_not_change');
ledger.publication={supplierPassagesReferenced:count,originalFileSha256:hash(raw),rawLocalRecovery:backup,accountingSha256:originalAccounting,notice:'Only repeated manufacturer source excerpts in provider INPUT are referenced by URL/hash. Synthetic user inputs, model outputs, request counts, usage, prices, failures and historical ledgers unchanged. This is a public projection, not a byte-identical request log.'};
fs.writeFileSync(file,JSON.stringify(ledger,null,2));console.log(JSON.stringify(ledger.publication));
