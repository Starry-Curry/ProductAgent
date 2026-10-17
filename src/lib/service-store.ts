import type { DatabaseSync } from "node:sqlite";
import { canRead, type Person, type State } from "./domain.ts";
import { identity } from "./ai/harness.ts";
import type { Run, Feedback } from "./ai/types.ts";
export function accessibleRun(run: Run, state: State, actor: Person) {
  const item = state.items.find((i) => i.id === run.itemId);
  return (
    run.actor === actor &&
    item &&
    canRead(item, actor) &&
    item.owner === run.itemOwner &&
    identity(item) === run.identity &&
    (run.resourceScopes || []).every((scope) => {
      const resource = state.items.find((i) => i.id === scope.itemId);
      return (
        resource &&
        canRead(resource, actor) &&
        resource.owner === scope.owner &&
        identity(resource) === scope.identity &&
        resource.state === scope.state
      );
    })
  );
}
export function saveRun(db: DatabaseSync, run: Run) {
  db.prepare(
    "INSERT INTO service_runs VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
  ).run(run.id, run.actor, run.itemId, JSON.stringify(run));
}
export function listRuns(
  db: DatabaseSync,
  state: State,
  actor: Person,
  itemId: string,
) {
  recoverStaleRuns(db);
  const rows = db
    .prepare(
      `SELECT r.body, f.outcome, f.at FROM service_runs r LEFT JOIN service_feedback f ON f.run_id=r.id WHERE r.actor=? AND r.item_id=? ORDER BY r.rowid DESC LIMIT 30`,
    )
    .all(actor, itemId) as {
    body: string;
    outcome: Feedback["outcome"] | null;
    at: string | null;
  }[];
  return rows
    .map((r) => ({
      run: JSON.parse(r.body) as Run,
      feedback: r.outcome
        ? { outcome: r.outcome, at: r.at, basis: "user_report" }
        : null,
    }))
    .filter(({ run }) => accessibleRun(run, state, actor));
}
export function recordFeedback(
  db: DatabaseSync,
  readState: () => State,
  actor: Person,
  runId: string,
  outcome: unknown,
) {
  if (outcome !== "completed" && outcome !== "unresolved")
    throw new Error("反馈状态无效");
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare("SELECT body FROM service_runs WHERE id=?")
      .get(runId) as { body: string } | undefined;
    const run = row && (JSON.parse(row.body) as Run | undefined);
    if (!run || !accessibleRun(run, readState(), actor))
      throw new Error("记录不存在或未获授权，物品归属或型号可能已改变");
    if (run.status !== "succeeded")
      throw new Error("只有已给出的模型建议可以记录执行反馈");
    const previous = db
      .prepare("SELECT outcome, at FROM service_feedback WHERE run_id=?")
      .get(runId) as { outcome: string; at: string } | undefined;
    if (previous && previous.outcome !== outcome)
      throw new Error("本次反馈已保存；请重新提问后记录新的尝试");
    const at = previous?.at || new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO service_feedback VALUES (?, ?, ?)").run(
      runId,
      outcome,
      at,
    );
    db.exec("COMMIT");
    return { runId, outcome, at, basis: "user_report" as const };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Recover only expired leases; never reissue model requests or business writes. */
export function recoverStaleRuns(db: DatabaseSync, now = Date.now()) {
  const rows = db
    .prepare(
      "SELECT id,body FROM service_runs WHERE json_extract(body,'$.status')='running'",
    )
    .all() as { id: string; body: string }[];
  let count = 0;
  for (const row of rows) {
    const run = JSON.parse(row.body) as Run;
    const latest = run.events?.at(-1)?.at || run.startedAt;
    if (now - Date.parse(latest) < 120000) continue;
    run.status = "failed";
    run.errorCode = "interrupted";
    run.latencyMs = now - Date.parse(run.startedAt);
    run.events = run.events || [];
    run.events.push({
      sequence: run.events.length + 1,
      stage: "failed",
      at: new Date(now).toISOString(),
      elapsedMs: run.latencyMs,
      detail: "interrupted: expired local execution lease",
    });
    saveRun(db, run);
    count++;
  }
  return count;
}
