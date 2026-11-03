import type {DatabaseSync} from 'node:sqlite';
import {discoverCapabilities,createTask,respond,getTask,recordOutcome,type State,type Person,type Provider,type TurnRequest} from '../../src/lib/foundation/services.ts';

/** Specialist feature independent of the product-question page. Supply the
 * application's authenticated actor/current state and existing Provider. */
export async function startGoal(db:DatabaseSync,read:()=>State,actor:Person,goal:string,provider:Provider,requestId=crypto.randomUUID()){
 const candidates=discoverCapabilities(db,read(),actor,{goal});
 const task=createTask(db,read,actor,{requestId,goal,intent:'explore',itemInstanceIds:[]});
 const input:TurnRequest={requestId,taskId:task.taskId,question:goal,mode:'auto',memoryPolicy:'read',uiContext:{page:'assistant'}};
 const turn=await respond(db,read,actor,input,provider);
 return {task:getTask(db,read(),actor,task.taskId),candidates,turn};
}
export function confirmGoalOutcome(db:DatabaseSync,read:()=>State,actor:Person,result:Awaited<ReturnType<typeof startGoal>>,confirmation:{requestId:string;confirmed:true;notes:string;reuse:boolean;allowCloud:boolean;goalStatus:'achieved'|'not_achieved'|'partial'|'unknown'}){
 if(!result.turn.foundation?.runId)throw Error('completed_run_required');
 return recordOutcome(db,read,actor,{taskId:result.task.taskId,runId:result.turn.foundation.runId,expectedRevision:result.task.revision,...confirmation});
}
