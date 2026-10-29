import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
const files=execFileSync("git",["diff","--cached","--name-only","--diff-filter=ACM","-z"],{encoding:"utf8"}).split("\0").filter(Boolean);
const reportPath="artifacts/unified-home/pre-push-scan.json",issues=[],manifest=[];
const signatures=[/sk-[a-zA-Z0-9]{20,}/g,/gh[pousr]_[a-zA-Z0-9]{25,}/g,/github_pat_[a-zA-Z0-9_]{25,}/g,/^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gm,/Bearer\s+(?!fixture-only)([a-zA-Z0-9._-]{24,})/g];
for(const file of files.filter(f=>f!==reportPath)){
 if(/(^|\/)(?:\.env(?:\..+)?|api\.txt|node_modules|\.next|\.runtime)(\/|$)|\.(?:sqlite(?:-wal|-shm)?|db|p12|pfx|pem|key)$/i.test(file))issues.push({file,kind:"forbidden-path"});
 const bytes=execFileSync("git",["show",":"+file],{maxBuffer:20_000_000});
 if(bytes.length>5_000_000)issues.push({file,kind:"large-file-over-5MB"});
 const text=bytes.toString("utf8");for(const [index,signature]of signatures.entries()){signature.lastIndex=0;const match=signature.exec(text);if(match)issues.push({file,kind:"credential-signature",signature:index+1,line:text.slice(0,match.index).split("\n").length});}
 manifest.push({file,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});
}
const result={at:new Date().toISOString(),scope:"staged bytes only; no secrets/config/database read",base:"113696effe5f7f162fe9dccfbdf0bb64a7737d55",files:manifest.length,totalBytes:manifest.reduce((n,f)=>n+f.bytes,0),issues,manifest,note:"Report excludes itself; signatures are an additional check, not a proof of absence of every possible secret."};
fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify({files:result.files,totalBytes:result.totalBytes,issues:result.issues}));if(issues.length)process.exitCode=1;
