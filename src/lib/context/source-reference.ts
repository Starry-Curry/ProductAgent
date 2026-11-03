import {createHash} from 'node:crypto';
import type {AcquiredDocument} from '../life/acquisition.ts';
import type {SourceSemanticObservation} from './source-semantics.ts';
import type {SourceSemanticsResult} from './source-semantics.ts';
import type {DatabaseSync} from 'node:sqlite';
import type {Item,State,Person} from '../domain.ts';
import {readKnowledge,storeOfficialDocument} from '../life/acquisition.ts';
import {scopedProductKnowledge} from './evidence-scope.ts';
import {authorize} from '../foundation/policy.ts';
import {AgentError} from '../agent/contracts.ts';

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

export type PublicSourceAssertion={id:string;text:string;kind:'fact'|'operation'|'condition';url:string;model:string;region:string;documentId:string;reference:KnowledgeReference};
/** The existing owner's document body stores ONLY locators into public original
 * text. User queries, inferred explanations/conditions, unknowns and personal
 * stories are never persisted as product knowledge. No second table/cache. */
export function saveSourceSelections(db:DatabaseSync,state:State,actor:Person,itemId:string,result:SourceSemanticsResult){
 const item=state.items.find(i=>i.id===itemId);
 if(!item||!authorize(db,state,actor,itemId).allowed)throw new AgentError('物品未获当前授权',403);
 const docs=scopedProductKnowledge(item,readKnowledge(db,state,actor,itemId)).map(d=>d.document);
 for(const doc of docs){
  const added=result.observations.filter(o=>o.kind!=='unknown'&&o.subject.itemId===itemId&&o.subject.model===item.model&&o.source.url===doc.url&&o.source.hash===doc.hash&&o.exactQuote&&o.quoteRange).map(o=>({reference:bindSemanticReference(o),kind:o.kind as 'fact'|'operation'|'condition',selectedBy:result.model})).filter(row=>hasCurrentKnowledgeReference([doc],row.reference));
  if(!added.length)continue;
  const old=doc.sourceSelections?.version===1?doc.sourceSelections.entries.filter(row=>hasCurrentKnowledgeReference([doc],row.reference)):[];
  const entries=[...old,...added].filter((row,n,all)=>all.findIndex(x=>x.reference.id===row.reference.id)===n);
  storeOfficialDocument(db,actor,item,{...doc,sourceSelections:{version:1,entries}});
 }
}
export function readSourceSelections(item:Item,documents:AcquiredDocument[]):PublicSourceAssertion[]{
 return scopedProductKnowledge(item,documents).flatMap(({document:doc})=>doc.sourceSelections?.version!==1?[]:doc.sourceSelections.entries.flatMap(entry=>{
  const ref=entry.reference;if(!hasCurrentKnowledgeReference([doc],ref)||!ref.quoteRange)return [];
  const text=ref.sourceId===doc.id?doc.text:doc.chunks.find(c=>c.id===ref.sourceId)?.text;if(text===undefined)return [];
  return [{id:ref.id,text:text.slice(ref.quoteRange.start,ref.quoteRange.end),kind:entry.kind,url:doc.url,model:doc.model,region:doc.region,documentId:doc.id,reference:ref}];
 }));
}
