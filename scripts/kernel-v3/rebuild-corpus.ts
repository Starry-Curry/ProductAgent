import fs from 'node:fs';
import {fetchPublicDocument} from '../../src/lib/life/sources.ts';
import {makeKnowledgeDocument} from '../../src/lib/life/acquisition.ts';
import {modelMentioned,officialDomain} from '../../src/lib/life/knowledge.ts';
import {sourceReviews} from '../../src/lib/foundation/reviewed-facts.ts';
const stage=process.argv.find(s=>s.startsWith('--stage='))?.slice(8);
if(!stage||!/^[a-z0-9-]+$/.test(stage))throw Error('unique_public_source_stage_required');
const root='docs/engineering/intelligence-kernel-v3-2026-10-31/evidence';
const output=root+'/corpus-fetch-'+stage+'.json',cache='.runtime/kernel-corpus-'+stage+'.json';
if(fs.existsSync(output)||fs.existsSync(cache))throw Error('preserve_existing_source_stage');
const original=JSON.parse(fs.readFileSync('docs/engineering/unified-foundation-v2-2026-10-30/package/wujian_real_product_fixtures_v1.json','utf8')).products;
const models:Record<string,string>={'SONY-WH-CH520':'WH-CH520','JBL-CLIP5':'CLIP 5','LOGI-M185':'M185','CANON-R50':'EOS R50','XIAOMI-1S':'MJTD01SYL','PHILIPS-HD9252-90':'HD9252/90','IKEA-SAMLA11':'494.408.37','IKEA-KALLAX77':'703.518.86','DJI-OM6':'Osmo Mobile 6'};
const products=[...Object.entries(original).map(([id,p]:[string,any])=>({id,brand:id.split('-')[0],model:models[id],region:id.startsWith('IKEA')?'jp':id==='LOGI-M185'?'my':'unspecified',urls:p.official.map((s:any)=>s.url)})),...JSON.parse(fs.readFileSync('scripts/kernel-v3/products.json','utf8'))];
for(const p of products)for(const r of sourceReviews.filter(r=>r.model===p.model))if(!p.urls.includes(r.url))p.urls.push(r.url);
const jobs=products.flatMap(p=>p.urls.map((url:string)=>({p,url}))),rows:any[]=[],documents:any[]=[];
fs.mkdirSync('.runtime',{recursive:true});fs.mkdirSync(root,{recursive:true});
for(let n=0;n<jobs.length;n+=3){
 const batch=await Promise.all(jobs.slice(n,n+3).map(async({p,url}:any)=>{const start=performance.now();try{
  const page=await fetchPublicDocument(url),doc=makeKnowledgeDocument(page,p,[],p.region);
  const official=officialDomain(page.url,p.brand),model=modelMentioned(page.title+' '+page.text,p.model);
  // Keep a same-product-page candidate for the normal applicability pipeline;
  // it still needs a model-confirming document there. Do not forge model text.
  const ok=official&&page.text.length>150;
  if(ok)documents.push({productId:p.id,document:doc,acquisition:'fresh_recovery_fetch_model_scope_checked_on_read'});
  return {id:p.id,url,actualURL:page.url,official,modelMentioned:model,readable:ok,characters:page.text.length,hash:doc.hash,elapsedMs:Math.round(performance.now()-start)};
 }catch(e){return {id:p.id,url,readable:false,error:(e as Error).message,elapsedMs:Math.round(performance.now()-start)};}}));
 rows.push(...batch);fs.writeFileSync(output,JSON.stringify({at:new Date().toISOString(),paidCalls:0,rows},null,2)+'\n');
}
fs.writeFileSync(cache,JSON.stringify(documents));
fs.writeFileSync('.runtime/kernel-corpus-current.json',JSON.stringify({cache,manifest:output})+'\n');
console.log(JSON.stringify({cache,manifest:output,readable:documents.length,paidCalls:0}));
