import type {Item} from '../domain.ts';
import {projectReality} from './reality.ts';
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase();
export function relevanceTerms(query:string){return [...new Set([...new Intl.Segmenter('zh',{granularity:'word'}).segment(normalize(query))].map(s=>s.segment.trim()).filter(s=>s.length>1))];}
/** Exact/lexical selection only; zero score means unknown relevance, not an
 * excuse to send the first inventory entries. Semantic rerank may refine it. */
export function resourceCatalogue(items:Item[],query:string,requiredIds:string[]=[],limit=12){
 const terms=relevanceTerms(query),q=normalize(query);
 const rows=items.map(i=>{
  const effects=projectReality(i).capabilities.filter(c=>c.status==='conditional').map(c=>c.effect);
  const text=normalize([i.name,i.brand,i.model,i.category,...effects].join(' '));
  const score=(requiredIds.includes(i.id)?1000:0)+(i.model&&i.model.length>2&&q.includes(normalize(i.model))?200:0)+(q.includes(normalize(i.name))?100:0)+terms.reduce((n,t)=>n+(text.includes(t)?t.length:0),0);
  return {item:i,score,effects};
 }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.item.id.localeCompare(b.item.id));
 return {items:rows.slice(0,limit).map(({item:i,effects})=>({id:i.id,name:i.name,model:i.model,category:i.category,effects})),total:items.length,matched:rows.length,truncated:rows.length>limit,unmatched:rows.length===0};
}
