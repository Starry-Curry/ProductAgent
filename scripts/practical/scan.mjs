import {execFileSync} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';
const root=process.cwd(),git=args=>execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/'),...args],{encoding:'utf8',windowsHide:true,maxBuffer:100*1024*1024});
const base='0432ace33cc333bbbbe4bd9db59d3ec20760c7c7';
const names=[...new Set([...git(['diff','--name-only','-z',base]).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean))];
const report={at:new Date().toISOString(),base,files:0,historyBlobs:0,bytes:0,issues:[],largePublicEvidence:[],largest:[]};
const patterns=[/\bsk-[A-Za-z0-9_-]{24,}\b/g,/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,/\bgithub_pat_[A-Za-z0-9_]{25,}\b/g,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,/["'](?:access_token|refresh_token|cookie)["']\s*:\s*["'][a-f0-9]{40,}["']/gi];
const forbidden=n=>n!=='.env.example'&&/(^|\/)(?:\.env(?:\.|$)|api\.txt$|node_modules|\.runtime|\.next[^/]*|[^/]+\.sqlite(?:[-.]|$)|[^/]+\.db$)/i.test(n);
const binary=n=>/\.(?:png|jpg|jpeg|webp|gif|zip|pdf)$/i.test(n);
function inspect(name,body,history=false){for(const p of patterns){p.lastIndex=0;if(p.test(body))report.issues.push({path:name,history,reason:'credential_pattern_no_value_printed'});}}
for(const name of names){const full=path.resolve(root,name);if(!full.startsWith(root+path.sep)||!fs.existsSync(full)||!fs.statSync(full).isFile())continue;
 if(forbidden(name)){report.issues.push({path:name,reason:'forbidden_path_not_read'});continue;}
 const size=fs.statSync(full).size;report.files++;report.bytes+=size;report.largest.push({path:name,bytes:size});
 if(size>5*1024*1024){if(name.startsWith('docs/engineering/practical-agent-2026-10-31/evidence/')&&/\.json$/.test(name))report.largePublicEvidence.push({path:name,bytes:size,review:'authorized_synthetic_model_inputs_outputs_preserved'});else report.issues.push({path:name,reason:'large_file_review_required'});}
 if(!binary(name))inspect(name,fs.readFileSync(full,'utf8'));
}
// Scan every newly reachable blob as well as the final working files. Deleted
// intermediate data can otherwise leak through an ordinary branch push.
for(const line of git(['rev-list','--objects',base+'..HEAD']).split('\n')){const [oid,...parts]=line.trim().split(' '),name=parts.join(' ');if(!name)continue;if(forbidden(name)){report.issues.push({path:name,reason:'forbidden_history_path'});continue;}if(binary(name)||git(['cat-file','-t',oid]).trim()!=='blob')continue;report.historyBlobs++;inspect(name,git(['cat-file','blob',oid]),true);}
report.largest.sort((a,b)=>b.bytes-a.bytes);report.largest=report.largest.slice(0,12);
fs.writeFileSync('docs/engineering/practical-agent-2026-10-31/evidence/secret-scan.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({files:report.files,historyBlobs:report.historyBlobs,issues:report.issues,largePublicEvidence:report.largePublicEvidence}));if(report.issues.length)process.exitCode=1;
