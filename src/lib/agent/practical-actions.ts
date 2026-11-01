import {z} from 'zod';
import type {NecessaryCheck} from './practical-constraints.ts';
import {actionSchema} from '../life/action-contract.ts';
import {violatesGoal} from '../life/planning-constraints.ts';
import type {Item} from '../domain.ts';
import {evidenceInventory} from '../life/affordances.ts';
import {assessMechanism} from '../life/creative-engine-v2.ts';
const item=z.string().min(1).max(100);
export const dependentStep=actionSchema.extend({text:z.string().min(1).max(240),conditions:z.array(z.string().max(180)).max(5).default([])});
export const actionProposal=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('plan'),goal:z.string().trim().min(1).max(150),itemIds:z.array(item).min(1).max(8).describe('实际使用资源，非比较后排除的资源'),steps:z.array(z.union([dependentStep,z.string().trim().min(1).max(120).describe('兼容旧草稿，仅探索，不作逐步已核验动作')])).min(1).max(12),sourceIds:z.array(z.string().max(200)).max(8),conditions:z.array(z.string().max(240)).max(8)}).strict(),
 z.object({kind:z.literal('story'),itemId:item,text:z.string().trim().min(1).max(10000)}).strict(),
 z.object({kind:z.literal('gift'),itemId:item,message:z.string().trim().min(1).max(1000)}).strict(),
 z.object({kind:z.literal('family'),itemId:item,memberId:item,summary:z.string().trim().min(1).max(1200)}).strict(),
]);
/** Structural and numerical gates, not semantic proof or a physics simulator. */
export function checkPlanResources(raw:unknown,allowed:string[],checks:NecessaryCheck[],sources:{id:string;itemId:string}[],items:Item[]=[]){
 const p=actionProposal.parse(raw);if(p.kind!=='plan')throw Error('plan_required');
 const itemIds=[...new Set(p.itemIds)];
 if(itemIds.some(id=>!allowed.includes(id)))throw Error('计划依赖未获授权或未登记的物品');
 const failures=checks.filter(c=>c.satisfied!==true&&c.itemIds.some(id=>itemIds.includes(id)));
 if(failures.length)throw Error('所选资源存在未满足或冲突的必要条件：'+failures.map(c=>c.detail).join('；'));
 const unresolved=[...p.conditions];
 const stepChecks=p.steps.map((step,index)=>{
  if(typeof step==='string'){if(violatesGoal(p.goal,step))throw Error('步骤违反用户明确限制');unresolved.push('第'+(index+1)+'步只有文字草稿，未关联动作依赖，仅供探索');return {index,status:'unstructured_idea',resources:[]};}
  const resources=[...step.items,...(step.target?[step.target]:[])];
  if(resources.some(id=>!itemIds.includes(id)))throw Error('步骤依赖未声明或未获授权资源，不能只检查计划itemIds');
  if(violatesGoal(p.goal,step.text))throw Error('动作文字违反用户明确限制');
  // A declared action kind is a candidate dependency, not proof that arbitrary
  // natural-language wording has that meaning. Don't certify prose with verb regexes.
  const inventory=evidenceInventory(items.filter(i=>itemIds.includes(i.id)));for(const row of inventory.items)row.ref=row.id;
  for(const row of inventory.items)for(const fact of row.facts)fact.item=row.id;
  const assessment=assessMechanism({title:p.goal,outcome:p.goal,mechanism:step.text,roles:inventory.items.map(i=>({item:i.ref,function:'实际资源',evidence:[]})),actions:[step],requirements:[],assumptions:step.conditions,extraResources:[],preferenceIds:[],minutes:10},inventory,p.goal,'goal');
  const conflicts=assessment.checks.filter(c=>c.status==='contradiction');if(conflicts.length)throw Error(conflicts.map(c=>c.detail).join('；'));
  for(const c of assessment.checks.filter(c=>c.status==='unknown'))unresolved.push('第'+(index+1)+'步：'+c.detail);
  if(assessment.level==='concept')unresolved.push('第'+(index+1)+'步的作用仅作探索，不应当作可直接执行的指令');
  return {index,status:assessment.level,resources,checks:assessment.checks};
 });
 if(p.sourceIds.some(id=>!sources.some(e=>e.id===id&&itemIds.includes(e.itemId))))throw Error('引用不属于当前使用物品的已取得资料');
 if(!p.sourceIds.length)unresolved.push('没有关联已读取的型号操作原文，不能当作有依据的型号操作指导');
 unresolved.push('动作依赖用于核对资源与已知条件，未认证每句描述的物理效果；保存不等于执行。');
 return {...p,itemIds,steps:p.steps.map(s=>typeof s==='string'?s:s.text),dependencies:stepChecks,unresolved:[...new Set(unresolved)].slice(0,10),readiness:unresolved.length?'conditional' as const:'resource_checked' as const};
}
