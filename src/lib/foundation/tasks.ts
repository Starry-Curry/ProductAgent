import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Person, State } from "../domain.ts";
import { AgentError } from "../agent/contracts.ts";
import { epoch, clearOwnerContext } from "../memory/store.ts";
import { authorize, policyRevision } from "./policy.ts";
import { itemInstance, productModel, fingerprint } from "./legacy.ts";
import { migrateUnified } from "./schema.ts";
import { privacyStamp, privacyCurrent } from "../memory/context-lifecycle.ts";
const now = () => new Date().toISOString();
export const taskIntent = z.enum([
  "answer",
  "guide",
  "plan",
  "explore",
  "customize",
  "record",
  "collaborate",
  "gift",
  "control",
]);
export type TaskSpec = {
  version: "task-spec/1";
  taskId: string;
  revision: number;
  createdBy: Person;
  goal: string;
  intent: z.infer<typeof taskIntent>;
  itemInstanceIds: string[];
  participantIds: Person[];
  participantSummaries?: Record<string, string>;
  contextEpoch?: number;
  privacyStamp?: Record<string, number>;
  experienceRefs?: {id:string;revision:number}[];
  currentStage:
    | "draft"
    | "active"
    | "waiting_user"
    | "waiting_other"
    | "partial"
    | "completed"
    | "blocked"
    | "cancelled";
  contextRefs: {
    kind: "item";
    id: string;
    revision: string;
    whyNeeded: string;
  }[];
  createdAt: string;
  updatedAt: string;
};
export type TaskRun = {
  version: "task-run/1";
  runId: string;
  taskId?: string;
  taskRevision?: number;
  actorId: Person;
  entryPoint: string;
  executor: string;
  status:
    "running" | "waiting_user" | "partial" | "blocked" | "failed" | "unknown";
  requestId: string;
  inputHash: string;
  observedPolicyRevision: string;
  memoryEpoch: number;
  itemRevisions: Record<string, string>;
  experienceRefs?: {id:string;revision:number}[];
  startedAt: string;
  finishedAt?: string;
  sessionId?: string;
  resultBasis:
    | "advice_only"
    | "not_verified"
    | "saved_personal_experience"
    | "user_report";
};
const createSchema = z
  .object({
    requestId: z.string().uuid(),
    goal: z.string().trim().min(1).max(2000),
    intent: taskIntent,
    itemInstanceIds: z.array(z.string().min(1).max(100)).max(30).default([]),
  })
  .strict();
