import type { DatabaseSync } from "node:sqlite";
import { canRead,type State,type Person } from "../domain.ts";
import type { ServiceSession } from "../agent/contracts.ts";
import { itemContext } from "./items.ts";
import { buildContext } from "./builder.ts";
import { readKnowledge, retrieveKnowledge } from "../life/acquisition.ts";
import {scopedProductKnowledge} from "./evidence-scope.ts";
export {officialProductPath} from "./evidence-scope.ts";
import { resolveTaskContext } from "../foundation/tasks.ts";
import { virtualHomeItems } from "../life/virtual-home.ts";
import { authorize } from "../foundation/policy.ts";
import { retrieveTaskPassages } from "../agent/kernel/retrieval.ts";
import type { EvidencePassage } from "../agent/kernel/contracts.ts";
import {readReality} from './reality-service.ts';
import {resourceCatalogue} from './relevance.ts';
import {fingerprint} from '../foundation/legacy.ts';
import {epoch,listMemories,effectivePersona} from '../memory/store.ts';
import {rectangleCondition} from '../agent/kernel/physical.ts';
import {storyMemoryRelevant} from '../life/organization.ts';
import {isMemoryRecallRequest} from '../skills/memory-storytelling.ts';
import {listLifeIdeas} from '../life/ideas.ts';
import {discoveryInput} from '../life/planning.ts';


