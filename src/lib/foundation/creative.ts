import type { DatabaseSync } from "node:sqlite";
import type { State,Person } from "../domain.ts";
import type { Provider } from "../ai/provider.ts";
import { planDiscovery } from "../life/planning.ts";
import { beginRun,finishRun,getTask } from "./tasks.ts";
import { recordSpecialist } from "./specialists.ts";

/** The existing engine stays intact; bind its actual result to the user's current task. */
export async function discoverInTask(db:DatabaseSync,read:()=>State,actor:Person,input:unknown,provider:Provider,taskId?:string,requestId=crypto.randomUUID()):Promise<Awaited<ReturnType<typeof planDiscovery>> & {foundation?:{taskId:string;runId:string;basis:string}}> {
  if(!taskId)return planDiscovery(db,read(),actor,input,provider,read);
  const task=getTask(db,read(),actor,taskId);
  const run=beginRun(db,read,actor,{requestId,taskId,itemIds:task.itemInstanceIds,entryPoint:"discover",executor:"existing-open-creativity/1",input});
  try {
    const result=await planDiscovery(db,read(),actor,input,provider,read);
    finishRun(db,read,run,result.failure?"partial":"waiting_user");
    db.exec("BEGIN IMMEDIATE");
    try {
      for(const idea of result.ideas)recordSpecialist(db,read(),actor,{kind:"idea",refId:idea.id,revision:1,itemIds:idea.itemIds,goal:"探索物品新用途",intent:"explore",basis:"not_verified",taskId});
      db.exec("COMMIT");
    }catch(e){db.exec("ROLLBACK");throw e;}
    return {...result,foundation:{taskId,runId:run.runId,basis:"advice_only"}};
  }catch(e){finishRun(db,read,run,"blocked");throw e;}
}
