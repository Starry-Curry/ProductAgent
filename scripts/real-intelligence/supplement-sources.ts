import fs from 'node:fs';
import { fetchPublicDocument } from '../../src/lib/life/sources.ts';
import { makeKnowledgeDocument } from '../../src/lib/life/acquisition.ts';
import type { Item } from '../../src/lib/domain.ts';
const path='.runtime/evaluation-documents.json',docs=JSON.parse(fs.readFileSync(path,'utf8'));
const j=JSON.parse(fs.readFileSync('../product-foundation-app/.runtime/research/jbl-clip5-pdf.json','utf8'));
const jobs=[{productId:'JBL-CLIP5',model:'CLIP 5',url:j.url},{productId:'DJI-OM6',model:'Osmo Mobile 6',url:'https://www.dji.com/global/osmo-mobile-6/faq'}];
const results=[];
for(const job of jobs){const start=performance.now();try{const page=await fetchPublicDocument(job.url);const doc=makeKnowledgeDocument(page,{model:job.model} as Item,[],'unspecified');docs.push({productId:job.productId,document:doc,acquisition:'live_supplement_current_round'});results.push({...job,ok:true,characters:doc.text.length,hash:doc.hash,ms:Math.round(performance.now()-start)});}catch(e){results.push({...job,ok:false,error:(e as Error).message});}}
fs.writeFileSync(path,JSON.stringify(docs));fs.writeFileSync('docs/engineering/real-intelligence-2026-10-31/evidence/supplement-source-fetch.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