export function compileTaskContext(db:DatabaseSync,state:State,actor:Person,session:ServiceSession,question:string,temporary=false,queries:string[]=[],extraIds:string[]=[],evidenceByteBudget?:number){
  const taskId=session.known.foundationTaskId;
  const taskContext=taskId?resolveTaskContext(db,state,actor,taskId):undefined;
  const task=taskContext?.task;
  const focus=session.itemId||session.known.activeItemId||session.known.homeVoiceItemId;
  const home=session.known.homeId==='young-apartment-v1';
  const homeIds=new Set(home?virtualHomeItems(state,actor).map(i=>i.id):[]);
  // Task membership limits the initial detailed load, not discovery of the
  // actor's other authorized resources. No stories/locations/notes in catalogue.
  const allowed=state.items.filter(i=>canRead(i,actor)&&authorize(db,state,actor,i.id).allowed&&(home?homeIds.has(i.id):!i.demo&&(i.source!=='示例数据'||i.id===focus||task?.itemInstanceIds.includes(i.id))));
  const mentioned=(s:string)=>s.length>1&&question.toLowerCase().includes(s.toLowerCase());
  const focused=allowed.find(i=>i.id===focus);
  let selected=allowed.filter(i=>i.id===focus||task?.itemInstanceIds.includes(i.id)||extraIds.includes(i.id)||!task&&(mentioned(i.name)||(!focused||i.model!==focused.model)&&mentioned(i.model))||
    // Entity matching only. It never chooses an intent or provides a product fact.
    !task&&!evidenceByteBudget&&[...new Intl.Segmenter('zh',{granularity:'word'}).segment(i.name)].some(s=>s.segment.length>=2&&mentioned(s.segment)));
  // A goal without a named SKU may still have clear recorded capability/name
  // matches. Prefill a few ranked candidates rather than requiring a tool round
  // for already available facts. Others remain discoverable through the tool.
  if(!selected.length){const candidates=resourceCatalogue(allowed,question,[],3).items;selected=candidates.map(r=>allowed.find(i=>i.id===r.id)!);}
  const selection=resourceCatalogue(allowed,question,selected.map(i=>i.id));
  const semanticItems=selected.map(i=>readReality(db,state,actor,i.id));
  const contexts=selected.map(i=>buildContext(db,state,actor,{question,knowledgeQuery:[question,...queries].join(' '),mode:'service',itemId:i.id,temporary,sessionId:session.id,
    taskMemoryOnly:true,includeItemRelationships:session.known.useItemMemories==='yes',companion:!!session.known.companionItemId,useExperiences:session.known.memoryPolicy!=='off'}));
  // An unbound conversation can still use relevant, explicitly cloud-authorized
  // global preferences. Do not load unrelated item stories to fill an empty set.
  if(!home&&!selected.length)contexts.push(buildContext(db,state,actor,{question,mode:'service',temporary,sessionId:session.id,taskMemoryOnly:true,useExperiences:false}));
  const memoryOn=session.known.memoryPolicy!=='off'&&!temporary;
  const documents=selected.flatMap(i=>{
    return scopedProductKnowledge(i,readKnowledge(db,state,actor,i.id)).map(d=>({...d,itemId:i.id}));
  });
  const evidence:EvidencePassage[]=selected.flatMap(i=>{
    const docs=documents.filter(d=>d.itemId===i.id).map(d=>d.document);
    const seed=retrieveKnowledge(db,state,actor,i.id,question);
    const candidates=retrieveTaskPassages(docs,[question,...queries],seed,evidenceByteBudget?Number.MAX_SAFE_INTEGER:Math.floor(36000/Math.max(1,selected.length)));
    // Select relevant windows within a per-item byte budget; numerical checks
    // use the full authorized corpus separately below. Query expansion keeps
    // late compatibility/specification sections eligible instead of by position.
    const allocation=evidenceByteBudget ? Math.floor(evidenceByteBudget/Math.max(1,selected.length)) : Infinity;
    let bytes=0;
    return candidates.filter(c=>{if(bytes+Buffer.byteLength(c.text)>allocation)return false;bytes+=Buffer.byteLength(c.text);return true;})
      .map(c=>({id:c.id,itemId:i.id,model:c.model,region:docs.find(d=>d.id===c.documentId)?.region||c.region,title:c.title,text:c.text,url:c.url,documentId:c.documentId,fetchedAt:docs.find(d=>d.id===c.documentId)?.fetchedAt,scopeBasis:documents.find(d=>d.document.id===c.documentId)?.scopeBasis,reading:{mode:docs.find(d=>d.id===c.documentId)?.reading?.mode||'unknown',limitations:docs.find(d=>d.id===c.documentId)?.reading?.limitations||[],figures:[]},basis:'official' as const}));
  });
  // The current user statement is authorized for THIS reply, not automatically
  // confirmed long-term memory, manufacturer evidence or a device observation.
  evidence.push({id:'user:current-turn',itemId:focus||'',model:'',region:'',title:'本轮用户陈述（未独立验证）',text:question,basis:'user_report'});
  // Household preferences can belong to a different home item without loading
  // that item's relationship story. Global real-world preferences stay outside.
  const selectedIds=new Set(selected.map(i=>i.id));
  const homeMemories=home&&memoryOn&&session.known.useItemMemories==='yes'?listMemories(db,state,actor).filter(m=>{
    if(m.status!=='active'||m.archived||!m.allowCloud||m.demo||m.kind==='fiction'||!m.itemId||!homeIds.has(m.itemId)||!authorize(db,state,actor,m.itemId).allowed)return false;
    if(!selectedIds.has(m.itemId)&&!['preference','interest','requirement'].includes(m.kind))return false;
    const persona=effectivePersona(db,actor,m.itemId);
    return persona.memoryUse!=='off'&&(persona.memoryUse!=='explicit'||isMemoryRecallRequest(question))&&storyMemoryRelevant(db,actor,m,question);
  }):[];
  const experiences=memoryOn?contexts.flatMap(c=>c.cloudExperiences).filter((e,n,a)=>(!home||e.itemInstanceIds.every((id:string)=>homeIds.has(id)))&&a.findIndex(r=>r.outcomeId===e.outcomeId)===n):[];
  const memories=memoryOn?(home?homeMemories:contexts.flatMap(c=>c.cloudMemories)).filter((e,n,a)=>a.findIndex(r=>r.id===e.id)===n):[];
  const stories=memoryOn?contexts.flatMap(c=>c.cloudFragments).filter((e,n,a)=>a.findIndex(r=>r.id===e.id)===n):[];
  for(const r of experiences)evidence.push({id:r.outcomeId,itemId:r.itemInstanceIds[0],model:'',region:'',title:'获准的用户尝试报告',text:r.notes,basis:'experience'});
  for(const r of memories)evidence.push({id:r.id,itemId:r.itemId||'',model:'',region:'',title:'获准个人记忆',text:r.text,basis:'user_report'});
  for(const r of stories)evidence.push({id:r.id,itemId:focus||'',model:'',region:'',title:'获准物品故事',text:r.text,basis:'user_report'});
  const allowedPersonalIds=new Set(memories.map(m=>m.id));
  const readIds=(value?:string):string[]=>{try{const parsed:unknown=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed.filter((s):s is string=>typeof s==='string'):[];}catch{return [];}};
  const requestedPlans=temporary?[]:readIds(session.known.lifeIdeaIds),feedbackIds=new Set(readIds(session.known.lifeFeedbackIds));
  const selectedPlans=requestedPlans.length?listLifeIdeas(db,state,actor).filter(p=>requestedPlans.includes(p.id)&&(p.memoryEpoch===undefined||p.memoryEpoch===epoch(db,actor))&&p.itemIds.every(id=>allowed.some(i=>i.id===id))&&(p.reasoning?.preferenceIds||[]).every((id:string)=>allowedPersonalIds.has(id))).map(p=>({
    id:p.id,title:p.title,itemIds:p.itemIds,goal:p.goal,steps:p.steps,conditions:p.assessment?.checks||p.reasoning?.checks||[],exploration:p.exploration,assessmentLevel:p.assessment?.level,mechanismHypothesis:p.assessment?.hypothesis,expectedEffect:p.expectedEffect,outcome:p.outcome,
    ...(feedbackIds.has(p.id)?{note:p.note}:{}),verification:'model-hypothesis-not-physical-verification' as const,
  })):[];
  const continuation=(()=>{if(temporary||!session.known.lifePlanContext)return;try{return discoveryInput.shape.continuation.safeParse(JSON.parse(session.known.lifePlanContext));}catch{return;}})();
  const priorPlanningContext=continuation?.success&&continuation.data?{...continuation.data,
    itemIds:continuation.data.itemIds.filter(id=>allowed.some(i=>i.id===id)),excludedItemIds:continuation.data.excludedItemIds.filter(id=>allowed.some(i=>i.id===id)),
    basis:'user_provided_previous_plan_constraints_not_verified' as const,priority:'current_question_overrides_previous_goal' as const,
  }:undefined;
  return {
    question,items:selected.map(itemContext),
    // No owners, locations, notes, photos or private stories in the catalogue.
    catalogue:selection.items,
    discovery:{total:selection.total,matched:selection.matched,truncated:selection.truncated,unmatched:selection.unmatched},
    // Server-only access set: never serialize it into a model packet. Selection
    // is relevance, not permission; an authorized ID outside top results is valid.
    authorizedItemIds:allowed.map(i=>i.id),
    semanticItems,
    revision:fingerprint({actor,items:semanticItems.map(i=>[i.itemId,i.revision]),sources:documents.map(d=>[d.document.id,d.document.hash]),permissions:allowed.map(i=>[i.id,i.owner,i.sharedWith]),personal:evidence.filter(e=>e.basis!=='official'&&e.id!=='user:current-turn').map(e=>[e.id,e.text]),memoryEpoch:epoch(db,actor)}),
    evidence,experiences,
    // Deterministic constraints inspect the scoped official corpus, independent
    // of which query snippets fit in the language model's token window.
    constraintEvidence:documents.flatMap(d=>d.document.chunks.map(c=>({id:c.id,itemId:d.itemId,text:c.text,url:c.url,model:c.model,region:d.document.region,title:c.title,basis:'official' as const}))),
    // Only explicitly recorded dimensions take part in arithmetic. These are still
    // user reports, not manufacturer facts or observed stability measurements.
    necessaryConditionChecks:selected.flatMap(object=>selected.filter(space=>space.id!==object.id).flatMap(space=>{
      const outer=object.attributes?.physicalFacts?.find(f=>f.key==='outer_mm'&&Array.isArray(f.value));
      const inner=space.attributes?.physicalFacts?.find(f=>f.key==='inner_mm'&&Array.isArray(f.value));
      if(!outer||!inner)return [];
      const a=outer.value as [number,number,number],b=inner.value as [number,number,number];
      return [{itemIds:[object.id,space.id],operandIds:[outer.id,inner.id],basis:'registered_user_report_parameters_not_device_readback',result:rectangleCondition([a[0],a[1]],[b[0],b[1]],'internal'),heightNotChecked:true}];
    })),
    preferences:memoryOn?(home?homeMemories.filter(m=>['preference','interest','requirement'].includes(m.kind)).map(m=>({key:m.kind,value:m.text})):contexts.flatMap(c=>c.cloudPreferences)).filter((p,n,a)=>a.findIndex(r=>r.key===p.key&&r.value===p.value)===n):[],
    selectedPlans,
    priorPlanningContext,
    tried:session.tried,
    history:session.messages.slice(-6).map(m=>({role:m.role,text:m.text.slice(0,1800)})),
    currentTask:task?{goal:taskContext!.modelGoal,itemIds:task.itemInstanceIds,plans:taskContext!.plans,collaborationProgress:taskContext!.familyProgress}:!temporary&&home&&session.known.homeTaskGoal?{goal:session.known.homeTaskGoal,basis:'previous_conversation_goal_not_verified_result' as const}:undefined,
    permissions:{readOnly:true,hardwareExecuted:false,memoryPolicy:session.known.memoryPolicy||'legacy'},
    retrieval:{documents:documents.map(d=>({itemId:d.itemId,id:d.document.id,hash:d.document.hash,url:d.document.url,model:d.document.model,region:d.document.region})),missingItemIds:selected.filter(i=>!documents.some(d=>d.itemId===i.id)).map(i=>i.id)},
    // Explicitly a synthetic household, never a real ownership assertion.
    household:home?'virtual_young_apartment':'user_registered_items_not_physically_verified',
  };
}
export type TaskContext=ReturnType<typeof compileTaskContext>;
