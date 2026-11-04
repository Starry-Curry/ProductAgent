import type { AcquiredDocument,KnowledgeChunk } from "../../life/acquisition.ts";

/** Generic lexical query windows with per-document diversity. Translated queries are
 * optional model proposals, never evidence. Original exact text and offsets survive. */
export function retrieveTaskPassages(documents:AcquiredDocument[],queries:string[],seeds:KnowledgeChunk[]=[],maxChars=30000){
  const terms=new Set(queries.flatMap(q=>{
    const lower=q.normalize("NFKC").toLowerCase();
    const words=lower.match(/[a-z0-9]+(?:[.-][a-z0-9]+)*|[\p{Script=Han}]{2,}/gu)||[];
    return words.flatMap(w=>/\p{Script=Han}/u.test(w)?[...new Intl.Segmenter('zh',{granularity:'word'}).segment(w)].map(s=>s.segment):[w]);
  }).filter(w=>w.length>1));
  const seedIds=new Set(seeds.map(s=>s.id));
  const scored=documents.flatMap(d=>d.chunks.map(c=>({c,score:[...terms].reduce((n,t)=>n+(c.text.toLowerCase().includes(t)?Math.min(t.length,8):0)+2*(c.title.toLowerCase().includes(t)?Math.min(t.length,8):0),0)+(seedIds.has(c.id)?8:0)})))
    .sort((a,b)=>b.score-a.score||a.c.start-b.c.start);
  // Diversify among relevant documents FIRST. The old per-document floor was
  // allocated before relevance, letting unrelated support/firmware pages fill
  // the budget and hide an operation in a later manual. A match is retrieval,
  // never proof of a claim. Keep a diverse fallback when no terms match.
  const relevant=scored.filter(x=>x.score>0);
  const bestPerDocument=documents.flatMap(d=>relevant.filter(x=>x.c.documentId===d.id).slice(0,1)).sort((a,b)=>b.score-a.score);
  const queue=[...bestPerDocument,...relevant,...documents.flatMap(d=>scored.filter(x=>x.c.documentId===d.id).slice(0,2)),...scored];
  const result:KnowledgeChunk[]=[];let size=0;
  for(const {c}of queue){
    if(result.some(s=>s.id===c.id))continue;
    if(size+c.text.length>maxChars)continue;
    result.push(c);size+=c.text.length;
  }
  return result;
}
