import type {AcquiredDocument,KnowledgeChunk} from '../life/acquisition.ts';
/** Round-robin exact originals, not the first HTML pages or a semantic summary.
 * Caller supplies already scoped/authorized public documents only. */
export function rerankCandidates(documents:AcquiredDocument[],query:string){
 const rows:KnowledgeChunk[]=[],seen=new Set<string>();let bound=0;
 const width=Math.max(0,...documents.map(d=>d.chunks.length));
 for(let at=0;at<width;at++)for(const doc of documents){
  const c=doc.chunks[at];if(!c||seen.has(c.id)||c.text.length>1800||!c.text.trim())continue;
  const bytes=Buffer.byteLength(c.text)+Buffer.byteLength(query);if(rows.length>=96||bound+bytes>100000)continue;
  rows.push(c);bound+=bytes;seen.add(c.id);
 }
 return rows;
}
