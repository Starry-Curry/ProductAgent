import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('./',import.meta.url);
const manifest=JSON.parse(await fs.readFile(new URL('FREEZE_SHA256.json',root),'utf8'));
for(const [file,expected] of Object.entries(manifest.frozenFiles)){
 const b=await fs.readFile(new URL(file,root));assert.equal(crypto.createHash('sha256').update(b).digest('hex'),expected,file+' changed');
}
const q=JSON.parse(await fs.readFile(new URL('questions.frozen.json',root),'utf8'));
const a=JSON.parse(await fs.readFile(new URL('answers.frozen.json',root),'utf8'));
const j=JSON.parse(await fs.readFile(new URL('journeys.frozen.json',root),'utf8'));
assert.equal(q.products.length,6);assert.ok(new Set(q.products.map(x=>x.brand)).size>=3);assert.equal(q.cases.length,18);
for(const p of q.products)assert.equal(q.cases.filter(c=>c.productId===p.id).length,3);
assert.equal(a.answers.length,18);assert.equal(j.journeys.length,4);
assert.equal(q.rubric.minEvidenceBackedOperationalFirstAnswers,15);assert.equal(q.rubric.severeErrorsAllowed,0);
assert.equal(new Set(q.cases.map(x=>x.id)).size,18);
for(const c of q.cases){assert.equal(c.status,'not_run');assert.ok(a.answers.find(x=>x.id===c.id));}
for(const x of a.answers){assert.ok(a.sources[x.sourceId]);assert.equal(x.score,'not_scored');}
for(const x of Object.values(a.sources)){assert.ok(x.url.startsWith('https://'));assert.ok(x.quote.split(/\s+/).length<=25);}
console.log(JSON.stringify({freeze:'verified',questions:18,skus:6,journeys:4,paidRequests:0,productAcceptance:'not_run'}));
