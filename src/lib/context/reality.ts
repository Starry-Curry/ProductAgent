import {createHash} from 'node:crypto';
import type {Item} from '../domain.ts';
import {boundPack} from '../ai/harness.ts';
import {physicalFactSchema} from '../life/physical-facts.ts';
import {usable,syntheticItem} from '../life/availability.ts';

export type RealityBasis='official_source'|'user_report'|'inferred_unverified';
export type RealityFact={
 id:string;subject:string;scope:'product'|'instance';component:string;predicate:string;value:unknown;
 basis:RealityBasis;status:'asserted'|'conflicting';source:{ref:string;url?:string;model?:string;version?:string};
 verification:'source_assertion_not_instance_verification'|'user_report_not_measured'|'unverified';
};
export type RealityCapability={
 id:string;effect:string;canonicalKey?:string;basis:RealityBasis;evidenceIds:string[];requires:string[];
 status:'conditional'|'unavailable'|'hypothesis'|'conflicting';executable:false;verifiedForThisInstance:false;
};
const known=(s?:string)=>s&&!/^(未知|待确认|未确认|不详|无型号)$/.test(s.trim())?s:null;
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
/** Vocabulary aliases only, never substring matching or property inference. */
export function canonicalCapabilityKey(effect:string){return ({'indoor-storage':'open_container',storage:'open_container',容纳:'open_container',容纳非食品轻小物:'open_container',透明可视:'transparent',提拿:'portable','audio-playback':'sound',lighting:'light',clamp:'clamp',夹持:'clamp',照明:'light',便携:'portable',发声:'sound'} as Record<string,string>)[effect]||(['open_container','portable','light','sound','flat_surface','reflective','transparent','elastic','magnetic'].includes(effect)?effect:undefined);}
/** Projection, never a second item store. It neither infers functions from names
 * nor converts source claims/user reports into real-world verification. */
