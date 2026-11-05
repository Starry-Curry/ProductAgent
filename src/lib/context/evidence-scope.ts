import type {Item} from '../domain.ts';
import {trustedOfficialDocument,manufacturerLinkedManual,regionOf,type AcquiredDocument} from '../life/acquisition.ts';
import {modelMentioned} from '../life/knowledge.ts';
// Legacy navigation grouping only. A shared path/category or query endpoint
// is not identity evidence and must never authorize cross-page product facts.
export function officialProductPath(url:string){
  const u=new URL(url),parts=u.pathname.split('/').filter(Boolean);
  const marker=parts.findIndex(p=>p==='product'||p==='p');
  return marker>=0&&parts[marker+1]?u.hostname.replace(/^www\./,'')+'/'+parts[marker+1]:undefined;
}
function sourceRegion(url:string,fallback:string){
  if(fallback&&fallback!=='unspecified')return fallback;
  const region=regionOf(url);if(region!=='unspecified')return region;
  const first=new URL(url).pathname.split('/').filter(Boolean)[0];
  return ['in','ae-en','nz'].includes(first)?first:fallback||'unspecified';
}

export function scopedProductKnowledge(item:Item,all:AcquiredDocument[]){
    const official=all.filter(d=>d.model===item.model&&(!d.productModels?.length||d.productModels.some(m=>modelMentioned(m,item.model)))&&trustedOfficialDocument(d,item,all));
    const exact=official.filter(d=>modelMentioned(d.title+' '+d.text,item.model));
    const inherited=official.filter(d=>manufacturerLinkedManual(d,item,all));
    return official.filter(d=>{
      const region=sourceRegion(d.url,d.region);
      return (!item.region||item.region==='unspecified'||region===item.region||region==='unspecified')&&
        (exact.some(e=>e.id===d.id)||inherited.some(e=>e.id===d.id));
    }).map(d=>({scopeBasis:exact.some(e=>e.id===d.id)?'exact_model_in_official_document':'manufacturer_link_from_exact_model_page',document:{...d,region:sourceRegion(d.url,d.region)}}));
}
