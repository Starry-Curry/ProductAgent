// Scan only proposed RFC files; never inspect environment/credential files.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const repo = resolve(process.argv.find(a => a.startsWith('--repo='))?.slice(7) || '.');
const git = (...args) => execFileSync('git',['-c',`safe.directory=${repo.replaceAll('\\','/')}`,...args],{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const base = JSON.parse(readFileSync(resolve(repo,'docs/architecture-v2/contracts/source-map.json'),'utf8')).refs.main;
const files = [...new Set([
  ...git('diff','--name-only','-z',base,'--').split('\0'),
  ...git('ls-files','--others','--exclude-standard','-z').split('\0')
].filter(Boolean))].sort();
const findings = [], manifest = [];
const rootAllowed = new Set(['AGENTS.md','CHANGELOG.md','DEVELOPMENT_REPORT.md','IMPLEMENTATION_STATUS.md','REVIEW_HANDOFF.md','docs/README.md']);
const generated = 'docs/architecture-v2/evidence/PUBLICATION_SCAN.json';
const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['provider-key', /\bsk-[A-Za-z0-9]{20,}\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['literal-secret-assignment', /(?:api[_-]?key|access[_-]?token|client[_-]?secret|authorization|cookie)["']?\s*[:=]\s*["'](?:Bearer\s+)?[A-Za-z0-9_+\/.=-]{24,}["']/i],
  ['credential-in-url', /https?:\/\/[^\s/:]+:[^\s/@]+@/]
];
for (const file of files) {
  if (!rootAllowed.has(file) && !file.startsWith('docs/architecture-v2/')) { findings.push({file,reason:'outside-RFC-allowlist'}); continue; }
  if (/(^|\/)(?:\.env(?:\.|$)|api\.txt|node_modules|\.runtime|\.next|\.git)(\/|$)|\.(?:sqlite(?:3)?|db|pem|p12|pfx)$/i.test(file)) {
    findings.push({file,reason:'forbidden-path'}); continue;
  }
  if (!/\.(?:md|json|mjs|sql)$/.test(file)) { findings.push({file,reason:'unexpected-file-type'}); continue; }
  const path = resolve(repo,file);
  const bytes = statSync(path).size;
  if (bytes > 1024*1024) { findings.push({file,reason:'larger-than-1MiB'}); continue; }
  if (file === generated) continue; // self-hash would be recursive
  const body = readFileSync(path,'utf8');
  for (const [reason, regex] of patterns) {
    const match = regex.exec(body);
    if (match) findings.push({file,reason,line:body.slice(0,match.index).split('\n').length});
  }
  manifest.push({file,bytes,sha256:createHash('sha256').update(body).digest('hex')});
}
const report = {generatedAt:new Date().toISOString(),scope:'RFC changed/untracked files only; pattern scan, not full security audit',baseline:base,filesScanned:manifest.length,maxFileBytes:Math.max(0,...manifest.map(f=>f.bytes)),findings,manifest,selfExcluded:generated};
mkdirSync(resolve(repo,'docs/architecture-v2/evidence'),{recursive:true});
writeFileSync(resolve(repo,generated),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({filesScanned:report.filesScanned,maxFileBytes:report.maxFileBytes,findings,report:generated},null,2));
process.exitCode=findings.length?1:0;
