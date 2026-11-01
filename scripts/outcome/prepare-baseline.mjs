import {execFileSync} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';
const commit='f0e3114924a1d22b01b413d6d3e40b35fe6d6d41',root=path.resolve('.runtime/baseline-f0');
// Read-only source snapshot, not another checkout or a copy of user databases/dependencies.
for(const file of execFileSync('git',['ls-tree','-r','--name-only',commit,'src'],{encoding:'utf8'}).trim().split('\n')){
 const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,execFileSync('git',['show',commit+':'+file],{maxBuffer:8_000_000}));
}
fs.writeFileSync(path.join(root,'BASELINE_COMMIT'),commit+'\n');console.log('Prepared immutable source-only baseline '+commit);
