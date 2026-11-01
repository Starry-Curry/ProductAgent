import {z} from 'zod';
import type {NecessaryCheck} from './practical-constraints.ts';
const item=z.string().min(1).max(100);
export const actionProposal=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('plan'),goal:z.string().trim().min(1).max(150),itemIds:z.array(item).min(1).max(8).describe('实际需要使用的已有物品；排除或只作比较的物品不列入'),steps:z.array(z.string().trim().min(1).max(120)).min(1).max(12),sourceIds:z.array(z.string().max(200)).max(8).describe('支持本方案的已读取原文ID；引用不证明整份方案'),conditions:z.array(z.string().max(240)).max(8).describe('尚未确认的实施前提，不重复罗列已知事实')}).strict(),
 z.object({kind:z.literal('story'),itemId:item,text:z.string().trim().min(1).max(10000)}).strict(),
 z.object({kind:z.literal('gift'),itemId:item,message:z.string().trim().min(1).max(1000)}).strict(),
 z.object({kind:z.literal('family'),itemId:item,memberId:item,summary:z.string().trim().min(1).max(1200)}).strict(),
]);
/** Structural and numerical gates, not semantic proof or a physics simulator. */
export function checkPlanResources(raw:unknown,allowed:string[],checks:NecessaryCheck[],sources:{id:string;itemId:string}[]){
 const p=actionProposal.parse(raw);if(p.kind!=='plan')throw Error('plan_required');
 const itemIds=[...new Set(p.itemIds)];
 if(itemIds.some(id=>!allowed.includes(id)))throw Error('计划依赖未获授权或未登记的物品');
 const failures=checks.filter(c=>c.satisfied!==true&&c.itemIds.some(id=>itemIds.includes(id)));
 if(failures.length)throw Error('所选资源存在未满足或冲突的必要条件：'+failures.map(c=>c.detail).join('；'));
 const unresolved=[...p.conditions];
 if(p.sourceIds.some(id=>!sources.some(e=>e.id===id&&itemIds.includes(e.itemId))))throw Error('引用不属于当前使用物品的已取得资料');
 if(!p.sourceIds.length)unresolved.push('没有关联已读取的型号操作原文，不能当作有依据的型号操作指导');
 return {...p,itemIds,unresolved,readiness:unresolved.length?'conditional' as const:'resource_checked' as const};
}
