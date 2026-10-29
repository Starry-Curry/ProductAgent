import { z } from "zod";
import {
  canRead,
  type Item,
  type Person,
  type Plan,
  type State,
} from "../domain.ts";
import { AgentError } from "../agent/contracts.ts";
import { syntheticItem, usable } from "./availability.ts";
import {
  mentionsItem,
  noPurchase,
  goalDuration,
  positiveGoalText,
} from "./planning-constraints.ts";
import type { Preparation, PreparationStep } from "./task-types.ts";

export const preparationRequest = z
  .object({
    goal: z.string().trim().min(1).max(500),
    planId: z.string().uuid().optional(),
    expectedRevision: z.number().int().positive().optional(),
    change: z.string().trim().max(500).optional(),
  })
  .strict();
export type PreparationRequest = z.infer<typeof preparationRequest>;
export function isPreparationGoal(q: string) {
  return (
    /拍照|摄影|拍摄/.test(positiveGoalText(q)) &&
    /准备|要带|带什么|清单|明天|出发|出游|出门/.test(q) &&
    !/玩法|创意|游戏|有趣|新用途|昨天|去年|上次/.test(q)
  );
}
export const isPreparationChange = (q: string) =>
  /没电|电量不足|只剩|只有.{0,8}(分钟|小时)|不带|不用|排除|重新核对|继续准备/.test(
    q,
  );
// Exact serialized snapshot for stale-preview/replay comparison, not a signature or credential.
// This domain module is also imported by the browser; keep it free of Node-only imports.
const hash = (v: unknown) => JSON.stringify(v);
export const resourceFingerprint = (i: Item) =>
  hash([
    i.owner,
    i.shared,
    i.name,
    i.model,
    i.productBinding,
    i.state,
    i.availability,
    i.attributes?.quantity,
    i.attributes?.quantityUnit,
    i.attributes?.expiresOn,
  ]);
const available = (i: Item) =>
  usable(i) ||
  ((!i.availability || i.availability === "unknown") &&
    usable({
      ...i,
      availability: "available",
      state: i.state === "待确认" ? "在用" : i.state,
    }));
const binding = (i: Item) => ({
  itemId: i.id,
  name: i.name,
  fingerprint: resourceFingerprint(i),
  basis: "来自用户登记的名称、类别或能力；不代表检测过实物或电量",
});
const cameraAccessory = (i: Item) =>
  /充电|电池|存储卡|SD卡|相机包|镜头|支架|背带|数据线/i.test(i.name);
function ownPlan(state: State, actor: Person, id: string) {
  const plan = state.plans?.find(
    (p) => p.id === id && p.actor === actor && p.preparation,
  );
  if (!plan) throw new AgentError("准备计划不存在或未获授权", 403);
  return plan as Plan & { preparation: Preparation };
}
function status(p: Preparation) {
  p.status = p.steps.some(
    (s) => s.required && (s.status === "blocked" || s.reviewReason),
  )
    ? "blocked"
    : p.steps.filter((s) => s.required).every((s) => s.status === "done")
      ? "ready"
      : "preparing";
  return p;
}
/** Read-time checks never mark real actions complete or mutate stored history. */
export function currentPreparation(
  state: State,
  actor: Person,
  plan: Plan,
): Preparation | undefined {
  if (plan.actor !== actor || !plan.preparation) return;
  const p = structuredClone(plan.preparation);
  for (const step of p.steps) {
    if (step.status === "skipped") continue;
    for (const ref of step.bindings) {
      const item = state.items.find(
        (i) => i.id === ref.itemId && canRead(i, actor),
      );
      if (!item || syntheticItem(item) || !available(item)) {
        step.reviewReason = "物品权限或可用状态已变化，请重新核对计划";
        step.blockedReason = "关联物品当前不可用或不可访问";
        if (step.status !== "done") step.status = "blocked";
      } else if (resourceFingerprint(item) !== ref.fingerprint) {
        step.reviewReason = "物品资料已变化，请重新核对计划后再次确认";
      }
    }
  }
  // A previously completed dependent action is historical evidence, not proof under new conditions.
  for (const step of p.steps) {
    if (step.status === "skipped") continue;
    if (
      step.dependencies.some((id) => {
        const dep = p.steps.find((s) => s.id === id);
        return !dep || dep.status !== "done" || dep.reviewReason;
      }) &&
      step.status === "done"
    )
      step.reviewReason ||= "前置条件变化，需要再次确认";
  }
  return status(p);
}

