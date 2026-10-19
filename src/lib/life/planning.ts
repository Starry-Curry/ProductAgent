import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canRead, type State, type Person } from "../domain.ts";
import { AgentError } from "../agent/contracts.ts";
import type { Provider } from "../ai/provider.ts";
import { boundPack } from "../ai/harness.ts";
import { usable, syntheticItem } from "./availability.ts";
import {
  discoverLife,
  modelIdea,
  storeLifeIdea,
  type LifeIdea,
} from "./ideas.ts";

export const discoveryInput = z
  .object({
    goal: z.string().trim().min(1).max(500),
    itemId: z.string().optional(),
    itemIds: z.array(z.string()).max(30).default([]),
    excludedItemIds: z.array(z.string()).max(100).default([]),
    previousIdeaIds: z.array(z.string().uuid()).max(6).default([]),
    minutes: z.number().int().min(1).max(240).optional(),
    includeSynthetic: z.boolean().default(false),
    model: z.boolean().default(false),
    page: z.enum(["discover", "assistant", "item"]).default("discover"),
  })
  .strict();
const declaresItems = (q: string) =>
  /只用|(?:我有|只有)(?![一二两三四五六七八九十\d半]+(?:个)?(?:小时|分钟|时间|天))/.test(
    q,
  );
function duration(q: string): number | undefined {
  const n = q.match(/(\d+)\s*分钟/);
  if (n) return Math.max(1, Math.min(240, Number(n[1])));
  if (/三十分钟|半小时/.test(q)) return 30;
  if (/二十分钟/.test(q)) return 20;
  if (/十分钟/.test(q)) return 10;
  if (/一刻钟/.test(q)) return 15;
  if (/两(?:个)?小时/.test(q)) return 120;
  if (/一(?:个)?小时/.test(q)) return 60;
}

export function itemAffordances(item: State["items"][number]) {
  const pack = boundPack(item),
    declared = [
      item.name,
      item.category,
      item.attributes?.material,
      ...(item.attributes?.capabilities || []),
      ...(pack?.capabilities || []),
    ].join(" ");
  const capabilities: string[] = [];
  for (const [label, pattern] of [
    ["照明", /手电|灯|照明|lighting/],
    ["收纳", /容器|盒|收纳|架|storage/],
    ["观察记录", /相机|摄影|纸|笔|camera/],
    ["声音", /音箱|音频|audio/],
    ["衣物搭配", /衣|服装|围巾|布料/],
    ["养护观察", /植物|绿植/],
  ] as const)
    if (pattern.test(declared)) capabilities.push(label);
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    material: item.attributes?.material || "未知",
    quantity: item.attributes?.quantity ?? "待确认",
    capabilities,
    capabilityBasis: "本人登记/类别推断，非实物检测",
    officialFacts: pack?.claims || [],
    officialSource: pack?.source,
    limits: pack?.limits || [],
    constraints: pack?.constraints,
  };
}

