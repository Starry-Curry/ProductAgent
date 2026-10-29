import { z } from "zod";
import type { Item } from "../domain.ts";
import { itemContext } from "../context/items.ts";
import { AgentError } from "../agent/contracts.ts";
/** Evidence inventory precedes generation. Missing values never become usable properties. */
export function creativeFacts(items: Item[]) {
  return items.map((item) => {
    const card = itemContext(item);
    return {
      itemId: item.id,
      name: item.name,
      quantity: card.properties.quantity,
      unit: card.properties.unit,
      facts: [
        {
          ref: item.id + "/identity",
          text: item.name + "；类别：" + item.category,
          basis: "user_report" as const,
        },
        ...Object.entries(card.properties)
          .filter(
            ([key, v]) =>
              key !== "quantity" &&
              key !== "unit" &&
              v !== null &&
              v !== "" &&
              (!Array.isArray(v) || v.length),
          )
          .map(([key, v]) => ({
            ref: item.id + "/" + key,
            text: Array.isArray(v) ? v.join("；") : String(v),
            basis: "user_report" as const,
          })),
        ...card.officialFacts.map((f) => ({
          ref: item.id + "/" + f.id,
          text: f.text,
          basis: "official_source" as const,
        })),
      ],
      unknowns: [
        ...new Set([
          ...card.unknowns,
          ...(card.productUnderstanding?.unknowns || []),
        ]),
      ],
      limits: card.limits,
    };
  });
}
export const creativeReasoningSchema = z
  .object({
    outcome: z.string().min(4).max(240),
    roles: z
      .array(
        z
          .object({
            itemId: z.string(),
            factRefs: z.array(z.string()).min(1).max(6),
            function: z.string().min(2).max(180),
            contribution: z.string().min(2).max(180),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    checks: z
      .array(
        z
          .object({
            condition: z.string().min(2).max(180),
            method: z.string().min(2).max(180),
            ifFail: z.string().min(2).max(180),
          })
          .strict(),
      )
      .max(6),
    extraResources: z.array(z.string().max(100)).max(8),
    preferenceIds: z.array(z.string()).max(4),
  })
  .strict();
export type CreativeReasoning = z.infer<typeof creativeReasoningSchema>;
/** Known representational variations only. Unknown references remain errors. */
export function normalizeCreativePacket(
  raw: any,
  items: Item[],
  preferenceIds: string[],
) {
  if (!raw || typeof raw !== "object") return raw;
  const value = structuredClone(raw);
  if (
    value.requirements &&
    !Array.isArray(value.requirements) &&
    typeof value.requirements === "object"
  )
    value.requirements = Object.entries(value.requirements).map(
      ([itemId, quantity]) => ({ itemId, quantity }),
    );
  // Some providers put an already-anchored user property in the official citation field.
  // Move only references retained by a role; never discard an unknown citation.
  const roleRefs = new Set(
    value.reasoning?.roles?.flatMap((r: any) =>
      Array.isArray(r.factRefs) ? r.factRefs : [],
    ) || [],
  );
  const facts = creativeFacts(items).flatMap((c) => c.facts);
  if (Array.isArray(value.factIds))
    value.factIds = value.factIds.flatMap((id: string) => {
      const f = facts.find((f) => f.ref === id);
      if (!f || !roleRefs.has(id)) return [id];
      return f.basis === "user_report" ? [] : [id.slice(id.indexOf("/") + 1)];
    });
  if (
    Array.isArray(value.experienceIds) &&
    value.reasoning &&
    Array.isArray(value.reasoning.preferenceIds)
  ) {
    const moved = value.experienceIds.filter((id: string) =>
      preferenceIds.includes(id),
    );
    value.reasoning.preferenceIds = [
      ...new Set([...value.reasoning.preferenceIds, ...moved]),
    ];
    value.experienceIds = value.experienceIds.filter(
      (id: string) => !moved.includes(id),
    );
  }
  return value;
}
export const creativeOutputContract = {
  title: "具体标题",
  direction: "创作",
  itemIds: ["已提供的物品ID"],
  minutes: 10,
  steps: ["具体动作"],
  limits: ["实际限制"],
  rationale: "关键机制与依据，不是实物验证",
  missing: [],
  factIds: [],
  requirements: [{ itemId: "已提供的物品ID", quantity: 1 }],
  experienceIds: [],
  creativeEvidenceIds: [],
  reasoning: {
    outcome: "具体成果",
    roles: [
      {
        itemId: "已提供的物品ID",
        factRefs: ["该物品的已提供引用"],
        function: "可发挥的作用假设",
        contribution: "怎样帮助成果",
      },
    ],
    checks: [
      {
        condition: "未知前提",
        method: "怎么核对",
        ifFail: "失败后的可行替代或停止",
      },
    ],
    extraResources: [],
    preferenceIds: [],
  },
};
/** Verifies provenance/coverage/resources, not the semantic truth of a new physical mechanism. */
export function checkCreativeReasoning(
  value: CreativeReasoning,
  items: Item[],
  itemIds: string[],
  preferenceIds: string[],
  strict: boolean,
) {
  const cards = creativeFacts(items);
  const roles = new Set<string>();
  for (const role of value.roles) {
    const card = cards.find((c) => c.itemId === role.itemId);
    if (
      !itemIds.includes(role.itemId) ||
      roles.has(role.itemId) ||
      !card ||
      role.factRefs.some((ref) => !card.facts.some((f) => f.ref === ref))
    )
      throw new AgentError("方案用途推导引用了未知、越权或错误物品的性质");
    roles.add(role.itemId);
  }
  if (itemIds.some((id) => !roles.has(id)))
    throw new AgentError("方案没有说明每件物品的实际作用");
  if (value.preferenceIds.some((id) => !preferenceIds.includes(id)))
    throw new AgentError("方案引用了未授权的个人认识");
  if (strict && value.extraResources.length)
    throw new AgentError("方案需要清单外资源，不能当作只用已有物品的方案");
  return value;
}
export const CREATIVE_REASONING_PROMPT = `
本轮使用性质→作用→目标效果→候选→条件→反馈的开放创意流程，不使用固定recipe。creativeFacts是可引用性质目录。先抽象每件物品可发挥的作用，再找互补或反常规的映射；不要仅把物品换名字或让用户观察物品。至少给用户一个有用途的具体成果/可玩的规则，步骤应直接产出该成果。严禁依赖未登记材料、物品能放进另一个容器、盒盖可折、图片能站稳等未经证实的条件。未知条件必须写具体检查和失败替代，不能仅说注意安全。允许思想创作，但用户只观察三秒并非完成一个新用途。参考的已知事实不能证明整个推导成立；所有function和contribution都是待实践的用途假设。偏好可帮助选择目标/形式，不能覆盖当前限制或推断性格。
每个候选额外输出reasoning:{outcome:用户最后得到什么,roles:[{itemId,factRefs:仅该物品的creativeFacts.facts.ref,function:性质可发挥的作用,contribution:对当前成果的具体贡献}],checks:[{condition:未知前提,method:具体核对方法,ifFail:不成立时的可用替代或停止条件}],extraResources:清单外必需资源数组,preferenceIds:实际采用的authorizedPreferences.id数组}。只用已登记物品时extraResources必须为空，每个itemId必须有且仅有一个role；不能把人体/已明确的场地当成额外商品。不要为了过检查隐藏资源，步骤与声明必须一致。factRefs只表明来源可追溯，不能把用户报告或新用途推断升级为实测。`;
