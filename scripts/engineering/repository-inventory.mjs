// Read tracked files only. A zero reference count is NOT permission to delete.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const groups={};
const rows=files.map(file=>{
 const size=fs.statSync(file).size;
 const group=file==='AGENTS.md'||file==='docs/product/PRODUCT_FINAL_V1.md'?'authority':file.startsWith('src/')?'application':file.startsWith('tests/')?'tests':file.startsWith('scripts/')?'scripts':/evidence|validation|logs|fixtures/.test(file)?'historical_evidence':file.startsWith('docs/')?'documentation':'configuration_and_root';
 (groups[group]??={count:0,bytes:0}).count++;groups[group].bytes+=size;
 return {file,group,bytes:size};
});
const sources=rows.filter(r=>/\.(?:ts|tsx|mjs|js)$/.test(r.file));
const inbound=new Map();
for(const row of sources){
 const text=fs.readFileSync(row.file,'utf8');
 for(const m of text.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)){
  const ref=m[1];if(!ref.startsWith('.')&&!ref.startsWith('@/'))continue;
  const base=ref.startsWith('@/')?'src/'+ref.slice(2):path.posix.normalize(path.posix.join(path.posix.dirname(row.file),ref));
  for(const p of [base,...['.ts','.tsx','.mjs','.js','/index.ts'].map(ext=>base+ext)])if(files.includes(p)){(inbound.get(p)||inbound.set(p,[]).get(p)).push(row.file);break;}
 }
}
const output={at:new Date().toISOString(),scope:'Git tracked files, static imports only; runtime routes/scripts/archives can have no static inbound reference',groups,totalBytes:rows.reduce((s,r)=>s+r.bytes,0),retention:{deleted:[],reason:'No file proved disposable; preserve all billing, failure, model and recovery evidence. No private/ignored directories scanned.'},files:rows.map(r=>({...r,staticInbound:inbound.get(r.file)||[]}))};
const target=process.argv[2]||'docs/engineering/integrated-agent-2026-11-01/evidence/repository-inventory.json';
fs.writeFileSync(target,JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({files:rows.length,groups,deleted:0}));
