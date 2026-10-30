import type { DatabaseSync } from "node:sqlite";
import type { State, Person } from "../domain.ts";
import { linkTask, getTask, type TaskSpec } from "./tasks.ts";
import { epoch } from "../memory/store.ts";
import { policyRevision } from "./policy.ts";
import { fingerprint } from "./legacy.ts";
/** Internal domain receipt bridge. Call within the original write transaction. */
export function recordSpecialist(
  db: DatabaseSync,
  state: State,
  actor: Person,
  input: {
    kind: "story" | "gift" | "family" | "idea" | "plan" | "persona";
    refId: string;
    revision: number;
    itemIds: string[];
    participants?: Person[];
    intent: TaskSpec["intent"];
    goal: string;
    basis: "saved_personal_experience" | "not_verified" | "user_report";
    taskId?: string;
  },
) {
  const task = linkTask(db, state, actor, {
    kind: input.kind,
    refId: input.refId,
    goal: input.goal,
    intent: input.intent,
    itemIds: input.itemIds,
    participants: input.participants,
    taskId: input.taskId,
  });
  const key = `specialist:${input.kind}:${input.refId}:${input.revision}`,
    id = crypto.randomUUID(),
    at = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO foundation_runs VALUES(?,?,?,?,?)").run(
    id,
    task.taskId,
    actor,
    key,
    JSON.stringify({
      version: "task-run/1",
      runId: id,
      taskId: task.taskId,
      actorId: actor,
      requestId: key,
      inputHash: fingerprint(input),
      entryPoint: input.kind,
      executor: input.kind + "/legacy-adapter-1",
      status: "waiting_user",
      observedPolicyRevision: "recheck-on-read",
      memoryEpoch: 0,
      itemRevisions: {},
      startedAt: at,
      finishedAt: at,
      resultBasis: input.basis,
    }),
  );
  if (input.basis === "saved_personal_experience") {
    const saved = db
      .prepare("SELECT id FROM foundation_runs WHERE actor=? AND request_id=?")
      .get(actor, key) as { id: string };
    db.prepare(
      "INSERT OR IGNORE INTO foundation_outcomes VALUES(?,?,?,?,?,?)",
    ).run(
      crypto.randomUUID(),
      task.taskId,
      actor,
      key,
      JSON.stringify(input),
      JSON.stringify({
        version: "outcome/1",
        outcomeId: key,
        taskId: task.taskId,
        runId: saved.id,
        goalStatus: "achieved",
        basis: input.basis,
        evidenceRefs: [input.kind + ":" + input.refId + ":v" + input.revision],
        reporterId: actor,
        itemInstanceIds: input.itemIds,
        occurredAt: at,
        notes: "已保存个人记录；内容是用户叙述，未经外部核实",
        canReuseForFutureTasks: false,
      }),
    );
  }
  return task;
}
/** Same transaction as the legacy family state; never promote a relative's report to verified execution. */
export function syncFamilyProgress(db:DatabaseSync,state:State,actor:Person,familyId:string,requestId:string) {
  if(db.prepare("SELECT 1 FROM foundation_runs WHERE actor=? AND request_id=?").get(actor,"family-progress:"+requestId))return;
  const link=db.prepare("SELECT task_id FROM foundation_links WHERE kind='family' AND ref_id=?").get(familyId) as {task_id:string}|undefined;
  if(!link)return;
  const family=state.tasks.find(t=>t.id===familyId)!;
  getTask(db,state,actor,link.task_id);
  const row=db.prepare("SELECT body FROM foundation_tasks WHERE id=?").get(link.task_id) as {body:string};
  const task=JSON.parse(row.body) as TaskSpec;
  const stage=family.reportedAt?"waiting_user":family.status==="未解决"?"partial":"waiting_other";
  const updated={...task,revision:task.revision+1,currentStage:stage,updatedAt:new Date().toISOString()};
  db.prepare("UPDATE foundation_tasks SET revision=?,body=? WHERE id=?").run(updated.revision,JSON.stringify(updated),task.taskId);
  const runId=crypto.randomUUID(),at=new Date().toISOString();
  db.prepare("INSERT INTO foundation_runs VALUES(?,?,?,?,?)").run(runId,task.taskId,actor,"family-progress:"+requestId,JSON.stringify({
    version:"task-run/1",runId,taskId:task.taskId,actorId:actor,requestId:"family-progress:"+requestId,inputHash:fingerprint({familyId,status:family.status}),
    entryPoint:"family",executor:"family-state-transaction/1",status:family.reportedAt?"waiting_user":"partial",memoryEpoch:epoch(db,actor),
    observedPolicyRevision:policyRevision(db,state),itemRevisions:{},startedAt:at,finishedAt:at,resultBasis:family.reportedAt?"user_report":"not_verified",
  }));
}
export const specialistRegistry = [
  {
    id: "answer",
    module: "agent/graph",
    risk: "read_only",
    basis: "document_or_model_advice",
  },
  {
    id: "guide",
    module: "skills/document-help",
    risk: "read_only",
    basis: "source_checked_steps",
  },
  {
    id: "explore",
    module: "life/open-exploration",
    risk: "read_only",
    basis: "concept_not_verified",
  },
  {
    id: "plan",
    module: "life/task-planning",
    risk: "local_write",
    basis: "plan_not_execution",
  },
  {
    id: "persona",
    module: "memory/store",
    risk: "local_write",
    basis: "user_confirmed_settings",
  },
  {
    id: "record",
    module: "life/stories",
    risk: "local_write",
    basis: "saved_personal_experience",
  },
  {
    id: "collaborate",
    module: "collaboration",
    risk: "local_write",
    basis: "user_report",
  },
  {
    id: "gift",
    module: "life/gifts",
    risk: "local_write",
    basis: "selected_snapshot_and_received_confirmation",
  },
  {
    id: "maintain",
    module: "domain",
    risk: "local_write",
    basis: "user_report",
  },
  {
    id: "software_lab",
    module: "devices/software-lab",
    risk: "local_write",
    basis: "software_simulator_readback",
  },
] as const;