/** Bounded photography preparation rules, not general AI planning or device instructions. */
export function previewPreparation(state: State, actor: Person, raw: unknown) {
  const input = preparationRequest.parse(raw);
  const old = input.planId ? ownPlan(state, actor, input.planId) : undefined;
  if (old && input.expectedRevision !== old.preparation.revision)
    throw new AgentError("计划已更新，请刷新后再修改", 409);
  if (!old && !isPreparationGoal(input.goal))
    throw new AgentError("目前准备清单支持摄影出游，请描述出发和准备需求");
  const goal = old?.goal || input.goal;
  const change = old ? input.change || "重新核对" : goal;
  const constraints: Preparation["constraints"] = old
    ? structuredClone(old.preparation.constraints)
    : {
        noPurchase: noPurchase(goal),
        excludedItemIds: [],
        unpoweredItemIds: [],
      };
  const inventory = state.items.filter(
    (i) => canRead(i, actor) && !syntheticItem(i),
  );
  let recognized = !old || /重新核对|继续准备/.test(change);
  const powerReports = new Set<string>();
  for (const clause of change.split(/[，。；,;\n]/)) {
    const named = inventory.filter(
      (i) =>
        mentionsItem(clause, i.name) &&
        (!cameraAccessory(i) ||
          clause.includes(i.name) ||
          /充电器|相机包|镜头|电池|存储卡/.test(clause)),
    );
    if (/不带|不用|排除/.test(clause) && named.length) {
      constraints.excludedItemIds.push(...named.map((i) => i.id));
      recognized = true;
    }
    if (/没电|电量不足/.test(clause) && named.length) {
      constraints.unpoweredItemIds.push(...named.map((i) => i.id));
      named.forEach((i) => powerReports.add(i.id));
      recognized = true;
    }
    const time =
      clause.match(
        /(?:只剩|只有|还剩|剩下)\s*([\d一二两三四五六七八九十半]+\s*(?:个)?(?:分钟|小时))/,
      )?.[1] ||
      clause.match(
        /([\d一二两三四五六七八九十半]+\s*(?:个)?(?:分钟|小时))后.{0,5}(?:出发|出门)/,
      )?.[1];
    if (time && goalDuration(time)) {
      constraints.preparationMinutes = goalDuration(time);
      recognized = true;
    }
  }
  constraints.noPurchase ||= noPurchase(change);
  constraints.departureText ||= goal.match(
    /(?:明天|后天|今天|周末)(?:早上|下午|晚上)?/,
  )?.[0];
  constraints.excludedItemIds = [...new Set(constraints.excludedItemIds)];
  constraints.unpoweredItemIds = [...new Set(constraints.unpoweredItemIds)];
  if (!recognized)
    throw new AgentError(
      "这次调整还不能可靠识别。可以说明相机没电、剩余准备时间或不带哪件物品；完成进度请在清单中确认。",
    );
  const pool = inventory
    .filter((i) => !constraints.excludedItemIds.includes(i.id))
    .sort((a, b) => Number(available(b)) - Number(available(a)));
  const matches = (i: Item, pattern: RegExp) =>
    pattern.test(
      [i.name, i.category, ...(i.attributes?.capabilities || [])].join(" "),
    );
  const cameras = pool.filter(
    (i) => matches(i, /相机|camera|拍照|摄影/i) && !cameraAccessory(i),
  );
  const phones = pool.filter(
    (i) => matches(i, /手机|smartphone/i) && !/支架|壳|膜|充电|线/.test(i.name),
  );
  const camera =
    cameras.find(available) ||
    phones.find(available) ||
    cameras[0] ||
    phones[0];
  const bag = pool.find((i) => matches(i, /背包|相机包|旅行包/));
  const torch = pool.find((i) => matches(i, /手电筒|手电|flashlight/i));
  const charger = pool.find((i) => matches(i, /充电器|充电套装|充电线/));
  const steps: PreparationStep[] = [];
  function add(
    id: string,
    action: string,
    required: boolean,
    items: Item[],
    conditions: string[],
    dependencies: string[] = [],
    blockedReason?: string,
  ) {
    blockedReason ||= items.some((i) => !available(i))
      ? "已登记，但当前状态不可用；请先核对或选择替代物品"
      : undefined;
    steps.push({
      id,
      action,
      required,
      dependencies,
      conditions,
      bindings: items.map(binding),
      status: blockedReason ? "blocked" : "pending",
      blockedReason,
    });
  }
  add(
    "scene",
    "确认出发地点、天气与通行条件",
    true,
    [],
    ["尚未查询实时天气、场地开放或交通情况，请自行核实；不默认携带未登记物品"],
  );
  if (!camera) {
    add(
      "missing-device",
      "确认可用于拍照的设备",
      true,
      [],
      [
        "没有找到可访问且未排除的相机或手机；这不代表你现实中没有。可以先登记，再重新核对",
      ],
      [],
      "尚缺已确认的拍照设备",
    );
  } else {
    const unpowered = constraints.unpoweredItemIds.includes(camera.id);
    const chargeId = `charge:${camera.id}`;
    if (unpowered) {
      add(
        chargeId,
        `处理${camera.name}的电量不足`,
        true,
        charger ? [camera, charger] : [camera],
        [
          charger
            ? `登记了${charger.name}，但接口、适配性和现场电源仍需按对应官方说明确认；不要盲目连接`
            : "未找到已登记的充电资源，先补充或改选已有设备",
          "本计划不推断充电时长；仅在你现场确认电量足够本次使用后标记完成",
          ...(constraints.preparationMinutes
            ? [
                `只剩${constraints.preparationMinutes}分钟准备，不能保证在出发前充够电；可排除此设备并核对已有替代`,
              ]
            : []),
        ],
        [],
        charger ? undefined : "缺少已登记的充电资源，无法确认可在出发前准备好",
      );
    }
    add(
      `check:${camera.id}`,
      `确认${camera.name}能正常拍照`,
      true,
      [camera],
      [
        "现场核对电量与可用存储空间，试拍并查看结果；登记拥有不等于当前可用",
        "数量、配件及型号专属操作以实物和适用说明为准，不默认另有存储卡或备用电池",
      ],
      unpowered ? [chargeId] : [],
    );
    add(
      `pack:${camera.id}`,
      `准备好${camera.name}`,
      true,
      [camera],
      ["按实际需要妥善携带；标记表示本人报告已准备，不是设备自动检测"],
      [`check:${camera.id}`],
    );
  }
  for (const item of [bag, torch].filter((i): i is Item => !!i))
    add(
      `optional:${item.id}`,
      `按需带上${item.name}`,
      false,
      [item],
      ["按现场需要选择；先确认数量、状态与适用性，不带也不会被计为必要缺口"],
    );
  const previous = currentPreparation(
    state,
    actor,
    old || { id: "", actor, goal, itemIds: [], at: "" },
  );
  const invalidated: string[] = [];
  for (const step of steps) {
    if (
      constraints.preparationMinutes !== undefined &&
      constraints.preparationMinutes <= 10 &&
      !step.required
    )
      step.status = "skipped";
    const before = previous?.steps.find((s) => s.id === step.id);
    if (!before) continue;
    const dependenciesChanged =
      JSON.stringify(before.dependencies) !== JSON.stringify(step.dependencies);
    if (before.completionReport) {
      step.completionReport = before.completionReport;
      step.status = "done";
      if (
        before.reviewReason ||
        step.blockedReason ||
        dependenciesChanged ||
        step.bindings.some((b) => powerReports.has(b.itemId))
      ) {
        step.reviewReason = before.reviewReason || "准备条件变化，需要再次确认";
        invalidated.push(step.id);
      }
    } else if (before.status === "skipped" && !step.required)
      step.status = "skipped";
    if (
      constraints.preparationMinutes !== undefined &&
      constraints.preparationMinutes <= 10 &&
      !step.required &&
      step.status !== "done"
    ) {
      step.status = "skipped";
      step.conditions.push("准备时间缩短，先省略此可选项；仍可自行恢复");
    }
  }
  // Retain completion evidence even when an item is excluded or replaced.
  for (const before of previous?.steps || [])
    if (!steps.some((s) => s.id === before.id) && before.completionReport)
      steps.push({
        ...before,
        required: false,
        status: "skipped",
        blockedReason: undefined,
        reviewReason: undefined,
        conditions: [
          ...before.conditions,
          "此项已从本次携带需求移除；之前的完成报告仍保留",
        ],
      });
  const preparation = status({
    version: 1,
    scenario: "photography",
    source: "local-rules",
    revision: old?.preparation.revision || 0,
    status: "preparing",
    constraints,
    steps,
    receipts: old?.preparation.receipts || [],
    originSessionId: old?.preparation.originSessionId,
    completionCriteria:
      "所有必要准备步骤均由本人现场确认，且没有待重新核对的依赖；不代表摄影出游已经完成",
    history: old?.preparation.history || [],
  });
  const digest = hash({
    goal,
    constraints,
    steps,
    revision: preparation.revision,
  });
  return { goal, preparation, digest, invalidated };
}

