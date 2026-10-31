import fs from 'node:fs';
import {validationFixture} from '../life-validation-fixture.ts';
import {migrateUnified} from '../../src/lib/foundation/schema.ts';
import {storeOfficialDocument} from '../../src/lib/life/acquisition.ts';
export const reportRoot='docs/engineering/intelligence-kernel-v3-2026-10-31/evidence';
export function kernelFixture(stage:string){
 if(!/^[a-z0-9-]+$/.test(stage))throw Error('isolated_stage_required');
 const f=validationFixture('.runtime/kernel-'+stage);migrateUnified(f.db);
 const originals=JSON.parse(fs.readFileSync('docs/engineering/unified-foundation-v2-2026-10-30/package/wujian_real_product_fixtures_v1.json','utf8')).products;
 const modelMap:Record<string,string>={'SONY-WH-CH520':'WH-CH520','JBL-CLIP5':'CLIP 5','LOGI-M185':'M185','CANON-R50':'EOS R50','XIAOMI-1S':'MJTD01SYL','PHILIPS-HD9252-90':'HD9252/90','IKEA-SAMLA11':'494.408.37','IKEA-KALLAX77':'703.518.86','DJI-OM6':'Osmo Mobile 6'};
 const products=[...Object.entries(originals).map(([id,p]:[string,any])=>({id,model:modelMap[id],name:p.name,category:p.category,brand:id.split('-')[0],region:id.startsWith('IKEA')?'jp':id==='LOGI-M185'?'my':'unspecified'})),...JSON.parse(fs.readFileSync('scripts/kernel-v3/products.json','utf8'))];
 const pointer=fs.existsSync('.runtime/kernel-corpus-current.json')?JSON.parse(fs.readFileSync('.runtime/kernel-corpus-current.json','utf8')):undefined;
 if(pointer&&!/^\.runtime\/kernel-corpus-[a-z0-9-]+\.json$/.test(pointer.cache||''))throw Error('public_corpus_path_outside_isolated_runtime');
 const oldCache=pointer?.cache||'D:/ProductAgent-LifeContext/.runtime/real-intelligence-eval-v1/.runtime/evaluation-documents.json';
 if(!fs.existsSync(oldCache))throw Error('public_corpus_missing_run_rebuild_corpus_with_unique_stage_before_paid_evaluation');
 const cached=JSON.parse(fs.readFileSync(oldCache,'utf8'));
 const current=fs.existsSync('.runtime/kernel-new-documents.json')?JSON.parse(fs.readFileSync('.runtime/kernel-new-documents.json','utf8')):[];
 const ids:Record<string,string>={};
 for(const p of products){
  const id=f.add('[合成持有，仅测试] '+p.name,p.category||'其他',p.brand,p.model,{region:p.region});ids[p.id]=id;
  const state=f.read();state.items.find(i=>i.id===id)!.synthetic=true;f.write(state);
  const item=f.read().items.find(i=>i.id===id)!;
  for(const {document}of [...cached,...current].filter((d:any)=>d.productId===p.id&&d.document.text.length>100))storeOfficialDocument(f.db,'lin',item,{...document,model:p.model,region:p.region});
 }
 return {...f,ids,products,cacheNotice:'Historical official body cache explicitly reused; current new-model fetch manifest separate. No secret or private database copied.'};
}
