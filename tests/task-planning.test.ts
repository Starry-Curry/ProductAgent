import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  seed,
  mutate,
  visible,
  type State,
  type Plan,
  type Person,
} from "../src/lib/domain.ts";
import {
  previewPreparation,
  currentPreparation,
} from "../src/lib/life/task-planning.ts";
import { migrate } from "../src/lib/migrations.ts";
import { migrateLife } from "../src/lib/life/schema.ts";
import { respond } from "../src/lib/agent/service.ts";
import { decideAction } from "../src/lib/home/store.ts";
import { readSession } from "../src/lib/repositories/sessions.ts";
import { routeHome } from "../src/lib/home/router.ts";
import type { ServiceSession } from "../src/lib/agent/contracts.ts";

function fixture() {
  const state = seed();
  function add(name: string, extra = {}) {
    mutate(state, "lin", "createItem", { name });
    const i = state.items.at(-1)!;
    Object.assign(
      i,
      {
        source: "用户录入",
        availability: "available",
        state: "在用",
        shared: false,
      },
      extra,
    );
    return i;
  }
  const camera = add("出游相机"),
    bag = add("背包"),
    torch = add("手电筒"),
    charger = add("相机充电器");
  return { state, camera, bag, torch, charger, add };
}
const goal = "明天要去拍照，帮我准备清单，只用家里的东西，不买新的";
function save(state: State, plan?: Plan, change?: string) {
  const input = {
    goal,
    ...(plan
      ? {
          planId: plan.id,
          expectedRevision: plan.preparation!.revision,
          change,
        }
      : {}),
  };
  const preview = previewPreparation(state, "lin", input);
  const command = {
    ...input,
    requestId: crypto.randomUUID(),
    digest: preview.digest,
  };
  mutate(state, "lin", "saveTaskPlan", command);
  return { plan: state.plans!.at(-1)!, command };
}
function step(
  state: State,
  plan: Plan,
  id: string,
  status = "done",
  actor: Person = "lin",
) {
  const command = {
    planId: plan.id,
    stepId: id,
    status,
    expectedRevision: plan.preparation!.revision,
    requestId: crypto.randomUUID(),
  };
  mutate(state, actor, "setPreparationStep", command);
  return command;
}

test("摄影准备只使用获准的真实登记，未登记资源与未知电量不假定存在", () => {
  const f = fixture();
  f.add("私人物品相机", { owner: "friend", shared: false });
  const { plan } = save(f.state);
  assert.equal(plan.preparation!.source, "local-rules");
  assert.equal(plan.preparation!.status, "preparing");
  assert.deepEqual(
    new Set(plan.itemIds),
    new Set([f.camera.id, f.bag.id, f.torch.id]),
  );
  assert.ok(plan.preparation!.steps.every((s) => !s.completionReport));
  assert.match(JSON.stringify(plan.preparation!.steps), /存储空间/);
  const empty = save(seed()).plan;
  assert.equal(empty.preparation!.status, "blocked");
  assert.match(JSON.stringify(empty.preparation!.steps), /不代表你现实中没有/);
});

test("请求编号碰撞不能覆盖旧计划或其他成员的准备进度", () => {
  const { state } = fixture();
  const { command } = save(state);
  const before = structuredClone(state);
  const input = { goal };
  const preview = previewPreparation(state, "dad", input);
  assert.throws(
    () =>
      mutate(state, "dad", "saveTaskPlan", {
        ...input,
        requestId: command.requestId,
        digest: preview.digest,
      }),
    /请求编号已经使用/,
  );
  assert.deepEqual(state, before);
  const legacy = {
    id: crypto.randomUUID(),
    actor: "lin" as const,
    goal: "旧计划",
    itemIds: [],
    at: "2026-10-21",
  };
  state.plans!.push(legacy);
  assert.throws(
    () =>
      mutate(state, "lin", "saveTaskPlan", {
        ...input,
        requestId: legacy.id,
        digest: previewPreparation(state, "lin", input).digest,
      }),
    /请求编号已经使用/,
  );
  assert.equal(legacy.goal, "旧计划");
});

test("准备依赖、逐项用户确认、重放与过期revision保护", () => {
  const { state, camera } = fixture();
  const { plan, command } = save(state);
  mutate(state, "lin", "saveTaskPlan", command);
  assert.equal(state.plans!.length, 1);
  assert.throws(() => step(state, plan, `pack:${camera.id}`), /前置步骤/);
  const done = step(state, plan, `check:${camera.id}`);
  const revision = plan.preparation!.revision;
  mutate(state, "lin", "setPreparationStep", done);
  assert.equal(plan.preparation!.revision, revision);
  assert.throws(
    () =>
      mutate(state, "lin", "setPreparationStep", {
        ...done,
        status: "pending",
      }),
    /重复请求/,
  );
  assert.throws(
    () =>
      mutate(state, "lin", "setPreparationStep", {
        ...done,
        requestId: crypto.randomUUID(),
      }),
    /计划已更新/,
  );
  step(state, plan, `pack:${camera.id}`);
  step(state, plan, "scene");
  assert.equal(plan.preparation!.status, "ready");
  assert.equal(plan.preparation!.steps[0].completionReport!.source, "user");
  assert.throws(() => step(state, plan, "scene", "skipped"), /必要步骤/);
});