function put(db: DatabaseSync, t: TaskSpec) {
  db.prepare(
    "INSERT INTO foundation_tasks VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body",
  ).run(t.taskId, t.createdBy, t.revision, JSON.stringify(t));
}
function assertItems(db: DatabaseSync, s: State, a: Person, ids: string[]) {
  if (ids.some((id) => !authorize(db, s, a, id).allowed))
    throw new AgentError("任务涉及的物品授权已失效", 403);
}
export function getTask(
  db: DatabaseSync,
  s: State,
  a: Person,
  id: string,
): TaskSpec {
  const row = db
    .prepare("SELECT body FROM foundation_tasks WHERE id=?")
    .get(id) as { body: string } | undefined;
  if (!row) throw new AgentError("任务不存在或未获授权", 403);
  const t = JSON.parse(row.body) as TaskSpec;
  if (t.createdBy !== a && !t.participantIds.includes(a))
    throw new AgentError("任务不存在或未获授权", 403);
  if (t.createdBy === a) {
    assertItems(db, s, a, t.itemInstanceIds);
    return t;
  }
  const allowed = t.itemInstanceIds.filter(
    (id) => authorize(db, s, a, id).allowed,
  );
  if (t.itemInstanceIds.length && !allowed.length)
    throw new AgentError("任务涉及的物品授权已失效", 403);
  return {
    ...t,
    goal: t.participantSummaries?.[a] || "经授权的共同物品事项",
    itemInstanceIds: allowed,
    contextRefs: t.contextRefs.filter((r) => allowed.includes(r.id)),
    participantIds: [a],
    participantSummaries: undefined,
    experienceRefs:undefined,
    privacyStamp: t.privacyStamp ? Object.fromEntries(Object.entries(t.privacyStamp).filter(([key])=>key==="*"||allowed.some(id=>key==="item:"+id))) : undefined,
  };
}
export function listTasks(db: DatabaseSync, s: State, a: Person) {
  return (
    db.prepare("SELECT id FROM foundation_tasks ORDER BY rowid DESC").all() as {
      id: string;
    }[]
  )
    .flatMap((r) => {
      try {
        return [getTask(db, s, a, r.id)];
      } catch {
        return [];
      }
    })
    .slice(0, 50);
}
/** Called inside a domain transaction, stores no unapproved personal text. */
export function linkTask(
  db: DatabaseSync,
  s: State,
  a: Person,
  input: {
    kind: string;
    refId: string;
    goal: string;
    intent: TaskSpec["intent"];
    itemIds: string[];
    participants?: Person[];
    taskId?: string;
  },
) {
  const existing = db
    .prepare("SELECT task_id FROM foundation_links WHERE kind=? AND ref_id=?")
    .get(input.kind, input.refId) as { task_id: string } | undefined;
  if (existing) return getTask(db, s, a, existing.task_id);
  assertItems(db, s, a, input.itemIds);
  let t: TaskSpec;
  if (input.taskId) {
    t = getTask(db, s, a, input.taskId);
    if (t.createdBy !== a) throw new AgentError("仅发起者可交接任务", 403);
    t = {
      ...t,
      privacyStamp: t.privacyStamp ? {...privacyStamp(db,a,input.itemIds),...t.privacyStamp} : t.contextEpoch===epoch(db,a) ? privacyStamp(db,a,[...t.itemInstanceIds,...input.itemIds]) : undefined,
      itemInstanceIds: [...new Set([...t.itemInstanceIds, ...input.itemIds])],
      contextRefs: [
        ...t.contextRefs,
        ...input.itemIds
          .filter((id) => !t.itemInstanceIds.includes(id))
          .map((id) => ({
            kind: "item" as const,
            id,
            revision: itemInstance(s.items.find((i) => i.id === id)!).revision,
            whyNeeded: "用户明确关联的后续业务对象",
          })),
      ],
      participantSummaries: {
        ...t.participantSummaries,
        ...Object.fromEntries(
          (input.participants || []).map((id) => [id, input.goal]),
        ),
      },
      participantIds: [
        ...new Set([...t.participantIds, ...(input.participants || [])]),
      ],
      revision: t.revision + 1,
      updatedAt: now(),
    };
  } else
    t = {
      version: "task-spec/1",
      contextEpoch:epoch(db,a),
      privacyStamp:privacyStamp(db,a,input.itemIds),
      experienceRefs:recallOutcomes(db,s,a,input.itemIds).map(o=>({id:o.outcomeId,revision:o.revision||1})),
      taskId: crypto.randomUUID(),
      revision: 1,
      createdBy: a,
      goal: input.goal,
      intent: input.intent,
      itemInstanceIds: [...new Set(input.itemIds)],
      participantIds: input.participants || [],
      participantSummaries: Object.fromEntries(
        (input.participants || []).map((id) => [id, input.goal]),
      ),
      currentStage: "draft",
      contextRefs: input.itemIds.map((id) => ({
        kind: "item",
        id,
        revision: itemInstance(s.items.find((i) => i.id === id)!).revision,
        whyNeeded: "用户选择或确认的业务对象",
      })),
      createdAt: now(),
      updatedAt: now(),
    };
  put(db, t);
  db.prepare("INSERT INTO foundation_links VALUES(?,?,?)").run(
    input.kind,
    input.refId,
    t.taskId,
  );
  return t;
}
export function createTask(
  db: DatabaseSync,
  read: () => State,
  a: Person,
  raw: unknown,
) {
  migrateUnified(db);
  const v = createSchema.parse(raw);
  db.exec("BEGIN IMMEDIATE");
  try {
    const t = linkTask(db, read(), a, {
      kind: "request:" + a,
      refId: v.requestId,
      goal: v.goal,
      intent: v.intent,
      itemIds: v.itemInstanceIds,
    });
    if (
      t.goal !== v.goal ||
      t.intent !== v.intent ||
      fingerprint(t.itemInstanceIds) !==
        fingerprint([...new Set(v.itemInstanceIds)])
    )
      throw new AgentError("幂等请求内容不同", 409);
    db.exec("COMMIT");
    return t;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function resolveTaskContext(
  db: DatabaseSync,
  s: State,
  a: Person,
  id: string,
) {
  const task = getTask(db, s, a, id);
  const previous=recallOutcomes(db,s,a,task.itemInstanceIds);
  return {
    version: "task-context/1",
    task,
    modelGoal:(task.privacyStamp ? privacyCurrent(db,task.createdBy,task.privacyStamp) : task.contextEpoch===epoch(db,task.createdBy))&&dependenciesCurrent(db,s,a,{outcomeId:task.taskId,experienceRefs:task.experienceRefs||[]})?task.goal:"旧任务涉及的个人语境已经变更；仅按本轮请求重新核对，不从旧目标补回关系事实",
    policyRevision: policyRevision(db, s),
    previousOutcomes: previous,
    familyProgress: s.tasks.filter(f=>
      (f.createdBy===a||f.assignee===a)&&authorize(db,s,a,f.itemId).allowed&&
      (db.prepare("SELECT task_id FROM foundation_links WHERE kind='family' AND ref_id=?").get(f.id) as {task_id:string}|undefined)?.task_id===id
    ).map(f=>({familyTaskId:f.id,status:f.status,seenAt:f.seenAt,acceptedAt:f.acceptedAt,reportedAt:f.reportedAt,basis:f.completionBasis||"not_verified"})),
    items: task.itemInstanceIds.map((id) => {
      const i = s.items.find((i) => i.id === id)!;
      return { instance: itemInstance(i), product: productModel(i) };
    }),
    notice: "私人记忆按当前执行器的既有许可另外检索，任务引用不自动授予访问权",
  };
}
export function recallOutcomes(db:DatabaseSync,s:State,a:Person,itemIds:string[]) {
  if(!itemIds.length||!db.prepare("SELECT 1 FROM sqlite_master WHERE name='foundation_outcomes'").get())return [];
  assertItems(db,s,a,itemIds);
  const seen=new Set<string>();
  const previous = (
    db
      .prepare(
        "SELECT body FROM foundation_outcomes WHERE actor=? AND EXISTS (SELECT 1 FROM json_each(foundation_outcomes.body,'$.itemInstanceIds') h JOIN json_each(?) q ON h.value=q.value) ORDER BY rowid DESC",
      )
      .all(a,JSON.stringify(itemIds)) as { body: string }[]
  )
    .map((r) => JSON.parse(r.body))
    .filter(o=>{if(seen.has(o.taskId))return false;seen.add(o.taskId);return true;})
    .filter(
      (o) =>
        o.canReuseForFutureTasks && o.status !== "forgotten" &&
        (o.privacyStamp ? privacyCurrent(db,a,o.privacyStamp) : o.memoryEpoch===epoch(db,a)) &&
        o.itemInstanceIds.every((i:string)=>authorize(db,s,a,i).allowed) && dependenciesCurrent(db,s,a,o) &&
        o.itemInstanceIds.some((i: string) => itemIds.includes(i)),
    )
    .slice(0, 5);
  return previous;
}
export function beginRun(
  db: DatabaseSync,
  read: () => State,
  a: Person,
  v: {
    requestId: string;
    taskId?: string;
    itemIds: string[];
    entryPoint: string;
    executor: string;
    input: unknown;
  },
) {
  migrateUnified(db);
  const s = read();
  const task = v.taskId ? getTask(db, s, a, v.taskId) : undefined;
  const ids = [...new Set([...v.itemIds, ...(task?.itemInstanceIds || [])])];
  assertItems(db, s, a, ids);
  const hash = fingerprint(v.input),
    row = db
      .prepare(
        "SELECT body FROM foundation_runs WHERE actor=? AND request_id=?",
      )
      .get(a, v.requestId) as { body: string } | undefined;
  if (row) {
    const prior = JSON.parse(row.body) as TaskRun;
    if (prior.inputHash !== hash) throw new AgentError("重复请求内容不同", 409);
    if (prior.status === "running" || prior.status === "unknown")
      throw new AgentError(
        "上次运行尚未确认结束；请查询原任务，不自动重做动作",
        409,
      );
    return prior;
  }
  const run: TaskRun = {
    version: "task-run/1",
    runId: crypto.randomUUID(),
    taskId: v.taskId,
    taskRevision: task?.revision,
    actorId: a,
    requestId: v.requestId,
    inputHash: hash,
    entryPoint: v.entryPoint,
    executor: v.executor,
    status: "running",
    observedPolicyRevision: policyRevision(db, s),
    memoryEpoch: epoch(db, a),
    itemRevisions: Object.fromEntries(
      ids.map((id) => [
        id,
        itemInstance(s.items.find((i) => i.id === id)!).revision,
      ]),
    ),
    experienceRefs:recallOutcomes(db,s,a,ids).map(o=>({id:o.outcomeId,revision:o.revision||1})),
    startedAt: now(),
    resultBasis: "not_verified",
  };
  db.prepare("INSERT INTO foundation_runs VALUES(?,?,?,?,?)").run(
    run.runId,
    run.taskId || null,
    a,
    v.requestId,
    JSON.stringify(run),
  );
  return run;
}
export function assertRunCurrent(db: DatabaseSync, s: State, run: TaskRun) {
  assertItems(db, s, run.actorId, Object.keys(run.itemRevisions));
  if (run.taskId) {
    const t = getTask(db, s, run.actorId, run.taskId);
    if (
      run.status === "running" &&
      run.taskRevision !== undefined &&
      t.revision !== run.taskRevision
    )
      throw new AgentError("任务已在其他入口更新，请重新核对", 409);
  }
  if (
    epoch(db, run.actorId) !== run.memoryEpoch ||
    Object.entries(run.itemRevisions).some(
      ([id, r]) =>
        itemInstance(s.items.find((i) => i.id === id)!).revision !== r,
    )
  )
    throw new AgentError("物品、记忆或权限已经变化，请重新确认任务", 409);
}
export function finishRun(
  db: DatabaseSync,
  read: () => State,
  run: TaskRun,
  status: TaskRun["status"],
  sessionId?: string,
) {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (status !== "blocked" && status !== "failed")
      assertRunCurrent(db, read(), run);
    const r = {
      ...run,
      status,
      sessionId,
      finishedAt: now(),
      resultBasis:
        status === "waiting_user"
          ? ("advice_only" as const)
          : ("not_verified" as const),
    };
    db.prepare("UPDATE foundation_runs SET body=? WHERE id=?").run(
      JSON.stringify(r),
      r.runId,
    );
    if (r.taskId) {
      const row = db
        .prepare("SELECT body FROM foundation_tasks WHERE id=?")
        .get(r.taskId) as { body: string };
      const t = JSON.parse(row.body) as TaskSpec;
      if (t.createdBy === run.actorId)
        put(db, {
          ...t,
          revision: t.revision + 1,
          currentStage:
            status === "failed" || status === "blocked"
              ? "blocked"
              : "waiting_user",
          updatedAt: now(),
        });
    }
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function taskRuns(db: DatabaseSync, s: State, a: Person, id: string) {
  getTask(db, s, a, id);
  return (
    db
      .prepare(
        "SELECT body FROM foundation_runs WHERE task_id=? AND actor=? ORDER BY rowid DESC",
      )
      .all(id, a) as { body: string }[]
  ).map((r) => JSON.parse(r.body) as TaskRun);
}
export function recoverRun(db: DatabaseSync, s: State, a: Person, id: string) {
  const r = db
    .prepare("SELECT body FROM foundation_runs WHERE id=? AND actor=?")
    .get(id, a) as { body: string } | undefined;
  if (!r) throw new AgentError("运行不存在", 403);
  const run = JSON.parse(r.body) as TaskRun;
  assertRunCurrent(db, s, run);
  if (run.status === "running") {
    run.status = "unknown";
    db.prepare("UPDATE foundation_runs SET body=? WHERE id=?").run(
      JSON.stringify(run),
      id,
    );
  }
  return run;
}
const outcomeSchema = z
  .object({
    taskId: z.string().uuid(),
    runId: z.string().uuid(),
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    goalStatus: z.enum(["achieved", "partial", "not_achieved", "unknown"]),
    notes: z.string().max(1200),
    confirmed: z.literal(true),
    reuse: z.boolean().default(false),
    allowCloud: z.boolean().default(false),
  })
  .strict();
export function recordOutcome(
  db: DatabaseSync,
  read: () => State,
  a: Person,
  raw: unknown,
) {
  const v = outcomeSchema.parse(raw);
  db.exec("BEGIN IMMEDIATE");
  try {
    const t = getTask(db, read(), a, v.taskId),
      payload = JSON.stringify(v);
    const prior = db
      .prepare(
        "SELECT payload,body FROM foundation_outcomes WHERE actor=? AND request_id=?",
      )
      .get(a, v.requestId) as { payload: string; body: string } | undefined;
    if (prior) {
      if (prior.payload !== payload && prior.payload !== "sha256:"+fingerprint(v))
        throw new AgentError("反馈请求内容不同", 409);
      db.exec("COMMIT");
      return JSON.parse(prior.body);
    }
    if (t.revision !== v.expectedRevision)
      throw new AgentError("任务已更新，请刷新后再记录结果", 409);
    const run = taskRuns(db, read(), a, t.taskId).find(
      (r) => r.runId === v.runId,
    );
    if (!run || run.status === "running")
      throw new AgentError("请先完成或核对该次运行", 409);
    const result = {
      version: "outcome/1",
      outcomeId: crypto.randomUUID(),
      taskId: t.taskId,
      runId: run.runId,
      goalStatus: v.goalStatus,
      basis: "user_report",
      reporterId: a,
      notes: v.notes,
      itemInstanceIds: t.itemInstanceIds,
      occurredAt: now(),
      canReuseForFutureTasks: v.reuse,
      allowCloud:v.reuse&&v.allowCloud,
      memoryEpoch:epoch(db,a),
      revision:1,
      status:"active",
      privacyStamp:privacyStamp(db,a,t.itemInstanceIds),
      experienceRefs:run.experienceRefs||[],
    };
    db.prepare("INSERT INTO foundation_outcomes VALUES(?,?,?,?,?,?)").run(
      result.outcomeId,
      t.taskId,
      a,
      v.requestId,
      payload,
      JSON.stringify(result),
    );
    if (t.createdBy === a)
      put(db, {
        ...t,
        revision: t.revision + 1,
        currentStage:
          v.goalStatus === "achieved"
            ? "completed"
            : v.goalStatus === "partial"
              ? "partial"
              : "waiting_user",
        updatedAt: now(),
      });
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function dependenciesCurrent(db:DatabaseSync, s:State, a:Person, outcome:any, seen=new Set<string>()):boolean {
  if(seen.size>20||seen.has(outcome.outcomeId))return false;
  const next=new Set(seen).add(outcome.outcomeId);
  return (outcome.experienceRefs||[]).every((ref:{id:string;revision:number})=>{
    const row=db.prepare("SELECT body FROM foundation_outcomes WHERE id=? AND actor=?").get(ref.id,a) as {body:string}|undefined;
    if(!row)return false;
    const current=JSON.parse(row.body);
    return current.status!=="forgotten"&&current.canReuseForFutureTasks&&(current.revision||1)===ref.revision&&
      current.itemInstanceIds.every((id:string)=>authorize(db,s,a,id).allowed)&&
      (current.privacyStamp ? privacyCurrent(db,a,current.privacyStamp) : current.memoryEpoch===epoch(db,a))&&dependenciesCurrent(db,s,a,current,next);
  });
}
export function taskOutcomes(
  db: DatabaseSync,
  s: State,
  a: Person,
  id: string,
) {
  getTask(db, s, a, id);
  return (
    db
      .prepare(
        "SELECT body FROM foundation_outcomes WHERE task_id=? AND actor=? ORDER BY rowid DESC",
      )
      .all(id, a) as { body: string }[]
  ).map((r) => JSON.parse(r.body));
}

const amendSchema = z.object({
  outcomeId:z.string().uuid(), requestId:z.string().uuid(), expectedRevision:z.number().int().positive(),
  operation:z.enum(["correct","forget","revoke_reuse"]), confirmed:z.literal(true),
  notes:z.string().trim().min(1).max(1200).optional(), reuse:z.boolean().default(false), allowCloud:z.boolean().default(false),
}).strict();
/** The author can erase their own record even after losing access to its item. No permission is restored. */
export function amendOutcome(db:DatabaseSync, read:()=>State, a:Person, raw:unknown) {
  const v=amendSchema.parse(raw), hash=fingerprint(v);
  db.exec("BEGIN IMMEDIATE");
  try {
    const row=db.prepare("SELECT body,payload FROM foundation_outcomes WHERE id=? AND actor=?").get(v.outcomeId,a) as {body:string;payload:string}|undefined;
    if(!row)throw new AgentError("经验不存在或未获授权",403);
    const o=JSON.parse(row.body);
    const receipt=db.prepare("SELECT hash,target_id FROM action_receipts WHERE owner=? AND request_id=?").get(a,v.requestId) as {hash:string;target_id:string}|undefined;
    if(receipt){if(receipt.hash!==hash||receipt.target_id!==v.outcomeId)throw new AgentError("重复操作内容不同",409);db.exec("COMMIT");return o;}
    if(o.basis!=="user_report"||o.status==="forgotten")throw new AgentError("该记录不能修改",409);
    if((o.revision||1)!==v.expectedRevision)throw new AgentError("经验已经更新，请重新查看",409);
    if(v.operation!=="forget") getTask(db,read(),a,o.taskId);
    if(v.operation==="correct"&&!v.notes)throw new AgentError("请填写纠正后的实际经历");
    // Erase transient prompts/results without invalidating other lasting experiences.
    clearOwnerContext(db,a,true,[],o.itemInstanceIds);
    const next={...o, revision:(o.revision||1)+1, updatedAt:now(),
      notes:v.operation==="forget"?"":v.operation==="correct"?v.notes:o.notes,
      status:v.operation==="forget"?"forgotten":"active",
      canReuseForFutureTasks:v.operation==="correct"&&v.reuse,
      allowCloud:v.operation==="correct"&&v.reuse&&v.allowCloud,
      privacyStamp:privacyStamp(db,a,o.itemInstanceIds), memoryEpoch:epoch(db,a)};
    const payload=v.operation==="forget"?(row.payload.startsWith("sha256:")?row.payload:"sha256:"+fingerprint(JSON.parse(row.payload))):row.payload;
    db.prepare("UPDATE foundation_outcomes SET body=?,payload=? WHERE id=? AND actor=?").run(JSON.stringify(next),payload,v.outcomeId,a);
    db.prepare("INSERT INTO action_receipts VALUES(?,?,?,?)").run(a,v.requestId,hash,v.outcomeId);
    db.exec("COMMIT");return next;
  } catch(e){db.exec("ROLLBACK");throw e;}
}
