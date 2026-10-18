import type { DatabaseSync } from "node:sqlite";
import { canRead, people, type State, type Person } from "../domain.ts";
import type { AssistantReply, ServiceSession } from "../agent/contracts.ts";
import type { HomeRoute } from "./contracts.ts";
import { rooms } from "./contracts.ts";
import { placements, proposeAction } from "./store.ts";
import { prepareActivity } from "../planning.ts";

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
  if (route.intent === "clarify")
    return answer(route.reason + "。", "needs_info");
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
  if (temporary && ["move", "plan", "handoff"].includes(route.intent))
    return answer(
      "这是临时对话，不保存计划、位置或家庭事项。关闭临时提问后，我可以准备待你确认的行动卡。",
      "needs_info",
    );
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
    const existing = prepareActivity(q, state.items, actor);
    const reading = /阅读角/.test(q);
    if (!existing && !reading) return;
    const usable = state.items.filter(
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