test("相机没电新增真实依赖，缩短时间和排除物品保留已完成报告", () => {
  const { state, camera, bag, torch } = fixture();
  const { plan } = save(state);
  step(state, plan, "scene");
  step(state, plan, `check:${camera.id}`);
  step(state, plan, `pack:${camera.id}`);
  step(state, plan, `optional:${torch.id}`);
  const reports = plan.preparation!.steps.map((s) => s.completionReport);
  save(state, plan, "相机没电了");
  assert.ok(
    plan.preparation!.steps.some((s) => s.id === `charge:${camera.id}`),
  );
  assert.equal(
    plan.preparation!.steps.find((s) => s.id === "scene")!.status,
    "done",
  );
  assert.equal(
    plan.preparation!.steps.find((s) => s.id === `pack:${camera.id}`)!.status,
    "done",
  );
  assert.ok(
    plan.preparation!.steps.find((s) => s.id === `pack:${camera.id}`)!
      .reviewReason,
  );
  assert.equal(plan.preparation!.status, "blocked");
  save(state, plan, "现在只剩10分钟，手电筒也不带了");
  assert.equal(plan.preparation!.constraints.preparationMinutes, 10);
  assert.equal(
    plan.preparation!.steps.find((s) => s.id === `optional:${bag.id}`)!.status,
    "skipped",
  );
  assert.equal(
    plan.preparation!.steps.find((s) => s.id === `optional:${torch.id}`)!
      .status,
    "skipped",
  );
  assert.deepEqual(
    plan.preparation!.steps.find((s) => s.id === `optional:${torch.id}`)!
      .completionReport,
    reports.at(-1),
  );
  assert.ok(!plan.itemIds.includes(torch.id));
  assert.throws(
    () => step(state, plan, `optional:${torch.id}`, "pending"),
    /排除/,
  );
  assert.match(JSON.stringify(plan.preparation!.steps), /不能保证/);
  step(state, plan, `charge:${camera.id}`);
  step(state, plan, `check:${camera.id}`);
  step(state, plan, `pack:${camera.id}`);
  assert.equal(plan.preparation!.status, "ready");
  save(state, plan, "相机又没电了");
  assert.equal(plan.preparation!.status, "blocked");
  assert.ok(
    plan.preparation!.steps.find((s) => s.id === `charge:${camera.id}`)!
      .reviewReason,
  );
});

test("充电资源缺失明确受阻，不虚构充电线和固定充满时间", () => {
  const { state, charger, camera } = fixture();
  state.items = state.items.filter((i) => i.id !== charger.id);
  const { plan } = save(state);
  save(state, plan, "相机没电了");
  assert.match(
    plan.preparation!.steps.find((s) => s.id === `charge:${camera.id}`)!
      .blockedReason!,
    /缺少/,
  );
  assert.throws(() => step(state, plan, `charge:${camera.id}`), /缺少/);
  assert.equal(
    state.items.find((i) => i.id === camera.id)!.availability,
    "available",
  );
});

test("相机配件不是拍照设备；可用手机可作为真实已有替代", () => {
  const f = fixture();
  f.state.items = f.state.items.filter((i) => i.id !== f.camera.id);
  f.add("相机包");
  const { plan } = save(f.state);
  assert.equal(plan.preparation!.status, "blocked");
  const phone = f.add("备用手机");
  save(f.state, plan, "重新核对");
  assert.ok(plan.itemIds.includes(phone.id));
  assert.ok(!plan.itemIds.includes(f.charger.id));
});

test("不把活动时长当准备时限，未知调整不会静默改写", () => {
  const { state } = fixture();
  const preview = previewPreparation(state, "lin", {
    goal: "明天出门拍照两小时，需要准备什么",
  });
  assert.equal(preview.preparation.constraints.preparationMinutes, undefined);
  const { plan } = save(state);
  assert.throws(() => save(state, plan, "改成不一样的"), /还不能可靠识别/);
});

