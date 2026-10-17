// Verify the imported business baseline without an external ZIP or old .git.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const provenance=JSON.parse(fs.readFileSync('docs/engineering/import-provenance.json','utf8'));
const subject='chore: import Wukaifeng 2026-10-17 baseline';
let ref=process.argv.find(a=>a.startsWith('--ref='))?.slice(6);
if(!ref&&!process.argv.includes('--current')){
  try{ref=execFileSync('git',['log','--format=%H','--fixed-strings',`--grep=${subject}`,'-1'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
}
const records=provenance.files.filter(r=>r.source_path.startsWith('src/')||r.source_path.startsWith('tests/')||['package.json','package-lock.json','tsconfig.json','next.config.mjs'].includes(r.source_path));
const mismatches=[];
for(const entry of records){
  const raw=ref?execFileSync('git',['show',`${ref}:${entry.repository_path}`],{encoding:'buffer'}):fs.readFileSync(entry.repository_path);
  const sha=createHash('sha256').update(raw).digest('hex');
  if(sha!==entry.normalized_sha256)mismatches.push(entry.repository_path);
}
console.log(JSON.stringify({kind:'verified-original-import-not-current-feature-acceptance',ref:ref||'working-tree-before-import',sourceCommit:provenance.reported_source_commit,checked:records.length,mismatches},null,2));
if(mismatches.length)process.exitCode=1;
