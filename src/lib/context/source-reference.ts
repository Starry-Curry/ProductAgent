import {createHash} from 'node:crypto';
import type {AcquiredDocument} from '../life/acquisition.ts';
import type {SourceSemanticObservation} from './source-semantics.ts';

/** Server-derived locator in the existing original-document store. The model
 * only selects a supplied assertion ID; it never supplies these hash operands. */
export type KnowledgeReference={id:string;url:string;sourceId?:string;documentHash?:string;quoteRange?:{start:number;end:number};quoteHash?:string};
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export function bindSemanticReference(observation:SourceSemanticObservation):KnowledgeReference{
 if(observation.kind==='unknown'||!observation.exactQuote||!observation.quoteRange)throw Error('cannot_bind_unquoted_semantic_gap');
 return {id:observation.id,url:observation.source.url,sourceId:observation.sourceId,documentHash:observation.source.hash,quoteRange:{...observation.quoteRange},quoteHash:hash(observation.exactQuote)};
}
/** The caller must first apply current item/model/region/permission scope. A
 * locator confirms unchanged original evidence, not the correctness of prose. */
export function hasCurrentKnowledgeReference(documents:AcquiredDocument[],reference:KnowledgeReference){
 for(const doc of documents){
  if(doc.url!==reference.url)continue;
  if(reference.id.startsWith('sem:')){
   if(!reference.sourceId||!reference.documentHash||doc.hash!==reference.documentHash||!reference.quoteRange||!reference.quoteHash)continue;
   const source=reference.sourceId===doc.id?doc.text:doc.chunks.find(c=>c.id===reference.sourceId)?.text;
   if(source===undefined)continue;
   const {start,end}=reference.quoteRange;
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>source.length)continue;
   if(hash(source.slice(start,end))===reference.quoteHash)return true;
  }else if(!reference.sourceId&&!reference.quoteRange&&!reference.quoteHash&&(!reference.documentHash||doc.hash===reference.documentHash)&&
   (reference.id===doc.id||doc.chunks.some(c=>c.id===reference.id)))return true;
 }
 return false;
}
