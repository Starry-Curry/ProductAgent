import type { DatabaseSync } from "node:sqlite";
import { canRead,type State,type Person } from "../../domain.ts";
import type { ServiceSession } from "../contracts.ts";
import { itemContext } from "../../context/items.ts";
import { buildContext } from "../../context/builder.ts";
import { readKnowledge, retrieveKnowledge } from "../../life/acquisition.ts";
import { modelMentioned,officialDomain } from "../../life/knowledge.ts";
import { getTask } from "../../foundation/tasks.ts";
import { virtualHomeItems } from "../../life/virtual-home.ts";
import { retrieveTaskPassages } from "./retrieval.ts";
import type { EvidencePassage } from "./contracts.ts";

export function kernelContext(db:DatabaseSync,state:State,actor:Person,session:ServiceSession,question:string,temporary=false,queries:string[]=[],extraIds:string[]=[]){
  const taskId=session.known.foundationTaskId;
  const task=taskId?getTask(db,state,actor,taskId):undefined;
  const focus=session.itemId||session.known.activeItemId;
  const home=session.known.homeId==='young-apartment-v1';
  const homeIds=new Set(home?virtualHomeItems(state,actor).map(i=>i.id):[]);
  const allowed=state.items.filter(i=>canRead(i,actor)&&(home?homeIds.has(i.id):!i.demo)&&(!task||task.itemInstanceIds.includes(i.id)));
  const mentioned=(s:string)=>s.length>1&&question.toLowerCase().includes(s.toLowerCase());
  const selected=allowed.filter(i=>i.id===focus||task?.itemInstanceIds.includes(i.id)||extraIds.includes(i.id)||mentioned(i.model)||mentioned(i.name)||
    // Entity matching only. It never chooses an intent or provides a product fact.
    [...new Intl.Segmenter('zh',{granularity:'word'}).segment(i.name)].some(s=>s.segment.length>=2&&mentioned(s.segment)));
  const contexts=selected.map(i=>buildContext(db,state,actor,{question,knowledgeQuery:[question,...queries].join(' '),mode:'service',itemId:i.id,temporary,sessionId:session.id,
    taskMemoryOnly:true,includeItemRelationships:session.known.useItemMemories==='yes',companion:!!session.known.companionItemId,useExperiences:session.known.memoryPolicy!=='off'}));
  const memoryOn=session.known.memoryPolicy!=='off'&&!temporary;
  const documents=selected.flatMap(i=>readKnowledge(db,state,actor,i.id)
    .filter(d=>d.model===i.model&&(!i.region||i.region==='unspecified'||d.region===i.region||d.region==='unspecified')&&officialDomain(d.url,d.brand||i.brand||'')&&modelMentioned(d.title+' '+d.text,i.model))
    .map(d=>({itemId:i.id,document:d})));
  const evidence:EvidencePassage[]=selected.flatMap(i=>{
    const docs=documents.filter(d=>d.itemId===i.id).map(d=>d.document);
    const seed=retrieveKnowledge(db,state,actor,i.id,question);
    return retrieveTaskPassages(docs,[question,...queries],seed,Math.floor(36000/Math.max(1,selected.length)))
      .map(c=>({id:c.id,itemId:i.id,model:c.model,region:c.region,title:c.title,text:c.text,url:c.url,documentId:c.documentId,fetchedAt:docs.find(d=>d.id===c.documentId)?.fetchedAt,basis:'official' as const}));
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
    preferences:memoryOn?contexts.flatMap(c=>c.cloudPreferences).filter((p,n,a)=>a.findIndex(r=>r.key===p.key&&r.value===p.value)===n):[],
    tried:session.tried,
    history:session.messages.slice(-6).map(m=>({role:m.role,text:m.text.slice(0,1800)})),
    currentTask:task?{goal:task.goal,itemIds:task.itemInstanceIds}:undefined,
    permissions:{readOnly:true,hardwareExecuted:false,memoryPolicy:session.known.memoryPolicy||'legacy'},
    retrieval:{documents:documents.map(d=>({itemId:d.itemId,id:d.document.id,hash:d.document.hash,url:d.document.url,model:d.document.model,region:d.document.region})),missingItemIds:selected.filter(i=>!documents.some(d=>d.itemId===i.id)).map(i=>i.id)},
    // Explicitly a synthetic household, never a real ownership assertion.
    household:home?'virtual_young_apartment':'user_registered_items_not_physically_verified',
  };
}
export type KernelContext=ReturnType<typeof kernelContext>;