test("权限撤销、物品状态和数量变化使已完成依赖重新核对，旧确认卡拒绝提交", () => {
  const { state, camera } = fixture();
  camera.owner = "dad";
  camera.shared = true;
  const initial = previewPreparation(state, "lin", { goal });
  camera.attributes = { quantity: 0 };
  assert.throws(
    () =>
      mutate(state, "lin", "saveTaskPlan", {
        goal,
        digest: initial.digest,
        requestId: crypto.randomUUID(),
      }),
    /已变化/,
  );
  camera.attributes.quantity = 1;
  const { plan } = save(state);
  step(state, plan, `check:${camera.id}`);
  camera.shared = false;
  const viewed = visible(state, "lin").plans![0].preparation!;
  assert.equal(viewed.status, "blocked");
  assert.ok(
    viewed.steps.find((s) => s.id === `check:${camera.id}`)!.completionReport,
  );
  assert.throws(
    () => step(state, plan, `pack:${camera.id}`),
    /不可用|不可访问/,
  );
  assert.throws(() => step(state, plan, "scene", "done", "dad"), /未获授权/);
  assert.equal(visible(state, "dad").plans!.length, 0);
});

test("重开前置步骤不会继续把历史下游完成当成当前就绪", () => {
  const { state, camera } = fixture();
  const { plan } = save(state);
  step(state, plan, `check:${camera.id}`);
  step(state, plan, `pack:${camera.id}`);
  step(state, plan, `check:${camera.id}`, "pending");
  assert.ok(
    currentPreparation(state, "lin", plan)!.steps.find(
      (s) => s.id === `pack:${camera.id}`,
    )!.reviewReason,
  );
});

test("统一Agent→确认卡→SQLite进度→刷新与续聊；全程零模型请求", async () => {
  const filename = path.join(
    mkdtempSync(path.join(tmpdir(), "wujian-preparation-")),
    "test.sqlite",
  );
  const db = new DatabaseSync(filename);
  const { state, camera } = fixture();
  db.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE workspace(id INTEGER PRIMARY KEY,body TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO workspace VALUES(1,?)").run(JSON.stringify(state));
  migrate(db, filename);
  migrateLife(db, filename);
  const read = () =>
    JSON.parse(
      (db.prepare("SELECT body FROM workspace").get() as { body: string }).body,
    ) as State;
  const provider = {
    model: "offline",
    ready: false,
    async generate(): Promise<never> {
      throw Error("must not call model");
    },
  };
  try {
    const temporary = await respond(
      db,
      read,
      "lin",
      {
        question: goal,
        requestId: crypto.randomUUID(),
        mode: "auto",
        temporary: true,
        uiContext: { page: "assistant" },
      },
      provider,
    );
    assert.equal(temporary.reply.actionCards, undefined);
    assert.equal(read().plans?.length || 0, 0);
    const result = await respond(
      db,
      read,
      "lin",
      {
        question: goal,
        requestId: crypto.randomUUID(),
        mode: "auto",
        uiContext: { page: "assistant" },
        memoryPolicy: "off",
      },
      provider,
    );
    assert.equal(result.reply.route!.intent, "prepare");
    assert.equal(result.modelCalls, 0);
    assert.equal(read().plans?.length || 0, 0);
    const confirmed = decideAction(
      db,
      read,
      "lin",
      result.reply.actionCards![0].id,
      "confirm",
    );
    const replay = decideAction(
      db,
      read,
      "lin",
      result.reply.actionCards![0].id,
      "confirm",
    );
    assert.equal(replay.targetId, confirmed.targetId);
    const plan = read().plans![0];
    const changed = read();
    step(changed, changed.plans![0], `check:${camera.id}`);
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(changed),
    );
    const next = await respond(
      db,
      read,
      "lin",
      {
        question: "相机没电了",
        requestId: crypto.randomUUID(),
        sessionId: confirmed.session.id,
        expectedRevision: confirmed.session.revision,
        mode: "auto",
      },
      provider,
    );
    assert.equal(next.reply.route!.intent, "prepare");
    decideAction(db, read, "lin", next.reply.actionCards![0].id, "confirm");
    assert.equal(read().plans![0].id, plan.id);
    assert.ok(
      read().plans![0].preparation!.steps.find(
        (s) => s.id === `check:${camera.id}`,
      )!.completionReport,
    );
    assert.ok(
      readSession(db, read(), "lin", confirmed.session.id).known.taskPlanId,
    );
    const readonly = new DatabaseSync(filename, { readOnly: true });
    assert.match(
      (readonly.prepare("SELECT body FROM workspace").get() as { body: string })
        .body,
      /charge:/,
    );
    readonly.close();
  } finally {
    db.close();
  }
});

test("临时会话不保存准备卡，创意请求和商品使用不被准备路由抢占", () => {
  const { state } = fixture();
  const session = {
    known: { uiPage: "assistant" },
    mode: "auto",
  } as unknown as ServiceSession;
  assert.equal(routeHome(goal, state, "lin", session).intent, "prepare");
  assert.equal(
    routeHome("明天拍照有什么有趣的新玩法", state, "lin", session).intent,
    "plan",
  );
  assert.notEqual(
    routeHome("相机如何充电", state, "lin", session).intent,
    "prepare",
  );
});
