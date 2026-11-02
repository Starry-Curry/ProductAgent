import type {Item} from '../domain.ts';
import {trustedOfficialDocument,type AcquiredDocument} from '../life/acquisition.ts';
import {modelMentioned} from '../life/knowledge.ts';
// Correlate product + spec pages only by the exact manufacturer's product path.
// A general support page, brand name or similar model is never such a relation.
export function officialProductPath(url:string){
  const u=new URL(url),parts=u.pathname.split('/').filter(Boolean);
  const marker=parts.findIndex(p=>p==='product'||p==='p');
  return marker>=0&&parts[marker+1]?u.hostname.replace(/^www\./,'')+'/'+parts[marker+1]:undefined;
}
function sourceRegion(url:string,fallback:string){
  if(fallback&&fallback!=='unspecified')return fallback;
  const first=new URL(url).pathname.split('/').filter(Boolean)[0];
  return ['cn','sg','hk','tw','gb','jp','us','in','ae-en','nz','au','global','my'].includes(first)?first:fallback||'unspecified';
}

export function scopedProductKnowledge(item:Item,all:AcquiredDocument[]){
    const official=all.filter(d=>d.model===item.model&&trustedOfficialDocument(d,item,all));
    const exact=official.filter(d=>modelMentioned(d.title+' '+d.text,item.model));
    const inherited=official.filter(d=>d.applicability==='manufacturer_linked_manual');
    return official.filter(d=>{
      const region=sourceRegion(d.url,d.region);
      const path=officialProductPath(d.url);
      return (!item.region||item.region==='unspecified'||region===item.region||region==='unspecified')&&
        (exact.some(e=>e.id===d.id)||inherited.some(e=>e.id===d.id)||!!path&&exact.some(e=>officialProductPath(e.url)===path));
    }).map(d=>({scopeBasis:exact.some(e=>e.id===d.id)?'exact_model_in_official_document':inherited.some(e=>e.id===d.id)?'manufacturer_link_from_exact_model_page':'same_official_product_path_as_exact_model_spec',document:{...d,region:sourceRegion(d.url,d.region)}}));
}
