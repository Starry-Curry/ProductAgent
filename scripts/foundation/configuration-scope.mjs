// Only configuration NAMES and public endpoint shape are inspected. Never emit
// credentials or identifier values; do not probe guessed workspace hosts.
import fs from 'node:fs';
const text=fs.readFileSync('D:/ProductAgent-LifeContext/.env.local','utf8');
const names=text.split(/\r?\n/).flatMap(line=>line.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1]||[]);
const base=text.match(/^\s*AI_BASE_URL\s*=\s*["']?([^\s"']+)/m)?.[1];
const host=base?new URL(base).hostname:null;
const report={at:new Date().toISOString(),paidRequests:0,accountChanges:0,credentialValuesReported:false,
 modelEndpointKind:host==='dashscope.aliyuncs.com'?'standard_dashscope':host&&/^[a-z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(host)?'specific_beijing_workspace':'other_or_missing',
 workspaceConfigured:names.some(n=>/WORKSPACE(_ID)?$|BAILIAN_WORKSPACE/.test(n)),
 knowledgeBaseConfigured:names.some(n=>/KNOWLEDGE_BASE|VECTOR_STORE|BAILIAN_INDEX/.test(n)),
 decision:'No guessed workspace host or empty vector store. If no verified workspace configuration exists, keep KB/Rerank/Embedding unconfigured; current exact-model short-document path remains explicitly separate.'};
fs.writeFileSync('docs/engineering/qwen-foundation-2026-11-02/evidence/configuration-scope.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