/** Invoked only by the existing workspace transaction / confirmed action transaction. */
export function mutatePreparation(
  state: State,
  actor: Person,
  action: string,
  raw: unknown,
): State {
  const common = { requestId: z.string().uuid() };
  const input =
    action === "saveTaskPlan"
      ? preparationRequest
          .extend({
            ...common,
            digest: z.string().min(1).max(64000),
            originSessionId: z.string().uuid().optional(),
          })
          .parse(raw)
      : z
          .object({
            ...common,
            planId: z.string().uuid(),
            expectedRevision: z.number().int().positive(),
            stepId: z.string().min(1).max(150),
            status: z.enum(["pending", "done", "blocked", "skipped"]),
          })
          .strict()
          .parse(raw);
  const old = input.planId
    ? ownPlan(state, actor, input.planId)
    : state.plans?.find((p) => p.id === input.requestId && p.actor === actor);
  if (
    !input.planId &&
    state.plans?.some(
      (p) => p.id === input.requestId && (p.actor !== actor || !p.preparation),
    )
  )
    throw new AgentError("请求编号已经使用，请重新发起", 409);
  const receiptHash = hash({ action, input });
  const receipt = old?.preparation?.receipts.find(
    (r) => r.requestId === input.requestId,
  );
  if (receipt) {
    if (receipt.hash !== receiptHash)
      throw new AgentError("重复请求内容不一致", 409);
    return state;
  }
  const at = new Date().toISOString();
  if (action === "saveTaskPlan" && "digest" in input) {
    const { goal, planId, expectedRevision, change } = input;
    const preview = previewPreparation(state, actor, {
      goal,
      planId,
      expectedRevision,
      change,
    });
    if (preview.digest !== input.digest)
      throw new AgentError("物品或计划已变化，请重新核对后确认", 409);
    const plan: Plan = old || {
      id: input.requestId,
      actor,
      goal: preview.goal,
      itemIds: [],
      at,
    };
    plan.preparation = preview.preparation;
    plan.preparation.originSessionId ||= input.originSessionId;
    plan.itemIds = [
      ...new Set(
        preview.preparation.steps
          .filter((s) => s.status !== "skipped")
          .flatMap((s) => s.bindings.map((b) => b.itemId)),
      ),
    ];
    plan.preparation.history = [
      ...plan.preparation.history,
      {
        at,
        reason: change || "用户确认保存准备清单",
        preserved: plan.preparation.steps
          .filter((s) => s.completionReport)
          .map((s) => s.id),
        invalidated: preview.invalidated,
      },
    ];
    if (!old) (state.plans ||= []).push(plan);
  } else if (old?.preparation && "stepId" in input) {
    if (old.preparation.revision !== input.expectedRevision)
      throw new AgentError("计划已更新，请刷新后再操作", 409);
    const p = currentPreparation(state, actor, old)!;
    const step = p.steps.find((s) => s.id === input.stepId);
    if (!step) throw new AgentError("准备步骤不存在");
    if (
      step.bindings.some((b) =>
        p.constraints.excludedItemIds.includes(b.itemId),
      )
    )
      throw new AgentError(
        "此资源已从本次准备中排除，历史完成记录不能恢复为当前步骤",
      );
    if (input.status === "skipped" && step.required)
      throw new AgentError("必要步骤不能直接跳过，请调整目标或资源");
    if (input.status === "done") {
      if (step.blockedReason) throw new AgentError(step.blockedReason);
      if (
        step.bindings.some((b) => {
          const item = state.items.find(
            (i) => i.id === b.itemId && canRead(i, actor),
          );
          return !item || resourceFingerprint(item) !== b.fingerprint;
        })
      )
        throw new AgentError("物品资料变化，请先重新核对计划", 409);
      if (
        step.dependencies.some((id) => {
          const dep = p.steps.find((s) => s.id === id);
          return !dep || dep.status !== "done" || dep.reviewReason;
        })
      )
        throw new AgentError("请先完成并核对前置步骤");
      step.completionReport = { source: "user", at };
      delete step.reviewReason;
    }
    if (input.status === "pending" && step.blockedReason)
      throw new AgentError("请先调整受阻资源并重新核对计划");
    step.status = input.status;
    if (input.status === "blocked")
      step.reviewReason = "用户报告受阻，请在对话中补充原因并重新核对";
    if (input.status === "pending") {
      delete step.completionReport;
      delete step.reviewReason;
    }
    old.preparation = p;
    p.history.push({
      at,
      reason: `${step.action}：用户标记${input.status}`,
      preserved: p.steps.filter((s) => s.completionReport).map((s) => s.id),
      invalidated: [],
    });
  } else throw new AgentError("不支持的计划操作");
  const plan = (state.plans || []).find(
    (p) => p.id === (input.planId || input.requestId) && p.actor === actor,
  )!;
  plan.preparation!.revision++;
  plan.preparation!.receipts.push({
    requestId: input.requestId,
    hash: receiptHash,
  });
  // Re-evaluate dependent completions when a prerequisite is reopened.
  plan.preparation = currentPreparation(state, actor, plan)!;
  plan.itemIds = [
    ...new Set(
      plan.preparation.steps
        .filter((s) => s.status !== "skipped")
        .flatMap((s) => s.bindings.map((b) => b.itemId)),
    ),
  ];
  return state;
}
