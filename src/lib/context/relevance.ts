import type {Item} from '../domain.ts';
import {projectReality} from './reality.ts';
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase();
export function relevanceTerms(query:string){return [...new Set([...new Intl.Segmenter('zh',{granularity:'word'}).segment(normalize(query))].map(s=>s.segment.trim()).filter(s=>s.length>1))];}
/** Resolve explicit resource references before choosing the small detailed
 * context. A name's distinctive token can match a natural shortened name;
 * tokens shared by the inventory (e.g. display/test prefixes) cannot pull every
 * item and its private context in. This does not route an intent or grant access. */
export function mentionedResourceIds(items:Item[],query:string){
 const q=normalize(query),terms=new Set(relevanceTerms(query));
 const names=items.map(i=>{const words=relevanceTerms(i.name),han=[...new Intl.Segmenter('zh',{granularity:'word'}).segment(normalize(i.name))].map(s=>s.segment.trim()).filter(w=>/\p{Script=Han}/u.test(w));return {item:i,tokens:new Set(words),head:(han.length?han:words).at(-1)};});
 const frequency=new Map<string,number>();for(const n of names)for(const t of n.tokens)frequency.set(t,(frequency.get(t)||0)+1);
 // A distinctive HEAD may resolve a shortened name. A modifier alone cannot:
 // mentioning a phone does not mention a phone gimbal or grant its details.
 return new Set(names.filter(({item,head})=>q.includes(normalize(item.name))||!!head&&frequency.get(head)===1&&terms.has(head)).map(n=>n.item.id));
}
/** Exact/lexical selection only; zero score means unknown relevance, not an
 * excuse to send the first inventory entries. Semantic rerank may refine it. */
export function resourceCatalogue(items:Item[],query:string,requiredIds:string[]=[],limit=12,knownEffects:Record<string,string[]>={},knowledge:Record<string,string[]>={}){
 const terms=relevanceTerms(query),q=normalize(query);
 const rows=items.map(i=>{
  const effects=knownEffects[i.id]||projectReality(i).capabilities.filter(c=>c.status==='conditional').map(c=>c.effect);
  const text=normalize([i.name,i.brand,i.model,i.category,...effects,...(knowledge[i.id]||[])].join(' '));
  const score=(requiredIds.includes(i.id)?1000:0)+(i.model&&i.model.length>2&&q.includes(normalize(i.model))?200:0)+(q.includes(normalize(i.name))?100:0)+terms.reduce((n,t)=>n+(text.includes(t)?t.length:0),0);
  return {item:i,score,effects};
 }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.item.id.localeCompare(b.item.id));
 return {items:rows.slice(0,limit).map(({item:i,effects})=>({id:i.id,name:i.name,model:i.model,category:i.category,effects})),total:items.length,matched:rows.length,truncated:rows.length>limit,unmatched:rows.length===0};
}
