import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fetchPublicDocument} from '../../src/lib/life/sources.ts';
import {makeKnowledgeDocument} from '../../src/lib/life/acquisition.ts';
import {modelMentioned,officialDomain} from '../../src/lib/life/knowledge.ts';
import type {Item} from '../../src/lib/domain.ts';
const root='docs/engineering/intelligence-kernel-v3-2026-10-31/evidence';
const products=JSON.parse(fs.readFileSync('scripts/kernel-v3/products.json','utf8'));
const output=root+'/new-product-fetch.json';
if(fs.existsSync(output))throw Error('preserve_source_evidence_use_a_new_stage');
fs.mkdirSync('.runtime',{recursive:true});fs.mkdirSync(root,{recursive:true});
const rows:any[]=[],documents:any[]=[];
const jobs=products.flatMap((p:any)=>p.urls.map((url:string)=>({p,url})));
for(let offset=0;offset<jobs.length;offset+=3){
 const batch=await Promise.all(jobs.slice(offset,offset+3).map(async({p,url}:any)=>{
  const started=performance.now();try{
   const page=await fetchPublicDocument(url);
   const sourceOfficial=officialDomain(page.url,p.brand),subject=modelMentioned(page.title+' '+page.text,p.model);
   const usable=sourceOfficial&&subject&&page.text.length>150;
   if(usable)documents.push({productId:p.id,document:makeKnowledgeDocument(page,p as Item,[],p.region),acquisition:'live_v3_public_fetch'});
   return {id:p.id,url,actualUrl:page.url,ok:usable,sourceOfficial,modelMentioned:subject,model:p.model,region:p.region,title:page.title,characters:page.text.length,textHash:createHash('sha256').update(page.text).digest('hex'),elapsedMs:Math.round(performance.now()-started),fetchedAt:new Date().toISOString(),reason:usable?undefined:'HTTP returned but model/body/applicability not established'};
  }catch(e){return {id:p.id,url,ok:false,error:(e as Error).message,elapsedMs:Math.round(performance.now()-started)};}
 }));rows.push(...batch);fs.writeFileSync(output,JSON.stringify({at:new Date().toISOString(),paidCalls:0,ownership:'no real ownership asserted; synthetic test holders only',rows},null,2)+'\n');
}
fs.writeFileSync('.runtime/kernel-new-documents.json',JSON.stringify(documents));
console.log(JSON.stringify({urls:jobs.length,readable:rows.filter(r=>r.ok).length,models:products.map((p:any)=>({id:p.id,available:documents.some(d=>d.productId===p.id)})),failures:rows.filter(r=>!r.ok)}));
