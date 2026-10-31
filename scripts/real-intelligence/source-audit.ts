import fs from "node:fs";
import { fetchPublicDocument } from "../../src/lib/life/sources.ts";
import { makeKnowledgeDocument } from "../../src/lib/life/acquisition.ts";
import { modelMentioned } from "../../src/lib/life/knowledge.ts";
import { bindReviewedFacts, sourceReviews } from "../../src/lib/foundation/reviewed-facts.ts";
import type { Item } from "../../src/lib/domain.ts";
const dir="docs/engineering/real-intelligence-2026-10-31/evidence";
fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(".runtime",{recursive:true});
const targets=[...new Map(sourceReviews.map(r=>[r.url,{url:r.url,model:r.model,region:r.region}])).values(),
 {url:"https://helpguide.sony.net/mdr/2958/v1/en/print.pdf",model:"WH-CH520",region:"unspecified"},
 {url:"https://dl.djicdn.com/downloads/DJI_Osmo_Mobile_6/UM/20260520/Osmo_Mobile_6_User_Manual_V1.8_en.pdf",model:"Osmo Mobile 6",region:"unspecified"}].filter((t,i,all)=>all.findIndex(x=>x.url===t.url)===i);
const report:{at:string;paidCalls:number;results:any[]}={at:new Date().toISOString(),paidCalls:0,results:[]},documents:any[]=[];
// Bounded batches; no authentication, proxy bypass, paid search, retry loop or external writes.
for(let offset=0;offset<targets.length;offset+=3){
 const rows=await Promise.all(targets.slice(offset,offset+3).map(async t=>{
   const started=performance.now();
   try{const page=await fetchPublicDocument(t.url),doc=makeKnowledgeDocument(page,{model:t.model,brand:"official-audit"} as Item,[],t.region);documents.push(doc);
     return {...t,ok:true,actualURL:page.url,modelMentioned:modelMentioned(page.title+" "+page.text,t.model),characters:page.text.length,hash:doc.hash,ms:Math.round(performance.now()-started),facts:bindReviewedFacts([doc]).map(f=>({predicate:f.predicate,value:f.value,description:f.description,source:f.source})),links:page.links.filter(l=>/\.pdf(?:$|[?#])/i.test(l.url)).slice(0,4)};
   }catch(e){return {...t,ok:false,ms:Math.round(performance.now()-started),error:e instanceof Error?e.message:"public_fetch_failed"};}
 }));report.results.push(...rows);fs.writeFileSync(dir+"/official-fetch.json",JSON.stringify(report,null,2));
}
// Full copyrighted documents are a local cache, never part of the published test evidence.
fs.writeFileSync(".runtime/official-audit-documents.json",JSON.stringify(documents));
console.log(JSON.stringify({attempts:targets.length,successful:report.results.filter(r=>r.ok).length,verifiedAtoms:report.results.reduce((n,r)=>n+(r.facts?.length||0),0),paidCalls:0}));

