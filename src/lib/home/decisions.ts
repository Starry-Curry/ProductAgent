import type { DatabaseSync } from "node:sqlite";
import { canRead, people, type State, type Person } from "../domain.ts";
import type { AssistantReply, ServiceSession } from "../agent/contracts.ts";
import type { HomeRoute } from "./contracts.ts";
import { rooms } from "./contracts.ts";
import { placements, proposeAction } from "./store.ts";
import { prepareActivity } from "../planning.ts";
import { syntheticItem, usable as lifeUsable } from "../life/availability.ts";
import {
  previewPreparation,
  isPreparationGoal,
} from "../life/task-planning.ts";

export function homeDecision(
  db: DatabaseSync,
  state: State,
  actor: Person,
  session: ServiceSession,
  q: string,
  route: HomeRoute,
  temporary = false,
): AssistantReply | undefined {
  const answer = (
    text: string,
    outcome: AssistantReply["outcome"] = "answered",
  ): AssistantReply => ({
    answer: text,
    outcome,
    source: "local-memory",
    steps: [],
    questions: [],
    citations: [],
    memoryIds: [],
    evidenceIds: [],
    route,
  });
  const item = state.items.find(
    (i) => i.id === route.itemId && canRead(i, actor),
  );
  const previousUser = [...session.messages]
    .reverse()
    .find((message) => message.role === "user" && message.text !== q);
  if (
    session.known.interfaceMode === "care" &&
    /记不住|学不会|觉得自己.*笨/.test(q) &&
    /没修好|尚未修好|暂时停用|不要使用/.test(previousUser?.text || "")
  )
    return answer(
      "记不住操作不代表你笨，可以随时再问，不用一次记住。刚才提到的物品还不能确认已经修好，先不要操作或通电试用。等负责维修的家人或售后确认可以使用后，我再用文字一步步帮你看说明。",
    );
  if (
    route.intent === "app" &&
    /我知道了|我已知晓/.test(q) &&
    /修好|维修|能用|可以用|状态/.test(q)
  )
    return answer(
      "“我知道了”只表示你收到了提醒，不代表物品已经修好。仍待维修的物品先不要使用，也不要通电试用；请向负责维修的家人或售后确认进展。提醒仍然有效。",
    );
  if (route.intent === "app" && session.known.interfaceMode === "care")
    return answer(
      "这里是大字关怀版。你可以选一件物品，写下不会用的地方；也可以打开“家人交代的事”，查看自己的提醒和待办。重要提醒点“我知道了”只表示收到，不代表物品已经修好。其他功能在右上角切换普通版后使用。",
    );
  if (
    route.intent === "app" &&
    /下单|订单|购物|真实账号|跨设备|通知真人/.test(q)
  )
    return answer(
      "目前没有购物下单、订单同步、真实跨设备家庭账户或真人通知接口。家庭事项是真实写入本机的演示协作，必须由用户确认处理；我不会把文字建议说成已经执行。",
    );
  if (route.intent === "app" && /识物|识别照片|视觉/.test(q))
    return answer(
      "可以上传并保存物品照片、解码条形码/二维码，但当前未启用视觉识物模型。名称与型号可人工填写，目录匹配只是待确认候选，不会凭照片猜准确型号。",
    );
  if (route.intent === "app" && /删除记忆|忘记/.test(q))
    return answer(
      "到 AI 助手展开“个人记忆、来源与可选交流方式”，查看并忘记相应记录；若是照片和生活原话，请到生活故事或物品的故事中编辑/删除。普通聊天、长期记忆和图文片段分别管理，删除不会承诺立即擦除数据库备份。",
    );
  if (route.intent === "app")
    return answer(
      "物间可以从三件小事开始：\n1. 有问题：在 AI 助手直接聊天，或打开物品的使用帮助。\n2. 想尝试：到发现新玩法描述目标，可选物品、时间及限制，再继续修改方案。\n3. 留住生活：在物品故事或生活故事保存照片＋原话，可关联多件物品并编辑、删除。\n家庭页管理共享事项；社交页查看礼物与选中的故事。录入物品可用照片、扫码、型号、链接或说明书，信息不明时人工确认。云端状态和费用开关可在配置指南查看。",
      "answered",
    );
  if (route.intent === "clarify")
    return answer(route.reason + "。", "needs_info");
  if (route.intent === "story" && !item && session.known.uiPage)
    return answer(
      "目前没有找到可引用的相关生活片段。你可以补充事件线索，或到生活故事查看已保存的原话；普通聊天不要求先选物品。",
      "needs_info",
    );
  if (route.intent === "story" && !item)
    return answer(
      "这段故事想留给哪件物品？点选它后继续说，就能与它关联。",
      "needs_info",
    );
  if (route.intent === "locate") {
    if (!item) {
      const own = state.items.filter((i) => canRead(i, actor) && !i.demo);
      return answer(
        own.length
          ? "你当前可访问的日常物品：\n" +
              own
                .slice(0, 20)
                .map((i) => `${i.name} · ${i.location}`)
                .join("\n") +
              "\n可以告诉我想找哪一件。"
          : "还没有可查找的日常物品，先登记一件，或点开房间中的演示角色体验。",
        "needs_info",
      );
    }
    return {
      ...answer(
        `${item.name}${item.demo ? "（演示物品）" : ""}记录的位置是“${item.location}”。你可以点开它继续聊。`,
      ),
      caveat: "来自物品档案，不代表实时定位。",
      route: { ...route, candidates: [{ id: item.id, name: item.name }] },
    };
  }
  const requestId = session.known.turnRequestId;
  if (
    temporary &&
    ["move", "plan", "prepare", "handoff"].includes(route.intent)
  )
    return answer(
      "这是临时对话，不保存计划、位置或家庭事项。关闭临时提问后，我可以准备待你确认的行动卡。",
      "needs_info",
    );
  if (route.intent === "prepare") {
    const prior =
      !isPreparationGoal(q) && session.known.taskPlanId
        ? state.plans?.find(
            (p) =>
              p.id === session.known.taskPlanId &&
              p.actor === actor &&
              p.preparation,
          )
        : undefined;
    const input = {
      goal: prior?.goal || q,
      ...(prior
        ? {
            planId: prior.id,
            expectedRevision: prior.preparation!.revision,
            change: q,
          }
        : {}),
    };
    const preview = previewPreparation(state, actor, input);
    const itemIds = [
      ...new Set(
        preview.preparation.steps
          .filter((s) => s.status !== "skipped")
          .flatMap((s) => s.bindings.map((b) => b.itemId)),
      ),
    ];
    return {
      ...answer(
        prior
          ? "已保留完成记录，下面是调整后的准备清单。确认后更新。"
          : "先核对已有物品与现场条件，确认后保存准备清单。",
      ),
      source: "local-planning",
      actionCards: [
        proposeAction(
          db,
          state,
          actor,
          session,
          requestId,
          {
            ...input,
            kind: "taskPlan",
            digest: preview.digest,
            itemIds,
          },
          prior ? "更新摄影准备" : "摄影出游准备",
          [
            ...preview.preparation.steps.map(
              (s) =>
                `${s.required ? "必要" : "可选"} · ${s.action}${s.status === "skipped" ? "（已省略）" : s.completionReport ? "（保留完成报告）" : ""}${s.blockedReason ? "：" + s.blockedReason : ""}${s.reviewReason ? "：需再次核对" : ""}`,
            ),
            ...(preview.preparation.constraints.preparationMinutes
              ? [
                  `准备时间：${preview.preparation.constraints.preparationMinutes}分钟，不等于活动时长，也不保证充电完成。`,
                ]
              : []),
            "仅使用已登记且获准访问的物品；电量、空间、天气和充电适配性需现场确认。",
          ],
        ),
      ],
      caveat:
        "摄影准备的有限本地规则，未调用模型；保存清单不表示现实任务完成。",
    };
  }
  if (route.intent === "move") {
    if (!item)
      return answer(
        "想调整哪件物品？先点选它，再告诉我要放到哪个房间。",
        "needs_info",
      );
    if (item.owner !== actor)
      return answer("这件物品可以查看，位置调整需要由所有者操作。", "blocked");
    const room = rooms.find((r) => r.id !== "other" && q.includes(r.name));
    if (!room)
      return answer("想把它放到客厅、厨房、书房、卧室还是玄关？", "needs_info");
    const place = placements(db, state, actor).find(
      (p) => p.itemId === item.id,
    )!;
    const detail = [
      `物品：${item.name}`,
      `记录位置：${item.location} → ${room.name}`,
      "确认后更新房间示意与档案；不会移动实体家具。",
    ];
    return {
      ...answer("我准备好了位置调整，确认后保存。"),
      actionCards: [
        proposeAction(
          db,
          state,
          actor,
          session,
          requestId,
          {
            kind: "move",
            itemId: item.id,
            roomId: room.id,
            expectedRevision: place.revision,
            expectedLocation: item.location,
          },
          "把它放到" + room.name,
          detail,
        ),
      ],
    };
  }
  if (route.intent === "handoff") {
    if (!item)
      return answer(
        "这件事和哪件物品有关？点选物品后，我会准备一段可预览的家庭事项。",
        "needs_info",
      );
    if (!item.shared || actor === "friend")
      return answer(
        "家庭事项需要关联已共享的物品，并由家庭成员创建。可以先在物品档案核对共享范围。",
        "blocked",
      );
    const assignee: "lin" | "dad" = /爸爸/.test(q)
      ? "dad"
      : /小林/.test(q)
        ? "lin"
        : actor === "dad"
          ? "lin"
          : "dad";
    const summary = (item.demo ? "[演示] " + q : q).slice(0, 120);
    return {
      ...answer("确认下面的事项摘要后，我再交给家人。"),
      actionCards: [
        proposeAction(
          db,
          state,
          actor,
          session,
          requestId,
          { kind: "handoff", itemId: item.id, assignee, summary },
          "请" + people[assignee] + "接着处理",
          [
            "关联物品：" + item.name,
            "家人将看到：" + summary,
            "不附上你的私人故事、记忆或整段对话。",
          ],
        ),
      ],
    };
  }
  if (route.intent === "plan") {
    if (state.items.find((i) => i.id === session.itemId)?.demo)
      return answer(
        "这是演示物品的独立对话。回到全屋对话后，可以按你的日常物品准备和保存计划。",
        "needs_info",
      );
    const planItems =
      session.known.memoryPolicy !== undefined
        ? state.items.filter((i) => !syntheticItem(i) && lifeUsable(i))
        : state.items;
    const existing = prepareActivity(q, planItems, actor);
    const reading = /阅读角/.test(q);
    if (!existing && !reading) return;
    const usable = planItems.filter(
      (i) =>
        canRead(i, actor) &&
        !i.demo &&
        ["在用", "闲置", "待确认"].includes(i.state),
    );
    const readingItems = usable.filter((i) =>
      /lamp|shelf|table|cup/.test(i.icon),
    );
    const checklist = existing
      ? existing.map((row) => ({
          label: row.label,
          status: row.items.length
            ? "已找到候选，待核实数量和适用性"
            : "待你核对是否已有",
        }))
      : [
          {
            label: "选择现有稳定桌面与舒适座位，保留通道",
            status: "待现场确认",
          },
          { label: "核对台灯位置、插座与实际阅读照明", status: "待现场确认" },
          { label: "选择想读的书，留出一段不被打扰的时间", status: "待你安排" },
        ];
    const itemIds = [
      ...new Set(
        existing
          ? existing.flatMap((r) => r.items.map((i) => i.id))
          : readingItems.map((i) => i.id),
      ),
    ];
    const detail = [
      "只使用你可访问的日常物品，演示案例不计入持有。",
      ...(existing
        ? existing.map(
            (row) =>
              row.label +
              "：" +
              (row.items.length
                ? row.items.map((i) => i.name).join("、") +
                  "（待核实数量与适用性）"
                : "待你核对是否已有"),
          )
        : checklist.map((row) => row.label + "：" + row.status)),
    ];
    return {
      ...answer(
        reading
          ? "先用已有物品准备一个阅读角。摆放、稳定性和照明仍需你在现场核对。"
          : "我按现有物品准备了清单，缺口先请你核对，不默认需要购买。",
      ),
      actionCards: [
        proposeAction(
          db,
          state,
          actor,
          session,
          requestId,
          { kind: "plan", goal: q.slice(0, 150), itemIds, checklist },
          reading ? "阅读角准备" : "活动准备清单",
          detail,
        ),
      ],
      caveat: "有限场景规则建议；未测量空间或验证实物组合。",
    };
  }
}
