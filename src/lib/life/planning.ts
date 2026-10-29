import {
  readKnowledge,
  documentCapabilities,
  type AcquiredDocument,
} from "./acquisition.ts";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canRead, type State, type Person } from "../domain.ts";
import { AgentError } from "../agent/contracts.ts";
import { ProviderError, type Provider } from "../ai/provider.ts";
import { boundPack } from "../ai/harness.ts";
import {
  goalDuration,
  mentionsItem,
  noPurchase,
  inventoryReference,
  positiveGoalText,
} from "./planning-constraints.ts";
import { itemContext } from "../context/items.ts";
import { capabilityPlans } from "./capability-plans.ts";
import {
  listCreativeEvidence,
  findCreativeEvidence,
  importCreativeEvidence,
} from "./creative-evidence.ts";
import { usable, syntheticItem } from "./availability.ts";
import {
  discoverLife,
  modelIdea,
  storeLifeIdea,
  listLifeIdeas,
  type LifeIdea,
} from "./ideas.ts";

export const discoveryInput = z
  .object({
    goal: z.string().trim().min(1).max(500),
    continuation: z
      .object({
        goal: z.string().max(1000),
        minutes: z.number().int().min(1).max(240),
        itemIds: z.array(z.string()).max(30),
        excludedItemIds: z.array(z.string()).max(100),
        restrictions: z
          .array(z.enum(["不买东西", "在家", "静音", "不要拍照", "不要手工"]))
          .max(5),
      })
      .strict()
      .optional(),
    itemId: z.string().optional(),
    itemIds: z.array(z.string()).max(30).default([]),
    excludedItemIds: z.array(z.string()).max(100).default([]),
    previousIdeaIds: z.array(z.string().uuid()).max(6).default([]),
    experienceIds: z.array(z.string().uuid()).max(6).default([]),
    creativeEvidenceIds: z.array(z.string().uuid()).max(6).default([]),
    publicEvidence: z.boolean().default(true),
    candidates: z.number().int().min(1).max(3).default(3),
    review: z.boolean().default(false),
    minutes: z.number().int().min(1).max(240).optional(),
    includeSynthetic: z.boolean().default(false),
    model: z.boolean().default(false),
    page: z.enum(["discover", "assistant", "item"]).default("discover"),
  })
  .strict();
const declaresItems = (question: string) => {
  // Referring to one's inventory is not a new list of unregistered item names.
  const q = question
    .replace(inventoryReference, " ")
    .replace(
      /(?:只用|只有|利用|用)(?:我(?:的)?|家里|当前)?展柜(?:的)?(?:物品|东西|资源)?/g,
      " ",
    )
    .replace(/只有这些|只用这些/g, " ");
  return /只用|(?:我有|只有)(?![一二两三四五六七八九十\d半]+(?:个)?(?:小时|分钟|时间|天))/.test(
    q,
  );
};

export function itemAffordances(
  item: State["items"][number],
  documents: AcquiredDocument[] = [],
) {
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
    ["收纳", /容器|盒|杯|收纳|架|storage/],
    ["携带", /背包|旅行包|便携|portable|carrying/],
    ["书写", /笔|书写|writing/],
    ["观察记录", /相机|摄影|纸|笔|camera/],
    ["声音", /音箱|音频|audio/],
    ["衣物搭配", /衣|服装|围巾|布料/],
    ["养护观察", /植物|绿植/],
  ] as const)
    if (pattern.test(declared)) capabilities.push(label);
  return {
    context: itemContext(item),
    id: item.id,
    name: item.name,
    category: item.category,
    material: item.attributes?.material || "未知",
    quantity: item.attributes?.quantity ?? "待确认",
    quantityUnit: item.attributes?.quantityUnit || "未登记单位",
    capabilities,
    acquiredCapabilities: documentCapabilities(documents),
    declaredCapabilities: item.attributes?.capabilities || [],
    inferredCapabilities: capabilities,
    lifecycle: item.lifecycle,
    state: item.state,
    availability: item.availability,
    capabilityBasis: "登记能力与类别推断分列；类别推断不是实物检测或型号事实",
    officialFacts: pack?.claims || [],
    officialSource: pack?.source,
    limits: pack?.limits || [],
    constraints: pack?.constraints,
  };
}

