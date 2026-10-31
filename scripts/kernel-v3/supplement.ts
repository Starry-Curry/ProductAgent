import fs from 'node:fs';
import {fetchPublicDocument} from '../../src/lib/life/sources.ts';
import {makeKnowledgeDocument} from '../../src/lib/life/acquisition.ts';
import {modelMentioned,officialDomain} from '../../src/lib/life/knowledge.ts';
const root='docs/engineering/intelligence-kernel-v3-2026-10-31/evidence';
const products=JSON.parse(fs.readFileSync('scripts/kernel-v3/products.json','utf8'));
const jobs=[{productId:'NEW-LEGO-42179',url:'https://www.lego.com/cdn/cs/set/assets/blt40a94cbfd3d42e57/LEGO_CAEN_SpringCatalog2024_Cropped.pdf',role:'product_catalogue_not_manual'}];
const file=root+'/supplement-fetch.json';if(fs.existsSync(file))throw Error('preserve_fetch_history');
const docs=JSON.parse(fs.readFileSync('.runtime/kernel-new-documents.json','utf8')),rows=[];
for(const j of jobs){const p=products.find((p:any)=>p.id===j.productId),started=performance.now();try{
 const page=await fetchPublicDocument(j.url),doc=makeKnowledgeDocument(page,p,[],p.region);
 const ok=officialDomain(page.url,p.brand)&&modelMentioned(page.text,p.model);
 if(ok)docs.push({productId:p.id,document:doc,acquisition:'live_v3_catalogue_not_manual'});
 rows.push({...j,ok,title:page.title,characters:page.text.length,hash:doc.hash,ms:Math.round(performance.now()-started),modelMentioned:modelMentioned(page.text,p.model)});
}catch(e){rows.push({...j,ok:false,error:(e as Error).message,ms:Math.round(performance.now()-started)});}}
fs.writeFileSync(file,JSON.stringify({at:new Date().toISOString(),paidCalls:0,rows},null,2)+'\n');fs.writeFileSync('.runtime/kernel-new-documents.json',JSON.stringify(docs));console.log(JSON.stringify(rows));