export function projectReality(item:Item){
 const pack=boundPack(item),facts:RealityFact[]=[],capabilities:RealityCapability[]=[];
 const add=(predicate:string,value:unknown,basis:RealityBasis,ref:string,component='本体',url?:string)=>{
  const id=item.id+':'+ref;
  facts.push({id,subject:item.id,scope:basis==='official_source'?'product':'instance',component,predicate,value,basis,status:'asserted',source:{ref,...(url?{url,model:pack?.model,version:pack?.version}:{})},verification:basis==='official_source'?'source_assertion_not_instance_verification':basis==='user_report'?'user_report_not_measured':'unverified'});
  return id;
 };
 for(const key of ['material','dimensions','power','care'] as const){const value=known(item.attributes?.[key]);if(value)add(key,value,'user_report','attributes/'+key);}
 const declared=item.attributes?.capabilities||[];
 for(const effect of declared){const ref=add('capability',effect,'user_report','attributes/capabilities/'+digest(effect).slice(0,12));capabilities.push({id:ref,effect,basis:'user_report',evidenceIds:[ref],requires:['核对当前任务所需的连接、状态及适用条件'],status:'conditional',executable:false,verifiedForThisInstance:false});}
 const functional=new Set(['open_container','portable','clamp','light','sound','flat_surface','reflective','transparent','elastic','magnetic']);
 for(const raw of item.attributes?.physicalFacts||[]){const parsed=physicalFactSchema.safeParse(raw);if(!parsed.success)continue;const f=parsed.data;const ref=add(f.key,f.value,'user_report','physical/'+f.id,f.component);if(functional.has(f.key)&&typeof f.value==='boolean')capabilities.push({id:ref,effect:f.key,basis:'user_report',evidenceIds:[ref],requires:['本人报告未证明当前任务的承重、连接或实际状态'],status:f.value?'conditional':'unavailable',executable:false,verifiedForThisInstance:false});}
 for(const f of pack?.claims||[])add('statement',f.text,'official_source',f.id,'本体',pack!.source.url);
 if(pack?.constraints?.maxLoadKg!==undefined)add('max_load_kg',pack.constraints.maxLoadKg,'official_source',pack.id+'/maxLoadKg','本体',pack.source.url);
 if(pack?.constraints?.foodContact!==undefined)add('food_contact',pack.constraints.foodContact,'official_source',pack.id+'/foodContact','本体',pack.source.url);
 for(const p of pack?.understanding?.properties||[]){const refs=p.factIds.filter(id=>pack!.claims.some(c=>c.id===id));if(refs.length)add(p.key,p.value,'official_source','property/'+p.key,'本体',pack!.source.url);}
 for(const effect of pack?.capabilities||[]){const ref=add('capability',effect,'official_source',pack!.id+'/capability/'+effect,'本体',pack!.source.url);capabilities.push({id:ref,effect,basis:'official_source',evidenceIds:[ref],requires:[...(pack?.limits||[]),'未验证该私人实例当前连接、供电及任务条件'],status:'conditional',executable:false,verifiedForThisInstance:false});}
 for(const p of pack?.understanding?.possibilities||[])capabilities.push({id:item.id+':hypothesis:'+digest(p).slice(0,16),effect:p.function,basis:'inferred_unverified',evidenceIds:p.basisFactIds.filter(id=>pack!.claims.some(f=>f.id===id)).map(id=>item.id+':'+id),requires:p.conditions,status:'hypothesis',executable:false,verifiedForThisInstance:false});
 for(const f of facts){if(f.predicate==='statement'||f.predicate==='capability')continue;const peers=facts.filter(x=>x.scope===f.scope&&x.component===f.component&&x.predicate===f.predicate);if(new Set(peers.map(x=>JSON.stringify(x.value))).size>1)for(const p of peers)p.status='conflicting';}
 for(const c of capabilities)if(c.evidenceIds.some(id=>facts.some(f=>f.id===id&&f.status==='conflicting'))){c.status='conflicting';c.requires=['先纠正相互冲突的原始报告',...c.requires];}
 const identity={kind:known(item.model)?'commercial' as const:'unique' as const,brand:known(item.brand),model:known(item.model),region:known(item.region),firmware:null,identityBasis:'user_report' as const};
 const instance={state:item.state,availability:item.availability||'unknown',usable:usable(item),quantity:item.attributes?.quantity??null,unit:item.attributes?.quantityUnit||null,synthetic:syntheticItem(item),basis:'user_report' as const};
 const unknowns=[...(pack?.understanding?.unknowns||[]),...(!identity.model?['未登记商业型号；不妨碍保存此物品及获准故事']:[]),...(!facts.some(f=>f.predicate==='material')?['材质']:[]),...(!facts.some(f=>['dimensions','outer_mm'].includes(f.predicate))?['尺寸']:[]),...facts.filter(f=>f.status==='conflicting').map(f=>f.predicate+'存在冲突'),'未记录的承重、耐热、稳定性及型号操作不由名称推断'];
 for(const c of capabilities)c.canonicalKey=canonicalCapabilityKey(c.effect);
 const operations=(pack?.procedures||[]).map(p=>({id:p.id,title:p.title,goal:p.goal,steps:p.steps.map(s=>({id:s.id,text:s.text,section:s.sourceSection})),conditions:[...p.preconditions,...p.fieldChecks,...p.limits],source:{url:p.sourceUrl,model:p.model,region:p.region,packVersion:pack!.version},basis:'official_source' as const,verifiedForThisInstance:false as const}));
 return {version:'reality/1' as const,id:item.id,itemId:item.id,name:item.name,identity,instance,facts,capabilities,operations,limits:pack?.limits||[],unknowns:[...new Set(unknowns)],revision:digest({identity,instance,facts,capabilities,operations,limits:pack?.limits,expires:item.attributes?.expiresOn})};
}
export type RealityCard=ReturnType<typeof projectReality>;

/** Compact transport view; full source assertions remain in projectReality and
 * the original item/pack. Dictionary references remove repeated source URLs and
 * boilerplate, not caveats or conflicting measurements. */
export function modelReality(card:RealityCard){
 const sources:Record<string,Omit<RealityFact['source'],'ref'>>={},keys=new Map<string,string>();
 const facts=card.facts.map(f=>{const source={url:f.source.url,model:f.source.model,version:f.source.version};const signature=JSON.stringify(source);let sourceId=keys.get(signature);if(!sourceId){sourceId='s'+(keys.size+1);keys.set(signature,sourceId);sources[sourceId]=source;}return {id:f.id,key:f.predicate,value:f.value,basis:f.basis,scope:f.scope,status:f.status,...(f.component!=='本体'?{component:f.component}:{}),sourceId,rawRef:f.source.ref};});
 return {id:card.id,name:card.name,identity:card.identity,instance:card.instance,facts,sources,capabilities:card.capabilities.map(c=>({id:c.id,effect:c.effect,status:c.status,basis:c.basis,evidenceIds:c.evidenceIds,requires:c.requires})),operations:card.operations,limits:card.limits,unknowns:card.unknowns,revision:card.revision,verification:'manufacturer statements and user reports; not device readback or permission to execute'};
}
