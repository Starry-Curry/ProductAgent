import type {Item} from '../domain.ts';
import {fingerprint} from '../foundation/legacy.ts';
/** Planning conditions, excluding unrelated private notes, photos and persona settings. */
export function planResourceStamp(i:Item){return 'plan/1:'+fingerprint({id:i.id,model:i.model,brand:i.brand,region:i.region,state:i.state,availability:i.availability,attributes:i.attributes,productBinding:i.productBinding});}
export function changedPlanResources(plan:{itemIds:string[];resourceRevisions?:Record<string,string>;dependencies?:{step:number;resourceIds:string[]}[];checklist?:{label:string}[]},items:Item[]){
 const untracked=plan.itemIds.filter(id=>!plan.resourceRevisions?.[id]);
 const changed=plan.itemIds.filter(id=>{const i=items.find(i=>i.id===id),prior=plan.resourceRevisions?.[id];return !!prior&&(!i||prior!==(prior.startsWith('plan/1:')?planResourceStamp(i):fingerprint(i)));});
 const needsReview=[...changed,...untracked];
 const affected=needsReview.length?(plan.dependencies?.length?plan.dependencies.filter(d=>!d.resourceIds.length||d.resourceIds.some(id=>needsReview.includes(id))).map(d=>d.step):plan.checklist?.map((_,n)=>n)||[]):[];
 return {changed,untracked,affected,notice:untracked.length?'旧方案没有完整的资源条件快照；无法判定是否变化，需重新核对。':changed.length?'物品条件有变化；标出的步骤需重新核对，未标出也不代表已通过实物验证。':'登记条件没有变化；不代表实际操作已验证。'};
}
