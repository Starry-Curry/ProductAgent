import type { DatabaseSync } from "node:sqlite";
import { canRead,type State,type Person } from "../../domain.ts";
import type { ServiceSession } from "../contracts.ts";
import { itemContext } from "../../context/items.ts";
import { buildContext } from "../../context/builder.ts";
import { readKnowledge, retrieveKnowledge } from "../../life/acquisition.ts";
import { modelMentioned,officialDomain } from "../../life/knowledge.ts";
import { resolveTaskContext } from "../../foundation/tasks.ts";
import { virtualHomeItems } from "../../life/virtual-home.ts";
import { authorize } from "../../foundation/policy.ts";
import { retrieveTaskPassages } from "./retrieval.ts";
import type { EvidencePassage } from "./contracts.ts";
import {rectangleCondition} from './physical.ts';

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

export function kernelContext(db:DatabaseSync,state:State,actor:Person,session:ServiceSession,question:string,temporary=false,queries:string[]=[],extraIds:string[]=[]){
  const taskId=session.known.foundationTaskId;
  const taskContext=taskId?resolveTaskContext(db,state,actor,taskId):undefined;
  const task=taskContext?.task;
  const focus=session.itemId||session.known.activeItemId;
  const home=session.known.homeId==='young-apartment-v1';
  const homeIds=new Set(home?virtualHomeItems(state,actor).map(i=>i.id):[]);
  const allowed=state.items.filter(i=>canRead(i,actor)&&authorize(db,state,actor,i.id).allowed&&(home?homeIds.has(i.id):!i.demo&&(i.source!=='示例数据'||i.id===focus||task?.itemInstanceIds.includes(i.id)))&&(!task||task.itemInstanceIds.includes(i.id)));
  const mentioned=(s:string)=>s.length>1&&question.toLowerCase().includes(s.toLowerCase());
  const selected=allowed.filter(i=>i.id===focus||task?.itemInstanceIds.includes(i.id)||extraIds.includes(i.id)||mentioned(i.model)||mentioned(i.name)||
    // Entity matching only. It never chooses an intent or provides a product fact.
    [...new Intl.Segmenter('zh',{granularity:'word'}).segment(i.name)].some(s=>s.segment.length>=2&&mentioned(s.segment)));
  const contexts=selected.map(i=>buildContext(db,state,actor,{question,knowledgeQuery:[question,...queries].join(' '),mode:'service',itemId:i.id,temporary,sessionId:session.id,
    taskMemoryOnly:true,includeItemRelationships:session.known.useItemMemories==='yes',companion:!!session.known.companionItemId,useExperiences:session.known.memoryPolicy!=='off'}));
  const memoryOn=session.known.memoryPolicy!=='off'&&!temporary;
  const documents=selected.flatMap(i=>{
    const official=readKnowledge(db,state,actor,i.id).filter(d=>d.model===i.model&&officialDomain(d.url,i.brand||d.brand||''));
    const exact=official.filter(d=>modelMentioned(d.title+' '+d.text,i.model));
    return official.filter(d=>{
      const region=sourceRegion(d.url,d.region);
      const path=officialProductPath(d.url);
      return (!i.region||i.region==='unspecified'||region===i.region||region==='unspecified')&&
        (exact.some(e=>e.id===d.id)||!!path&&exact.some(e=>officialProductPath(e.url)===path));
    }).map(d=>({itemId:i.id,scopeBasis:exact.some(e=>e.id===d.id)?'exact_model_in_official_document':'same_official_product_path_as_exact_model_spec',document:{...d,region:sourceRegion(d.url,d.region)}}));
  });
  const evidence:EvidencePassage[]=selected.flatMap(i=>{
    const docs=documents.filter(d=>d.itemId===i.id).map(d=>d.document);
    const seed=retrieveKnowledge(db,state,actor,i.id,question);
    return retrieveTaskPassages(docs,[question,...queries],seed,Math.floor(36000/Math.max(1,selected.length)))
      .map(c=>({id:c.id,itemId:i.id,model:c.model,region:docs.find(d=>d.id===c.documentId)?.region||c.region,title:c.title,text:c.text,url:c.url,documentId:c.documentId,fetchedAt:docs.find(d=>d.id===c.documentId)?.fetchedAt,scopeBasis:documents.find(d=>d.document.id===c.documentId)?.scopeBasis,basis:'official' as const}));
  });
  const experiences=memoryOn?contexts.flatMap(c=>c.cloudExperiences).filter((e,n,a)=>a.findIndex(r=>r.outcomeId===e.outcomeId)===n):[];
  const memories=memoryOn?contexts.flatMap(c=>c.cloudMemories).filter((e,n,a)=>a.findIndex(r=>r.id===e.id)===n):[];
  const stories=memoryOn?contexts.flatMap(c=>c.cloudFragments).filter((e,n,a)=>a.findIndex(r=>r.id===e.id)===n):[];
  for(const r of experiences)evidence.push({id:r.outcomeId,itemId:r.itemInstanceIds[0],model:'',region:'',title:'获准的用户尝试报告',text:r.notes,basis:'experience'});
  for(const r of memories)evidence.push({id:r.id,itemId:r.itemId||'',model:'',region:'',title:'获准个人记忆',text:r.text,basis:'user_report'});
  for(const r of stories)evidence.push({id:r.id,itemId:focus||'',model:'',region:'',title:'获准物品故事',text:r.text,basis:'user_report'});
  return {
    question,items:selected.map(itemContext),
    // No owners, locations, notes, photos or private stories in the catalogue.
    catalogue:allowed.slice(0,80).map(i=>({id:i.id,name:i.name,model:i.model,category:i.category})),
    evidence,experiences,
    // Only explicitly recorded dimensions take part in arithmetic. These are still
    // user reports, not manufacturer facts or observed stability measurements.
    necessaryConditionChecks:selected.flatMap(object=>selected.filter(space=>space.id!==object.id).flatMap(space=>{
      const outer=object.attributes?.physicalFacts?.find(f=>f.key==='outer_mm'&&Array.isArray(f.value));
      const inner=space.attributes?.physicalFacts?.find(f=>f.key==='inner_mm'&&Array.isArray(f.value));
      if(!outer||!inner)return [];
      const a=outer.value as [number,number,number],b=inner.value as [number,number,number];
      return [{itemIds:[object.id,space.id],operandIds:[outer.id,inner.id],basis:'registered_user_report_parameters_not_device_readback',result:rectangleCondition([a[0],a[1]],[b[0],b[1]],'internal'),heightNotChecked:true}];
    })),
    preferences:memoryOn?contexts.flatMap(c=>c.cloudPreferences).filter((p,n,a)=>a.findIndex(r=>r.key===p.key&&r.value===p.value)===n):[],
    tried:session.tried,
    history:session.messages.slice(-6).map(m=>({role:m.role,text:m.text.slice(0,1800)})),
    currentTask:task?{goal:taskContext!.modelGoal,itemIds:task.itemInstanceIds}:undefined,
    permissions:{readOnly:true,hardwareExecuted:false,memoryPolicy:session.known.memoryPolicy||'legacy'},
    retrieval:{documents:documents.map(d=>({itemId:d.itemId,id:d.document.id,hash:d.document.hash,url:d.document.url,model:d.document.model,region:d.document.region})),missingItemIds:selected.filter(i=>!documents.some(d=>d.itemId===i.id)).map(i=>i.id)},
    // Explicitly a synthetic household, never a real ownership assertion.
    household:home?'virtual_young_apartment':'user_registered_items_not_physically_verified',
  };
}
export type KernelContext=ReturnType<typeof kernelContext>;