/** Resolve history on the server, then narrow the real resource set before any model call. */
export async function planDiscovery(
  db: DatabaseSync,
  state: State,
  actor: Person,
  raw: unknown,
  provider: Provider,
  readCurrent: () => State,
) {
  const input = discoveryInput.parse(raw),
    visible = state.items.filter((i) => canRead(i, actor));
  for (const id of [
    ...input.itemIds,
    ...input.excludedItemIds,
    ...(input.itemId ? [input.itemId] : []),
  ])
    if (!visible.some((i) => i.id === id))
      throw new AgentError("所选物品未获授权", 403);
  const previous = input.previousIdeaIds.map((id) => {
    const row = db
      .prepare(
        "SELECT i.body,f.outcome FROM life_ideas i LEFT JOIN life_idea_feedback f ON f.idea_id=i.id AND f.owner=i.owner WHERE i.id=? AND i.owner=?",
      )
      .get(id, actor) as { body: string; outcome: string | null } | undefined;
    if (!row) throw new AgentError("上一轮候选不存在或未获授权", 403);
    const idea = JSON.parse(row.body) as LifeIdea;
    if (idea.itemIds.some((id) => !visible.some((i) => i.id === id)))
      throw new AgentError("上一轮物品权限已变化，请重新开始", 409);
    return {
      id: idea.id,
      title: idea.title,
      itemIds: idea.itemIds,
      goal: idea.goal,
      outcome: row.outcome || "未尝试",
    };
  });
  const lastGoal = previous.at(-1)?.goal;
  const followup =
    previous.length > 0 &&
    /^(?:能不能|可以|再)?(?:更|换|不要|不用|只有|只用|缩短|简单|时间|我只有)/.test(
      input.goal,
    );
  const goal = followup
    ? `${lastGoal?.slice(0, 350)}；本轮调整：${input.goal}`
    : input.goal;
  const excluded = new Set(input.excludedItemIds);
  let ambiguousExclusion = false;
  if (/不要用这个|不用这件|不要用它/.test(input.goal) && !excluded.size) {
    const id =
      input.itemId ||
      (previous.length && previous[0].itemIds.length === 1
        ? previous[0].itemIds[0]
        : undefined);
    if (id) excluded.add(id);
    else ambiguousExclusion = true;
  }
  const named = visible.filter(
    (i) =>
      goal.includes(i.name) ||
      Array.from({ length: Math.max(0, i.name.length - 2) }, (_, n) =>
        i.name.slice(n, n + 3),
      ).some((w) => goal.includes(w)),
  );
  if (/不要用|不用/.test(input.goal))
    for (const i of visible)
      if (input.goal.includes(i.name)) excluded.add(i.id);
  let selected = input.itemIds;
  if (!selected.length && /只有这些|只用这些/.test(input.goal))
    selected = [...new Set(previous.flatMap((p) => p.itemIds))];
  if (!selected.length && declaresItems(input.goal) && named.length)
    selected = named.map((i) => i.id);
  if (!selected.length && followup && declaresItems(lastGoal || ""))
    selected = [...new Set(previous.flatMap((p) => p.itemIds))];
  const minutes = duration(input.goal) || duration(goal) || input.minutes || 30;
  const items = visible.filter(
    (i) =>
      !i.demo &&
      usable(i) &&
      (!syntheticItem(i) || input.includeSynthetic) &&
      !excluded.has(i.id) &&
      (!selected.length || selected.includes(i.id)),
  );
  const scoped = { ...state, items },
    profiles = items.map(itemAffordances);
  const missing: string[] = [];
  if (ambiguousExclusion)
    missing.push(
      "需要排除哪件物品？可以点方案下方的“不用这件”或在可选条件中选择。",
    );
  if (!items.length)
    missing.push(
      "当前没有符合选择与可用状态的本人物品；先录入/确认状态，或明确选择体验合成案例。",
    );
  if (declaresItems(input.goal) && !named.length && !input.itemIds.length)
    missing.push(
      "未能将描述中的物品准确对应到展柜，请选择物品；本轮描述不会自动变成已确认库存。",
    );
  if (/多人|两人|三人|立体声|数量|几个/.test(goal))
    for (const p of profiles)
      if (p.quantity === "待确认") missing.push(`${p.name}：数量待现场核对`);
  const focus = /整理|收纳|桌面/.test(goal)
    ? "利用已有收纳与整理能力，改善眼前的一小块空间"
    : /摄影|光影|拍照/.test(goal)
      ? "围绕观察与记录，比较现有物品的组合可能"
      : "用已有物品做一个低风险、可尝试的小项目";
  const understood = `${followup ? `延续上一轮，调整为“${input.goal}”` : focus} · ${minutes}分钟${/不买|不购买|零预算/.test(goal) ? " · 不新增购买" : ""} · 从${items.length}件可用候选中规划${excluded.size ? ` · 排除${excluded.size}件` : ""}`;
  let ideas: LifeIdea[] = [];
  let modelCalls = 0;
  if (
    items.length &&
    !ambiguousExclusion &&
    !missing.some((m) => m.startsWith("未能"))
  ) {
    if (input.model) {
      modelCalls = 1;
      ideas = [
        await modelIdea(
          db,
          scoped,
          actor,
          goal,
          provider,
          input.includeSynthetic,
          readCurrent,
          {
            minutes,
            itemId: excluded.has(input.itemId || "") ? undefined : input.itemId,
            itemIds: items.map((i) => i.id),
            planning: {
              page: input.page,
              previous,
              profiles,
              goalUnderstanding: understood,
              noPurchase: /不买|不购买|零预算/.test(goal),
            },
          },
        ),
      ];
      if (followup && previous.some((p) => p.id === ideas[0].id)) {
        ideas = [];
        missing.push(
          "本轮模型返回了相同候选，原收藏与反馈已保留。请再指定想改变的条件，不冒充全新方案。",
        );
      }
    } else {
      ideas = discoverLife(db, scoped, actor, {
        ...input,
        itemId: excluded.has(input.itemId || "") ? undefined : input.itemId,
        goal,
        minutes,
      });
      // Compositional operator uses capabilities/materials, independent of seed IDs or a fixed product pair.
      const light = profiles.find((p) => p.capabilities.includes("照明")),
        subject = profiles.find(
          (p) =>
            p.id !== light?.id &&
            /玻璃|纸|木|布/.test(p.material + " " + p.category + " " + p.name),
        );
      if (
        light &&
        subject &&
        minutes >= 10 &&
        /摄影|有趣|光|观察|玩法/.test(goal) &&
        (!input.itemId ||
          excluded.has(input.itemId) ||
          [light.id, subject.id].includes(input.itemId))
      ) {
        ideas.unshift(
          storeLifeIdea(db, actor, {
            id: crypto.randomUUID(),
            title: `用${light.name}和${subject.name}做一次光影观察`,
            itemIds: [light.id, subject.id],
            minutes: 10,
            steps: [
              "确认物品稳定、光源低温且完好；不满足就放弃这次组合",
              "用常温普通照明观察物体在桌面的轮廓，改变照射方向比较差异",
              "选一个喜欢的视角记录；不使用激光、阳光聚焦或把材料覆盖灯具",
            ],
            limits: [
              "类别与材质仅为登记信息，透光/耐热/稳定性未实测",
              "普通低温光源与干燥桌面须本人确认；不可直照眼睛",
              "这是本地能力组合候选，不是官方用途或已实物验证",
            ],
            source: "local-candidate",
            evidence: [],
            tested: false,
            goal,
          }),
        );
      }
      if (/换个方向|换一种|更有趣/.test(input.goal) && previous.length)
        ideas = ideas.filter((i) => !previous.some((p) => p.id === i.id));
    }
  }
  if (!ideas.length && items.length)
    missing.push(
      "本地有限能力规划暂未找到新方案。可调整物品/限制；获准云端后可做开放式规划。不会把缺口当成已有。",
    );
  return {
    ideas: ideas.filter((i) => i.outcome !== "不感兴趣").slice(0, 6),
    understanding: understood,
    resources: profiles.map((p) => ({
      id: p.id,
      name: p.name,
      capabilities: p.capabilities,
    })),
    missing: [...missing, ...ideas.flatMap((i) => i.missing || [])],
    source: modelCalls ? "model-creative" : "local-candidate",
    modelCalls,
  };
}
