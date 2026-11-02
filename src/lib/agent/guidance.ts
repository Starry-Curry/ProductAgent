import {z} from 'zod';
import {actionProposal,dependentStep,checkPlanResources,type ActionSource} from './practical-actions.ts';
import type {NecessaryCheck} from './practical-constraints.ts';
import type {Item} from '../domain.ts';

/** A presentation boundary, not a second model review or persisted Task. The
 * same action dependencies are checked before display and again before save. */
export const guidanceSchema=z.object({
 goal:z.string().trim().min(1).max(150),
 itemIds:z.array(z.string().min(1).max(100)).min(1).max(8),
 steps:z.array(dependentStep).min(1).max(12),
 sourceIds:z.array(z.string().max(200)).max(8),
 conditions:z.array(z.string().max(240)).max(8),
}).strict();
export function presentGuidance(raw:unknown,question:string,allowed:string[],checks:NecessaryCheck[],sources:ActionSource[],items:Item[]){
 const value=guidanceSchema.parse(raw);
 // The user's full constraint-bearing goal, not a model's convenient paraphrase.
 const plan=checkPlanResources(actionProposal.parse({...value,kind:'plan'}),allowed,checks,sources,items,question);
 const answer=[value.goal,...plan.steps.map((s,n)=>`${n+1}. ${s}`),...(plan.unresolved.length?['实施条件与边界：',...plan.unresolved.map(s=>'— '+s)]:[])].join('\n\n');
 return {answer,plan,basis:'checked_dependencies_not_verified_physical_success' as const};
}
