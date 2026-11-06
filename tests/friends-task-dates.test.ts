import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { seed, mutate } from "../src/lib/domain.ts";
import { mutateCompanion, companionData } from "../src/lib/companion/store.ts";
import {
  validTaskDate,
  dueDateLabel,
} from "../src/lib/companion/task-dates.ts";
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE workspace(id INTEGER PRIMARY KEY,body TEXT)");
  const state = seed();
  db.prepare("INSERT INTO workspace VALUES(1,?)").run(JSON.stringify(state));
  return { db, state };
}
test("friend requests persist, are unique, and require the recipient to accept", () => {
  const { db, state } = fixture();
  const p = mutateCompanion(db, state, "lin", "findFriend", {
    code: "wj-dad",
  }).profile!;
  assert.equal(p.id, "dad");
  const a = mutateCompanion(db, state, "lin", "addFriend", {
    code: "WJ-DAD",
  }).friendship!;
  const b = mutateCompanion(db, state, "lin", "addFriend", {
    code: "WJ-DAD",
  }).friendship!;
  assert.equal(a.id, b.id);
  assert.ok(
    companionData(db, "dad").friendships.some(
      (f) => f.id === a.id && f.status === "pending",
    ),
  );
  assert.throws(
    () =>
      mutateCompanion(db, state, "lin", "friendDecision", {
        id: a.id,
        revision: a.revision,
        decision: "accept",
      }),
    /接收人/,
  );
  assert.throws(
    () =>
      mutateCompanion(db, state, "friend", "friendDecision", {
        id: a.id,
        revision: a.revision,
        decision: "accept",
      }),
    /授权/,
  );
  const accepted = mutateCompanion(db, state, "dad", "friendDecision", {
    id: a.id,
    revision: a.revision,
    decision: "accept",
  }).friendship!;
  assert.equal(accepted.status, "accepted");
  assert.ok(
    companionData(db, "lin").friendships.some(
      (f) => f.id === a.id && f.status === "accepted",
    ),
  );
  assert.throws(
    () =>
      mutateCompanion(db, state, "dad", "friendDecision", {
        id: a.id,
        revision: a.revision,
        decision: "accept",
      }),
    /变化/,
  );
  db.close();
});
test("self or unknown friend IDs are rejected; declining never creates an accepted friend", () => {
  const { db, state } = fixture();
  assert.throws(
    () => mutateCompanion(db, state, "lin", "addFriend", { code: "WJ-LIN" }),
    /自己/,
  );
  assert.throws(
    () =>
      mutateCompanion(db, state, "lin", "findFriend", { code: "fake-account" }),
    /没有找到/,
  );
  const a = mutateCompanion(db, state, "dad", "addFriend", {
    code: "WJ-YU",
  }).friendship!;
  const r = mutateCompanion(db, state, "friend", "friendDecision", {
    id: a.id,
    revision: a.revision,
    decision: "decline",
  }).friendship!;
  assert.equal(r.status, "declined");
  assert.ok(
    !companionData(db, "dad").friendships.some(
      (f) => f.id === a.id && f.status === "accepted",
    ),
  );
  db.close();
});
test("task dates are validated and persisted, including duplicate-request protection", () => {
  const { db, state } = fixture();
  const input = {
    requestId: crypto.randomUUID(),
    title: "购买垃圾袋",
    kind: "purchase",
    assignee: "dad",
    itemId: "",
    dueDate: "2026-11-07",
  };
  const a = mutateCompanion(db, state, "lin", "reportTask", input).task!;
  assert.equal(a.dueDate, "2026-11-07");
  const current = JSON.parse(
    (db.prepare("SELECT body FROM workspace").get() as { body: string }).body,
  );
  assert.equal(
    mutateCompanion(db, current, "lin", "reportTask", input).task?.id,
    a.id,
  );
  assert.throws(
    () =>
      mutateCompanion(db, current, "lin", "reportTask", {
        ...input,
        dueDate: "2026-11-08",
      }),
    /变化/,
  );
  assert.throws(() => validTaskDate("2026-02-30"), /有效/);
  assert.throws(() => validTaskDate("tomorrow"), /有效/);
  db.close();
});
test("only task creator or assignee may change the date and changes leave a log", () => {
  let s = mutate(seed(), "lin", "quickTask", {
    requestId: "task-date-fixture",
    title: "清洗水杯",
    kind: "clean",
    assignee: "dad",
    dueDate: "2026-11-06",
  });
  const task = s.tasks.at(-1)!;
  assert.throws(
    () =>
      mutate(s, "friend", "taskDate", {
        taskId: task.id,
        dueDate: "2026-11-08",
      }),
    /创建人|负责人/,
  );
  s = mutate(s, "lin", "taskDate", { taskId: task.id, dueDate: "2026-11-08" });
  assert.equal(s.tasks.at(-1)?.dueDate, "2026-11-08");
  assert.match(s.tasks.at(-1)!.logs.at(-1)!.text, /2026-11-08/);
  s = mutate(s, "dad", "taskDate", { taskId: task.id, dueDate: "" });
  assert.equal(s.tasks.at(-1)?.dueDate, undefined);
});
test("task date labels distinguish overdue, today, future, complete and unset without UTC date drift", () => {
  const now = new Date("2026-11-05T18:30:00Z");
  assert.equal(dueDateLabel("2026-11-05", false, now).tone, "overdue");
  assert.equal(dueDateLabel("2026-11-06", false, now).tone, "today");
  assert.equal(dueDateLabel("2026-11-08", false, now).tone, "future");
  assert.equal(dueDateLabel("2026-11-05", true, now).tone, "done");
  assert.equal(dueDateLabel(undefined, false, now).text, "未设日期");
});
