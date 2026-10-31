import fs from 'node:fs';
import { fetchPublicDocument } from '../../src/lib/life/sources.ts';
import { makeKnowledgeDocument } from '../../src/lib/life/acquisition.ts';
import type { Item } from '../../src/lib/domain.ts';
const dir='docs/engineering/real-intelligence-2026-10-31/evidence';
const products=JSON.parse(fs.readFileSync('docs/engineering/unified-foundation-v2-2026-10-30/package/wujian_real_product_fixtures_v1.json','utf8')).products;
const models:Record<string,string>={'SONY-WH-CH520':'WH-CH520','JBL-CLIP5':'CLIP 5','LOGI-M185':'M185','CANON-R50':'EOS R50','XIAOMI-1S':'MJTD01SYL','PHILIPS-HD9252-90':'HD9252/90','IKEA-SAMLA11':'494.408.37','IKEA-KALLAX77':'703.518.86','DJI-OM6':'Osmo Mobile 6'};
const cached=JSON.parse(fs.readFileSync('.runtime/official-audit-documents.json','utf8'));
const documents:any[]=[],rows:any[]=[];
const jobs=Object.entries(products).flatMap(([id,p]:[string,any])=>p.official.map((s:any)=>({id,model:models[id],url:s.url})));
for(const d of cached){const id=Object.keys(models).find(k=>models[k]===d.model);if(id){documents.push({productId:id,document:d,acquisition:'live_current_round'});}}
for(let n=0;n<jobs.length;n+=3){
 const batch=await Promise.all(jobs.slice(n,n+3).map(async(j:any)=>{const start=performance.now();try{
  const page=await fetchPublicDocument(j.url);const region=j.id.startsWith('IKEA')?'jp':j.id==='LOGI-M185'?'my':'unspecified';
  const doc=makeKnowledgeDocument(page,{model:j.model,brand:j.id.split('-')[0]} as Item,[],region);
  documents.push({productId:j.id,document:doc,acquisition:'live_current_round'});
  return {...j,ok:true,characters:doc.text.length,hash:doc.hash,title:doc.title,ms:Math.round(performance.now()-start),pdfLinks:page.links.filter(l=>/\.pdf(?:$|[?#])/i.test(l.url)).slice(0,5)};
 }catch(e){return {...j,ok:false,ms:Math.round(performance.now()-start),error:(e as Error).message};}}));rows.push(...batch);
 fs.writeFileSync(dir+'/product-source-fetch.json',JSON.stringify({at:new Date().toISOString(),rows},null,2));
}
// No full manuals in Git; hash and acquisition failures above are public evidence.
fs.writeFileSync('.runtime/evaluation-documents.json',JSON.stringify(documents));
console.log(JSON.stringify({attempted:jobs.length,readable:rows.filter(r=>r.ok&&r.characters>100).length,failed:rows.filter(r=>!r.ok).map(r=>({product:r.id,error:r.error})),cachedDocuments:documents.length}));