/** Resolve history on the server, then narrow the real resource set before any model call. */
export type DiscoveryResult = {
  ideas: LifeIdea[];
  continuation: NonNullable<z.infer<typeof discoveryInput>["continuation"]>;
  understanding: string;
  resources: { id: string; name: string; capabilities: string[] }[];
  missing: string[];
  source: "model-creative" | "local-candidate";
  modelCalls: number;
  tokens?: { input: number; output: number } | null;
  failure?: { kind: "candidate_invalid"; retryable: boolean; message: string };
  cloudRejected?: boolean;
};
export async function planDiscovery(
  db: DatabaseSync,
  state: State,
  actor: Person,
  raw: unknown,
  provider: Provider,
  readCurrent: () => State,
): Promise<DiscoveryResult> {
  const input = discoveryInput.parse(raw),
    visible = state.items.filter((i) => canRead(i, actor));
  for (const id of [
    ...input.itemIds,
    ...input.excludedItemIds,
    ...(input.continuation?.itemIds || []),
    ...(input.continuation?.excludedItemIds || []),
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
      minutes: idea.minutes,
      outcome: row.outcome || "未尝试",
      creativeEvidenceSources: idea.creativeEvidenceSources,
    };
  });
  const lastGoal = input.continuation?.goal || previous.at(-1)?.goal;
  const followup =
    (previous.length > 0 || !!input.continuation) &&
    /^(?:能不能|可以|再)?(?:继续|更|换|不要|不用|只有|只用|缩短|简单|时间|我只有)/.test(
      input.goal,
    );
  const goal = followup
    ? `${lastGoal?.slice(0, 350)}；${(input.continuation?.restrictions || []).join("；")}；本轮调整：${input.goal}`
    : input.goal;
  const excluded = new Set([
    ...input.excludedItemIds,
    ...(followup ? input.continuation?.excludedItemIds || [] : []),
  ]);
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
  const named = visible.filter((i) => mentionsItem(input.goal, i.name));
  const exclusionPhrases = [
    ...input.goal.matchAll(
      /(?:不要使用|不使用|不要用|不用|排除)([^，。；！!?？]{1,80})/g,
    ),
  ].map((m) => m[1]);
  for (const i of visible)
    if (exclusionPhrases.some((q) => mentionsItem(q, i.name)))
      excluded.add(i.id);
  // Exclusions from prior turns survive later revisions in both discovery and the main assistant.
  for (const phrase of goal.matchAll(
    /(?:不要使用|不使用|不要用|不用|排除)([^，。；！!?？]{1,80})/g,
  ))
    for (const i of visible)
      if (mentionsItem(phrase[1], i.name)) excluded.add(i.id);
  let selected = input.itemIds.length
    ? input.itemIds
    : followup
      ? input.continuation?.itemIds || []
      : [];
  if (!selected.length && /只有这些|只用这些/.test(input.goal))
    selected = [...new Set(previous.flatMap((p) => p.itemIds))];
  if (!selected.length && declaresItems(input.goal) && named.length)
    selected = named.map((i) => i.id);
  const onlyPhrase = input.goal.match(/(?:只用|只使用)([^，。；]{1,80})/)?.[1];
  const onlyNamed = onlyPhrase
    ? visible.filter((i) => mentionsItem(onlyPhrase, i.name)).map((i) => i.id)
    : [];
  if (onlyNamed.length)
    selected = selected.length
      ? selected.filter((id) => onlyNamed.includes(id))
      : onlyNamed;
  if (!selected.length && followup && declaresItems(lastGoal || ""))
    selected = [...new Set(previous.flatMap((p) => p.itemIds))];
  const minutes =
    /缩短一半|一半时间|时间减半/.test(input.goal) && previous.length
      ? Math.max(
          1,
          Math.floor(
            (input.continuation?.minutes ||
              Math.max(...previous.map((p) => p.minutes))) / 2,
          ),
        )
      : goalDuration(input.goal) ||
        input.minutes ||
        (followup ? input.continuation?.minutes : undefined) ||
        goalDuration(goal) ||
        30;
  const items = visible.filter(
    (i) =>
      !i.demo &&
      usable(i) &&
      (!syntheticItem(i) || input.includeSynthetic) &&
      !excluded.has(i.id) &&
      (!onlyNamed.length || onlyNamed.includes(i.id)) &&
      (!selected.length || selected.includes(i.id)),
  );
  const referenceGaps: string[] = [];
  const experiences = input.experienceIds.flatMap((id) => {
    const row = db
      .prepare("SELECT body FROM life_ideas WHERE id=? AND owner=?")
      .get(id, actor) as { body: string } | undefined;
    if (!row) throw new AgentError("参考经验未获授权", 403);
    const idea = JSON.parse(row.body) as LifeIdea;
    if (idea.source !== "user-submitted")
      throw new AgentError("参考条目不是本人提供的经验", 403);
    if (!idea.itemIds.every((id) => items.some((i) => i.id === id))) {
      referenceGaps.push(
        "已跳过一份参考经验：其物品不符合本轮选择或已不可用，可改用其他条件。",
      );
      return [];
    }
    return [
      {
        id: idea.id,
        title: idea.title,
        steps: idea.steps,
        limits: idea.limits,
        sourceUrl: idea.sourceUrl,
      },
    ];
  });
  const scoped = { ...state, items },
    profiles = items.map((i) =>
      itemAffordances(i, readKnowledge(db, state, actor, i.id)),
    );
  const missing: string[] = [...referenceGaps];
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
  const positiveGoal = positiveGoalText(goal);
  const focus = /整理|收纳|桌面/.test(positiveGoal)
    ? "利用已有收纳与整理能力，改善眼前的一小块空间"
    : /摄影|光影|拍照/.test(positiveGoal)
      ? "围绕观察与记录，比较现有物品的组合可能"
      : "用已有物品做一个低风险、可尝试的小项目";
  const understood = `${followup ? `延续上一轮，调整为“${input.goal}”` : focus} · ${minutes}分钟${noPurchase(goal) ? " · 不新增购买" : ""} · 从${items.length}件可用候选中规划${excluded.size ? ` · 排除${excluded.size}件` : ""}`;
  let ideas: LifeIdea[] = [];
  let modelCalls = 0;
  let tokens: { input: number; output: number } | null = null;
  const selectedEvidence = input.creativeEvidenceIds.map((id) => {
    const e = listCreativeEvidence(db, actor).find((e) => e.id === id);
    if (!e) throw new AgentError("创意经验不属于当前用户", 403);
    return e;
  });
  if (
    input.publicEvidence &&
    process.env.WUJIAN_ALLOW_PUBLIC_FETCH === "true" &&
    /整理.*照片|照片.*整理|老照片/.test(goal)
  ) {
    let read = false;
    for (const url of [
      "https://www.loc.gov/preservation/care/photo.html",
      "https://www.archives.gov/preservation/holdings-maintenance/photographs",
    ])
      try {
        const cached = listCreativeEvidence(db, actor).find(
          (e) =>
            e.url === url &&
            Date.now() - Date.parse(e.fetchedAt) < 7 * 86400000,
        );
        const e = cached || (await importCreativeEvidence(db, actor, { url }));
        if (!selectedEvidence.some((x) => x.id === e.id))
          selectedEvidence.push(e);
        read = true;
        break;
      } catch {
        // Bounded alternative public institution; no bypass or generated URL.
      }
    if (!read) missing.push("公开照片保护参考未能实际读取，不用摘要代替");
  }
  for (const old of previous.flatMap((p) => p.creativeEvidenceSources || [])) {
    const current = listCreativeEvidence(db, actor).find(
      (e) => e.id === old.id,
    );
    if (current && !selectedEvidence.some((e) => e.id === current.id))
      selectedEvidence.push(current);
  }
  if (
    items.length &&
    !ambiguousExclusion &&
    !missing.some((m) => m.startsWith("未能"))
  ) {
    if (input.model) {
      if (
        input.publicEvidence &&
        process.env.WUJIAN_ALLOW_PUBLIC_FETCH === "true"
      ) {
        const found = await findCreativeEvidence(
          db,
          actor,
          goal,
          items,
          provider,
        );
        selectedEvidence.push(...found.evidence);
        missing.push(...found.issues);
      }
      const countedProvider: Provider = {
        ...provider,
        generate: async (...args) => {
          modelCalls++;
          const result = await provider.generate(...args);
          if (result.tokens)
            tokens = {
              input: (tokens?.input || 0) + result.tokens.input,
              output: (tokens?.output || 0) + result.tokens.output,
            };
          return result;
        },
      };
      let generated;
      try {
        generated = await modelIdea(
          db,
          scoped,
          actor,
          goal,
          countedProvider,
          input.includeSynthetic,
          readCurrent,
          {
            minutes,
            candidates: input.candidates,
            review: input.review,
            creativeEvidence: selectedEvidence,
            experiences,
            itemId: excluded.has(input.itemId || "") ? undefined : input.itemId,
            itemIds: items.map((i) => i.id),
            planning: {
              page: input.page,
              previous,
              recentFeedback: listLifeIdeas(db, state, actor)
                .filter(
                  (i) =>
                    i.outcome &&
                    i.outcome !== "未尝试" &&
                    i.itemIds.every((id) => items.some((x) => x.id === id)),
                )
                .slice(0, 12)
                .map((i) => ({
                  title: i.title,
                  itemIds: i.itemIds,
                  outcome: i.outcome,
                  saved: !!i.saved,
                })),
              profiles,
              goalUnderstanding: understood,
              noPurchase: noPurchase(goal),
            },
          },
        );
      } catch (error) {
        // Configuration, authorization and transport failures must retain their accurate UI state.
        if (!(error instanceof AgentError) && !(error instanceof ProviderError))
          throw error;
        if (error instanceof ProviderError && error.code !== "invalid_response")
          throw error;
        if (
          error instanceof AgentError &&
          /超出实际登记数量|用量单位|数量条件|引用了|权限|授权/.test(
            error.message,
          )
        )
          throw error;
        if (
          error instanceof AgentError &&
          (error.status !== 400 ||
            !/方案|创意候选|模型创意未通过资源或风险检查|未登记|成像|[不未]成立|留印|计量/.test(
              error.message,
            ))
        )
          throw error;
        const fallback = await planDiscovery(
          db,
          readCurrent?.() || state,
          actor,
          { ...input, model: false, review: false, publicEvidence: false },
          provider,
          readCurrent,
        );
        return {
          ...fallback,
          modelCalls,
          tokens,
          cloudRejected: true,
          failure: {
            kind: "candidate_invalid",
            retryable: true,
            message:
              "模型候选未通过条件检查；未发布草稿。可调整限制或选择下面明确标注的本地方案。",
          },
          missing: [
            ...fallback.missing,
            "云端方案未通过可执行性/资料检查，下面仅为本地有限能力组合，未冒充AI成功。",
          ],
        };
      }
      ideas = generated.alternatives || [generated];
      missing.push(...(generated.validationNotes || []));
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
        avoidIdeaIds: /换个方向|换一种|更有趣/.test(input.goal)
          ? previous.map((p) => p.id)
          : [],
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
        /摄影|光影|观察/.test(goal) &&
        !/不要.{0,4}观察|不做科学|不要实验/.test(goal) &&
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
      const anchor = excluded.has(input.itemId || "")
        ? undefined
        : input.itemId;
      ideas = [
        ...capabilityPlans(db, actor, items, goal, minutes, anchor),
        ...ideas,
      ];
      // Controlled experience adaptation. The source supplies the theme, not a verified physical mechanism.
      const shadowSource = selectedEvidence.find((e) =>
        /shadow|影子/i.test(e.excerpt),
      );
      const shadowLight = profiles.find((p) => p.capabilities.includes("照明"));
      const note = profiles.find(
        (p) => p.capabilities.includes("书写") || /纸笔/.test(p.name),
      );
      if (
        shadowSource &&
        shadowLight &&
        /影子|手影|shadow/i.test(goal) &&
        minutes >= 5 &&
        (!anchor || [shadowLight.id, note?.id].includes(anchor))
      )
        ideas.unshift(
          storeLifeIdea(db, actor, {
            id: crypto.randomUUID(),
            title: "把公开影子游戏改成一段手影小剧场",
            itemIds: [shadowLight.id, ...(note ? [note.id] : [])],
            minutes: Math.min(10, minutes),
            steps: [
              "先确认有平整墙面或可投影的空白背景，光源稳定且不发热；不满足时改成口述猜词，不购买道具",
              `将${shadowLight.name}放在稳固位置照向背景，用舒适的手势尝试一个可见影子；看不清就调整位置或放弃，不承诺特定成像`,
              `${note ? `可用${note.name}写` : "口述"}三个词，为手影编一句虚构台词；单人也可玩，有人愿意参与再轮流猜词`,
              "选一个最喜欢的片段继续编结尾；记录是否看得清、是否有趣，不把创作当成真实生活经历自动保存",
            ],
            missing: [
              "空白背景、稳定低温光源与舒适手势需现场确认；同伴不是前置条件",
            ],
            limits: [
              "不直照眼睛、不用激光、不覆盖灯头；玻璃杯及未登记纸箱/胶带/剪刀均不需要",
              "仅借第三方影子主题作为灵感，以下规则为本地改编；没有实物验证，不保证影像清晰或猜词效果",
            ],
            rationale:
              "在实际已有照明/记录能力上改编游戏规则，剔除来源未核对的几何参数、材料与设备效果。",
            source: "local-candidate",
            evidence: [],
            creativeEvidenceSources: [shadowSource],
            direction: "娱乐",
            tested: false,
            goal,
          }),
        );
      const photoReference = selectedEvidence.find(
        (e) =>
          [
            "https://www.loc.gov/preservation/care/photo.html",
            "https://www.archives.gov/preservation/holdings-maintenance/photographs",
          ].includes(e.url || "") &&
          /avoid touching the image area/i.test(e.excerpt),
      );
      const printedPhoto = items.find((i) =>
        /纸质照片|老照片|相片/.test(i.name),
      );
      if (photoReference && printedPhoto && minutes >= 5 && /照片/.test(goal))
        ideas.unshift(
          storeLifeIdea(db, actor, {
            id: crypto.randomUUID(),
            title: "给旧照片做一份不伤原件的主题索引",
            itemIds: [printedPhoto.id],
            minutes: 5,
            steps: [
              "先核对是否为普通纸质照片；玻璃底片、粘连或破损材料不要自行处理",
              "保持照片原有保护材料，仅从边缘拿取，避免触碰影像表面；不拆除粘贴或清洗",
              "在不标记原件的前提下口述分组与主题索引；缺少合适保护材料时只做索引，不换包装",
            ],
            missing: [
              "照片实际材质/状态与原保护材料需本人核对；本方案不证明容器具有档案级保护能力",
              "清洁手部及适合的保护手套等拿取条件需按来源核对；条件不足时只口述索引、不接触原件。",
            ],
            limits: [
              "参考机构原文仅支持避免接触影像面和边缘拿取；主题索引是本地改编，未实物验证",
              "不对原件写字、粘贴、加热或清洗；专业保存条件请查看完整来源",
            ],
            rationale:
              "把真实公开保护建议变成不改动原件的整理任务，不凭收纳盒类别推断保护性能。",
            source: "local-candidate",
            evidence: [],
            creativeEvidenceSources: [photoReference],
            direction: "生活改善",
            tested: false,
            goal,
          }),
        );
      // Reuse only explicit user-provided experiences whose real resources still meet this request.
      const submitted = listLifeIdeas(db, state, actor).filter(
        (i) =>
          i.source === "user-submitted" &&
          i.minutes <= minutes &&
          i.itemIds.every((id) => items.some((x) => x.id === id)) &&
          (!anchor || i.itemIds.includes(anchor)) &&
          (input.experienceIds.includes(i.id) ||
            input.goal.includes(i.title) ||
            /经验|参考|已有方案/.test(input.goal)),
      );
      ideas = [...submitted, ...ideas];
      if (/换个方向|换一种|更有趣/.test(input.goal) && previous.length)
        ideas = ideas.filter((i) => !previous.some((p) => p.id === i.id));
    }
  }
  if (!ideas.length && items.length)
    missing.push(
      "本地有限能力规划暂未找到新方案。可调整物品/限制；获准云端后可做开放式规划。不会把缺口当成已有。",
    );
  ideas = [...new Map(ideas.map((i) => [i.id, i])).values()]
    .filter(
      (i) =>
        i.outcome !== "不感兴趣" &&
        (i.outcome !== "未成功" || /重试|再试|修复/.test(goal)),
    )
    .sort(
      (a, b) =>
        Number(a.outcome === "未成功") - Number(b.outcome === "未成功") ||
        Number(!!b.saved || b.outcome === "用户报告有效") -
          Number(!!a.saved || a.outcome === "用户报告有效"),
    )
    .slice(0, 6);
  return {
    ideas,
    continuation: {
      goal: goal.slice(0, 1000),
      minutes,
      itemIds: selected,
      excludedItemIds: [...excluded],
      restrictions: [
        ...(noPurchase(goal) ? ["不买东西" as const] : []),
        ...(/室内|不出门|在家/.test(goal) ? ["在家" as const] : []),
        ...(/静音|不要声音|不要音乐|不放音乐/.test(goal)
          ? ["静音" as const]
          : []),
        ...(/不(?:要|想|用).{0,3}(拍照|摄影)/.test(goal)
          ? ["不要拍照" as const]
          : []),
        ...(/不要手工|不做手工/.test(goal) ? ["不要手工" as const] : []),
      ],
    },
    understanding: understood,
    resources: profiles.map((p) => ({
      id: p.id,
      name: p.name,
      capabilities: p.capabilities,
    })),
    missing: [
      ...new Set([...missing, ...ideas.flatMap((i) => i.missing || [])]),
    ],
    source: modelCalls ? "model-creative" : "local-candidate",
    modelCalls,
    tokens,
  };
}
