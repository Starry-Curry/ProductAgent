import { executeHomeTask } from "./home-task.ts";
import { answerKnownItem } from "./grounded-answer.ts";
import { analyzeOwnedLamp } from "../devices/software-lab.ts";
import { hazardousActions } from "./safety-language.ts";
import { publicDemo } from "../cloud/runtime.ts";
import {
  itemContext,
  itemContextPage,
  readItemContext,
  type ItemContext,
} from "../context/items.ts";
import { itemAdviceIssues } from "../context/item-advice.ts";
import { turnBudget } from "./budget.ts";
import { visionStatus } from "../life/vision.ts";
import {
  acquireKnowledge,
  retrieveKnowledge,
  operationQuestion,
} from "../life/acquisition.ts";
import { groundedReply, offlineDocumentHelp } from "../skills/document-help.ts";
import { planDiscovery } from "../life/planning.ts";
import {
  withoutProhibitedActions,
  withoutFileSelectionGestures,
} from "./safety-language.ts";
import {
  Annotation,
  StateGraph,
  START,
  Command,
  interrupt,
  MemorySaver,
} from "@langchain/langgraph";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { canRead, ideas, type State, type Person } from "../domain.ts";
import {
  ProviderError,
  type Provider,
  type ModelMessage,
  type ModelResponse,
} from "../ai/provider.ts";
import { SqliteCheckpointer } from "./checkpointer.ts";
import {
  AgentError,
  type AssistantReply,
  type ServiceSession,
  type Trace,
} from "./contracts.ts";
import { buildContext } from "../context/builder.ts";
import {
  windowsMouse,
  mouseSetup,
  procedureReply,
  relevantKnowledge,
  topics,
} from "../skills/knowledge.ts";
import { skills } from "../skills/registry.ts";
import {
  planMemoryStory,
  localMemoryStory,
  canComposeInCloud,
  storytellingMessages,
  validateStorytelling,
  STORYTELLING_VERSION,
  type StoryPlan,
} from "../skills/memory-storytelling.ts";
import {
  SYSTEM_PROMPT,
  PROMPT_VERSION,
  tools,
  ITEM_CONTEXT_INSTRUCTIONS,
} from "./prompts.ts";
import { isStoryNarration } from "../memory/ambient.ts";
import { epoch } from "../memory/store.ts";
import { sessionAccess } from "../repositories/sessions.ts";
import { routeHome, isStepFollowup } from "../home/router.ts";
import { homeDecision } from "../home/decisions.ts";
import { itemStamp } from "../home/store.ts";
import type { HomeRoute } from "../home/contracts.ts";
import { sourceReply } from "../life/sources.ts";
import { recallLifeFragments } from "../life/recall.ts";
const packetSchema = z
  .object({
    kind: z.enum([
      "supported",
      "general",
      "creative",
      "needs_info",
      "referred",
    ]),
    answer: z.string().max(4000),
    factIds: z.array(z.string().max(100)).max(10).default([]),
    procedureId: z.string().max(100).nullable().default(null),
    questions: z.array(z.string().max(250)).max(2).default([]),
    itemIds: z.array(z.string().max(100)).max(8).optional(),
  })
  .strict();
const unsafe =
  /短接|拆开.{0,8}电池|加热.{0,8}电池|电池.{0,8}加热|带电.{0,8}拆|湿.{0,8}充电|冒烟|漏电|烧焦/;

const deviceClaims =
  /蓝牙\s*\d|IP\d{2}|承重.{0,5}\d|\d.{0,3}(千克|公斤|瓦|伏)|按住.{0,8}\d.{0,3}秒|已经(修复|检测|确认正常)|我亲眼|我记得我们|按住|长按|短按|拆卸|拆机|短接|可直接充电|可以直接充电|兼容任意|支持任意|[一二两三四五六七八九十0-9]+.{0,3}节.{0,8}电池|[一二两三四五六七八九十0-9]+.{0,3}AAA?/;
const blank = (
  answer: string,
  outcome: AssistantReply["outcome"] = "answered",
  source: AssistantReply["source"] = "curated-guidance",
): AssistantReply => ({
  outcome,
  answer,
  source,
  steps: [],
  questions: [],
  evidenceIds: [],
  citations: [],
  memoryIds: [],
});
export function curatedDecision(
  question: string,
  session: ServiceSession,
  ctx: ReturnType<typeof buildContext>,
  unified = false,
  composeFacts = false,
): AssistantReply | undefined {
  if (unsafe.test(withoutProhibitedActions(question)))
    return {
      ...blank(
        "先停止这项操作。如果设备冒烟、漏电、发热异常或电池受损，请停止使用并联系专业售后；我可以帮你整理现象与型号。",
        "blocked",
      ),
      caveat: "没有判断设备已恢复正常。",
    };
  if (session.mode === "story") {
    if (!session.itemId)
      return blank(
        "先打开一件物品的‘故事与记录’，再围绕它聊聊。",
        "needs_info",
      );
    if (isStoryNarration(question) && unified) return;
    if (isStoryNarration(question))
      return blank(
        ctx.temporary
          ? "这次只在当前页面聊聊，不保存故事或记忆。"
          : "这段关于“" +
              ctx.item?.name +
              "”的经历已留在它的私人故事中。你可以接着讲下去，新片段会与这件物品关联。",
        "answered",
        "local-memory",
      );
    const story = planMemoryStory(ctx, session);
    if (story) return localMemoryStory(story);
    return blank(
      "这里是你与“" +
        ctx.item?.name +
        "”讲述故事的窗口。你可以像平时一样说一段经历；叙述会留在这件物品的私人故事中。已开启自动整理时，相关线索会作为后续理解你的依据。",
      "answered",
      "local-memory",
    );
  }
  const pending = session.known.pending;
  if (/mac|苹果电脑|linux|win(dows)?\s*10/i.test(question))
    delete session.known.os;
  if (pending === "os" && /windows\s*11|win\s*11|^11$|窗口11/i.test(question))
    session.known.os = "windows11";
  if (
    pending === "receiver" &&
    !/没有|没带|不是|丢了|找不到|坏了|非原配/.test(question) &&
    /原配|原装|^(有|是|有的|是的)[。！!]?$/u.test(question)
  )
    session.known.originalReceiver = "yes";
  if (
    session.known.originalReceiver === "yes" &&
    /接收器/.test(question) &&
    !/没插|没有插|没接|没有接|还没|尚未|未插|未接/.test(question) &&
    /(?:已|已经|刚|早就).{0,15}(?:插|接)|(?:插|接).{0,8}(?:好|上|进)/.test(
      question,
    ) &&
    !session.tried.includes("m185-receiver")
  )
    session.tried.push("m185-receiver");
  const followup =
    (!!pending && question.length < 35) ||
    /^(还是|仍然|没变化|依然|试过|我试过|第二步|第一步|第三步|我已经|已经)/.test(
      question,
    );
  const goal = followup ? session.known.goal || question : question;
  session.known.goal = goal;
  if (/双击|double.?click/i.test(goal)) {
    if (/windows\s*11|win\s*11/i.test(question + " " + goal))
      session.known.os = "windows11";
    if (session.known.os !== "windows11") {
      session.known.pending = "os";
      return {
        ...blank(
          "双击速度通常是电脑系统设置，不需要先确认鼠标硬件型号。你使用的是 Windows 11，还是其他系统？",
          "needs_info",
        ),
        questions: ["你使用的操作系统是什么？"],
      };
    }
    delete session.known.pending;
    if (session.known.lastOutcome === "unresolved") {
      delete session.known.lastOutcome;
      session.known.pending = "observation";
      return {
        ...blank(
          "已记下还没解决。先确认实际卡住的位置，再决定下一步。" +
            (session.known.unresolvedReason
              ? "你补充的是：“" + session.known.unresolvedReason + "”"
              : ""),
          "needs_info",
        ),
        questions: ["是找不到设置入口，还是调整后效果仍不合适？"],
      };
    }
    return {
      ...blank(""),
      ...procedureReply(windowsMouse, session.tried),
      outcome: windowsMouse.steps.every((s) => session.tried.includes(s.id))
        ? "needs_info"
        : "answered",
    };
  }
  if (ctx.persona.enabled && session.mode === "companion") {
    const story = planMemoryStory(ctx, session);
    if (story) return localMemoryStory(story);
  }
  if (session.mode === "companion" && !ctx.persona.enabled && !unified)
    return {
      ...blank(
        "你可以先在“关于我与记住的事”里开启你喜欢的交流方式，也可以继续使用普通帮助。",
        "needs_info",
      ),
      questions: ["想使用普通帮助，还是开启可选陪伴？"],
    };
  if (session.mode === "ideas") {
    if (unified) return;
    const available = ideas.filter((idea) =>
      idea.items.every((id) => ctx.resources.some((i) => i.id === id)),
    );
    const handmade = ctx.memories.some(
      (m) =>
        m.kind === "interest" &&
        m.polarity !== "negative" &&
        /手工|拼豆|制作/.test(m.text),
    );
    const preferOther =
      /不想.*手工|不(?:再)?喜欢.*(手工|拼豆)|换个方向|想做别的/.test(question);
    available.sort(
      (a, b) =>
        Number(b.id === (handmade && !preferOther ? "art" : "light")) -
        Number(a.id === (handmade && !preferOther ? "art" : "light")),
    );
    if (available.length) {
      const idea = available[0];
      return {
        ...blank(
          `${handmade && !preferOther ? "结合你在交流中提到的手工兴趣，" : "先从你当前可用的物品出发，"}可以看看“${idea.title}”。\n${idea.description}`,
          "answered",
          "local-memory",
        ),
        steps: idea.steps.map((text, i) => ({
          id: `idea:${idea.id}:${i}`,
          text,
        })),
        memoryIds:
          handmade && !preferOther
            ? ctx.memories.filter((m) => m.kind === "interest").map((m) => m.id)
            : [],
        caveat: idea.conditions + " 这是候选，未实物验证。",
      };
    }
  }
  const pack = ctx.knowledge.pack;
  if (ctx.item && /登记.*(?:型号|品牌)|(?:型号|品牌).{0,8}是什么/.test(goal)) {
    const record = itemContext(ctx.item);
    return {
      ...blank(
        `当前登记：${record.name}；品牌：${record.brand || "未知"}；型号：${record.model || "未知"}。这是登记信息，不证明实物已核验或工作正常。`,
      ),
      caveat: "按获准物品档案直接读取，没有发送模型请求。",
    };
  }
  if (
    ctx.item &&
    /官方资料|说明书/.test(goal) &&
    /目前|当前|这只|我的/.test(goal) &&
    /工作正常|正常工作|已修复|修好/.test(goal)
  )
    return blank(
      "官方资料描述型号的设计能力，不能证明你这件实物当前工作正常或已经修复。登记状态也是用户记录；实际状态仍需用户核对或合适的检验。",
      "needs_info",
    );
  if (
    pack?.id.startsWith("logitech-m185") &&
    /首次|第一次|怎么用|如何使用|安装|接上电脑/.test(goal)
  ) {
    if (session.known.originalReceiver !== "yes") {
      session.known.pending = "receiver";
      return {
        ...blank(
          "这款鼠标的入门说明使用随附 USB 接收器。你手边有随这只鼠标附带的原配接收器吗？",
          "needs_info",
        ),
        questions: ["是否有原配 USB 接收器？"],
      };
    }
    delete session.known.pending;
    return { ...blank(""), ...procedureReply(mouseSetup, session.tried) };
  }
  const knowledge = relevantKnowledge(goal, pack);
  if (
    knowledge.facts.length &&
    !composeFacts &&
    (session.mode === "service" || topics(goal).length > 0) &&
    !/怎么|如何|故障|不行|失灵|维修|修好/.test(goal)
  ) {
    return {
      ...blank(
        knowledge.facts.map((f) => f.text).join("\n") +
          (pack?.id.startsWith("logitech-m185") && /充电/.test(question)
            ? "\n这份资料没有确认可以用充电线给鼠标充电，先不要据此尝试；请按该型号说明书核对供电方式。"
            : ""),
      ),
      evidenceIds: knowledge.facts.map((f) => f.id),
      citations: pack
        ? [
            {
              id: pack.id,
              title: pack.source.title,
              url: pack.source.url,
              section: pack.source.section,
              kind: "official",
            },
          ]
        : [],
      caveat: pack?.limits.join(" "),
    };
  }
  if (/^(你好|谢谢|在吗|嗨|早上好)[！!。]?$/u.test(question))
    return session.known.uiPage
      ? blank(
          "我在。想聊什么都可以，也可以一起解决手边的问题。",
          "answered",
          "local-dialogue",
        )
      : blank("我在。想先解决一件物品的使用问题，还是聊聊最近留下的故事？");
  if (
    !pack &&
    (!ctx.item?.model ||
      /^(待确认|未知|不详|型号看不清)$/.test(ctx.item.model)) &&
    /预约|配对|兼容|接收器|型号|复位|重置|拆|电池规格|承重|载荷/.test(goal)
  )
    return {
      ...blank(
        /不知道型号|型号看不清|不清楚型号/.test(question)
          ? "先不要尝试猜按键或重置。请查看机身标签、购买订单或保修卡，把能辨认的品牌和型号写下来，也可以提供对应说明书链接。仍无法辨认时，请联系购买平台的卖家或售后；找到型号也不保证一定能取得资料。"
          : /承重|载荷/.test(goal)
            ? "当前登记没有确认承重能力，不能据此承诺可吊挂或承载该重量。需要核对承重规格、物品当前状态和连接结构；先不要实际吊重尝试。"
            : "我可以帮你核对。先告诉我品牌和具体型号，或补充对应说明书；这样才能判断专属步骤，避免套用相似产品。",
        "needs_info",
      ),
      questions: /不知道型号|型号看不清|不清楚型号/.test(question)
        ? []
        : /承重|载荷/.test(goal)
          ? ["是否有这件物品的承重规格和连接结构资料？"]
          : ["品牌和具体型号是什么？"],
    };
  return undefined;
}
export function validateModelPacket(
  text: string,
  ctx: ReturnType<typeof buildContext>,
  mode: string,
  tried: string[] = [],
  messages: ServiceSession["messages"] = [],
): AssistantReply {
  const value = JSON.parse(text);
  // Some providers wrap Product Pack fact IDs in the document-step protocol.
  // Accept only those exact current facts, rendered by the server: discard the
  // model's paraphrased actions/parameters instead of treating facts as procedures.
  if (
    value?.kind === "grounded" &&
    Array.isArray(value.steps) &&
    value.steps.length
  ) {
    const ids = value.steps.flatMap((step: { sourceIds?: unknown }) =>
      Array.isArray(step.sourceIds) ? step.sourceIds : [],
    );
    if (
      ids.length &&
      ids.every(
        (id: unknown) =>
          typeof id === "string" &&
          ctx.knowledge.facts.some((fact) => fact.id === id),
      ) &&
      value.steps.every(
        (step: { sourceIds?: unknown }) =>
          Array.isArray(step.sourceIds) && step.sourceIds.length > 0,
      )
    ) {
      return validateModelPacket(
        JSON.stringify({
          kind: "supported",
          answer: typeof value.answer === "string" ? value.answer : "",
          factIds: [...new Set(ids)],
          procedureId: null,
          questions: [],
        }),
        ctx,
        mode,
        tried,
        messages,
      );
    }
  }
  if (value?.kind === "grounded")
    return groundedReply(
      value,
      ctx.externalKnowledge,
      { tried, messages },
      ctx.knowledgeTask,
    );
  const packet = packetSchema.parse(value);
  let supportedCitation: AssistantReply["citations"] = [];
  if (packet.itemIds?.some((id) => !ctx.itemContexts.some((i) => i.id === id)))
    throw new AgentError("回答引用了本轮未读取或未获准的物品");
  // A requested wording change for an ordinary action is general help.
  // Keep all factual and risk checks below; this does not license device fiction.
  if (
    packet.kind === "creative" &&
    mode === "service" &&
    !ctx.knowledge.facts.length &&
    /改写|润色|换.{0,4}说法|变成.{0,20}(一句|一段|建议)|不催促/.test(
      ctx.question,
    )
  )
    packet.kind = "general";
  if (packet.kind === "supported") {
    const selected = packet.factIds.map((id) =>
      ctx.knowledge.facts.find((f) => f.id === id),
    );
    if (
      new Set(packet.factIds).size !== packet.factIds.length ||
      selected.some((f) => !f)
    )
      throw new AgentError("回答引用与本次问题或型号不匹配");
    if (packet.procedureId)
      throw new AgentError("操作过程须先满足服务端前置条件");
    if (!selected.length) throw new AgentError("没有相关证据");
    const pack = ctx.knowledge.pack!;
    // IDs establish provenance only. Preserve synthesis and unknowns, then run
    // the same action/property checks as other model answers.
    packet.answer =
      packet.answer.trim() || selected.map((f) => f!.text).join("\n");
    // Numeric limits can be paraphrased, but not invented. This checks a narrow
    // error class, not the semantic truth of every cited statement.
    const numbers = (s: string) => s.match(/\d+(?:\.\d+)?/g) || [];
    const provided = new Set(
      numbers(
        JSON.stringify({
          facts: selected,
          // User-stated room dimensions are usable conditions, not manufacturer specifications.
          userConditions: ctx.knowledgeTask.question,
          items: ctx.itemContexts,
          limits: pack.limits,
        }),
      ),
    );
    if (numbers(packet.answer).some((n) => !provided.has(n)))
      throw new AgentError("回答增加了资料中未提供的数值，请保留未知");
    supportedCitation = [
      {
        id: pack.id,
        title: pack.source.title,
        url: pack.source.url,
        kind: "official",
        section: pack.source.section,
      },
    ];
  }
  const actionable = packet.answer.replace(
    /(?:不要|不能|禁止|切勿|请勿|避免|不建议)[^，,。；！？\n]{0,120}/g,
    "",
  );
  const questionsUnsafe = packet.questions.some(
    (q) =>
      /(请|尝试|试着|直接|先把|先将)/.test(q) &&
      (hazardousActions.test(q) ||
        deviceClaims.test(withoutFileSelectionGestures(q))),
  );
  const claimedHistory = actionable.replace(
    /(?:没有|无法|不能|不清楚|不知道|不记得|未保存)[^。！？\n]*/g,
    "",
  );
  if (
    !ctx.cloudMemories.length &&
    !ctx.cloudFragments.length &&
    /我们.{0,8}(?:上次|一起去)|(?:上次|以前|曾经|那次).{0,8}(?:一起|我们去|咱们去)/.test(
      claimedHistory,
    )
  )
    throw new AgentError("没有获准经历，不能预设共同出行或经历");
  if (
    /下次开机.{0,12}(?:看见|提醒)|我会自动.{0,8}(?:记住|保存|通知)/.test(
      actionable,
    )
  )
    throw new AgentError("没有相应行动授权，不能承诺自动记忆或设备行为");
  if (
    hazardousActions.test(withoutProhibitedActions(actionable)) ||
    (packet.kind === "supported"
      ? /按住|长按|短按|拆卸|拆机|短接|已经(?:修复|检测|确认正常)|我亲眼|兼容任意|支持任意/.test(
          withoutProhibitedActions(actionable),
        )
      : deviceClaims.test(
          withoutFileSelectionGestures(withoutProhibitedActions(actionable)),
        )) ||
    /我(?:已经|已)(?:帮你|为你)?(?:通知|联系|发送|下单|购买|移动|挪|创建|保存|安排|控制)/.test(
      actionable,
    ) ||
    questionsUnsafe
  )
    throw new AgentError("输出包含未核实的操作、状态或共同经历");
  if (packet.kind === "creative" && !["ideas", "companion"].includes(mode))
    throw new AgentError("当前任务不接受虚构替代事实");
  if (
    (packet.kind === "general" || packet.kind === "creative") &&
    /预约|配对|兼容|承重|载荷|电池规格|复位|重置|维修|拆机/.test(ctx.question)
  )
    throw new AgentError("需要型号证据");
  if (!packet.answer.trim()) throw new AgentError("没有可用回答");
  const itemIssues = itemAdviceIssues(packet.answer, ctx.itemContexts);
  if (itemIssues.length)
    throw new AgentError("物品条件检查：" + itemIssues.join("；"));
  return {
    ...blank(
      packet.answer,
      packet.kind === "needs_info"
        ? "needs_info"
        : packet.kind === "referred"
          ? "referred"
          : "answered",
      packet.kind === "supported"
        ? "model-with-evidence"
        : packet.kind === "creative"
          ? "model-creative"
          : "model-general",
    ),
    evidenceIds: packet.kind === "supported" ? packet.factIds : [],
    citations: supportedCitation,
    questions: packet.questions,
    caveat:
      packet.kind === "supported"
        ? ctx.knowledge.pack!.limits.join(" ")
        : packet.kind === "creative"
          ? "这是可选交流或创作表达，不作为真实经历自动保存。"
          : ctx.item
            ? "类别/通用知识，并非此型号官方说明；请核对标签与当前条件，未验证实物状态。"
            : "一般交流与帮助；没有伪造用户经历或执行动作。",
  };
}
type Work = {
  question: string;
  reply?: AssistantReply;
  trace: Trace[];
  messages: ModelMessage[];
  response?: ModelResponse;
  calls: number;
  modelTurns: number;
  repairs: number;
  toolItemIds: string[];
  toolCount: number;
  started: number;
  session: ServiceSession;
  tokens: { input: number; output: number } | null;
  officialLookup?: { documents: number; cached: boolean; issues: string[] };
};
const GraphState = Annotation.Root({ work: Annotation<Work> });
export async function executeGraph(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  session: ServiceSession,
  question: string,
  provider: Provider,
  temporary = false,
) {
  if (session.known.homeId === "young-apartment-v1")
    return executeHomeTask(
      db,
      read,
      actor,
      session,
      question,
      provider,
      temporary,
    );
  let contextDeadline = Date.parse(session.expiresAt);
  const trackExpiry = (records: { expiresAt?: string }[]) => {
    for (const m of records)
      if (m.expiresAt)
        contextDeadline = Math.min(contextDeadline, Date.parse(m.expiresAt));
  };
  let route: HomeRoute | undefined;
  let storyPlan: StoryPlan | undefined;
  let effectiveSession = session;
  let activeSkill: (typeof skills)[keyof typeof skills] =
    skills[
      session.mode === "story"
        ? "item-story"
        : session.mode === "companion"
          ? "companion"
          : session.mode === "ideas"
            ? "evidence-discovery"
            : "item-help"
    ];
  const itemSnapshots = new Map<string, string>();
  const guard = () => {
    if (Date.now() >= contextDeadline)
      throw new AgentError("上下文已过期，请重新提问", 409);
    if (!temporary) {
      const current = db
        .prepare("SELECT revision,body FROM agent_sessions WHERE id=?")
        .get(session.id) as { revision: number; body: string } | undefined;
      if (
        !current ||
        current.revision !== session.revision ||
        JSON.parse(current.body).status === "closed"
      )
        throw new AgentError("会话已更新，请重新打开", 409);
    }
    if (
      epoch(db, actor) !== session.memoryEpoch ||
      !sessionAccess(session, read(), actor)
    )
      throw new AgentError("物品或记忆授权已改变，请重新开始", 409);
    const latest = read();
    for (const [id, snapshot] of itemSnapshots) {
      const item = latest.items.find((i) => i.id === id && canRead(i, actor));
      if (!item || JSON.stringify(itemContext(item)) !== snapshot)
        throw new AgentError("物品状态或登记条件已改变，请重新核对后提问", 409);
    }
  };
  const saver = temporary
    ? new MemorySaver()
    : new SqliteCheckpointer(db, guard);
  const add = (w: Work, stage: string, detail: string) => {
    w.trace.push({ stage, detail, at: new Date().toISOString() });
  };
  const fresh = (q: string): Work => ({
    question: q,
    trace: [],
    messages: [],
    calls: 0,
    modelTurns: 0,
    repairs: 0,
    toolItemIds: [],
    toolCount: 0,
    started: Date.now(),
    session,
    tokens: null,
  });
  const agentBudgetMs = publicDemo()
    ? 75000
    : Math.min(
        120000,
        Math.max(45000, Number(process.env.AI_AGENT_TIMEOUT_MS) || 90000),
      );
  const graph = new StateGraph(GraphState)
    .addNode("route", ({ work }) => {
      guard();
      if (session.mode === "auto") {
        route = routeHome(work.question, read(), actor, session);
        const turnScope = route.itemId || "home";
        if (session.known.turnScope && session.known.turnScope !== turnScope) {
          for (const key of [
            "goal",
            "pending",
            "os",
            "originalReceiver",
            "lastOutcome",
            "unresolvedReason",
          ])
            delete session.known[key];
          session.tried = [];
        }
        session.known.turnScope = turnScope;
        if (session.known.lastIntent !== route.intent) {
          delete session.known.goal;
          delete session.known.pending;
        }
        session.known.lastIntent = route.intent;
        if (route.itemId) {
          const item = read().items.find(
            (i) => i.id === route!.itemId && canRead(i, actor),
          );
          if (item) {
            session.itemScopes = {
              ...session.itemScopes,
              [item.id]: itemStamp(item),
            };
            if (!item.demo) session.known.activeItemId = item.id;
          }
        }
        effectiveSession = {
          ...session,
          itemId: route.itemId,
          mode: route.mode,
        };
        activeSkill =
          skills[
            route.intent === "prepare"
              ? "task-preparation"
              : route.mode === "story"
                ? "item-story"
                : route.mode === "companion"
                  ? "companion"
                  : route.mode === "ideas"
                    ? "evidence-discovery"
                    : "item-help"
          ];
        add(
          work,
          "intent_routed",
          `${route.intent}; target=${route.itemId || "home"}; router=home-router-v1`,
        );
      }
      return { work };
    })
    .addNode("prepare", async ({ work }) => {
      guard();
      const w = { ...work, session, trace: [...work.trace] };
      if (
        session.known.interfaceMode === "care" &&
        route &&
        ["prepare", "plan", "move", "handoff"].includes(route.intent)
      ) {
        w.reply = {
          ...blank(
            "这项计划或管理操作可以切换到右上角的普通版继续。大字关怀版里，你可以问物品怎么用，或查看家人交代的事。",
            "answered",
            "local-dialogue",
          ),
          route,
        };
        return { work: w };
      }
      if (route?.intent === "prepare") {
        w.reply = homeDecision(
          db,
          read(),
          actor,
          session,
          w.question,
          route,
          temporary,
        );
        add(
          w,
          "skill_selected",
          "task-preparation@1.0.0; deterministic local rules; no model calls",
        );
        return { work: w };
      }
      const knowledgeQuery =
        isStepFollowup(w.question) ||
        /^(还是|仍然|没变化|依然|试过|我试过|第二步|第一步|第三步|已经|我已经)/.test(
          w.question,
        )
          ? session.known.goal ||
            [...session.messages]
              .reverse()
              .find(
                (m) =>
                  m.role === "user" &&
                  m.text !== w.question &&
                  (!m.itemId || m.itemId === effectiveSession.itemId) &&
                  operationQuestion(m.text),
              )?.text ||
            w.question
          : w.question;
      if (
        effectiveSession.mode === "service" &&
        operationQuestion(knowledgeQuery)
      )
        session.known.goal = knowledgeQuery;
      if (
        session.known.uiPage &&
        effectiveSession.mode === "service" &&
        effectiveSession.itemId &&
        operationQuestion(knowledgeQuery) &&
        process.env.WUJIAN_ALLOW_PUBLIC_FETCH === "true"
      ) {
        const acquired = await acquireKnowledge(
          db,
          read,
          actor,
          effectiveSession.itemId,
          {
            persist: !temporary,
            search:
              provider.ready &&
              provider.search &&
              process.env.WUJIAN_ALLOW_SEARCH === "true"
                ? async (q, sites) => {
                    w.calls++;
                    const result = await provider.search!(q, sites);
                    if (result.tokens)
                      w.tokens = {
                        input: (w.tokens?.input || 0) + result.tokens.input,
                        output: (w.tokens?.output || 0) + result.tokens.output,
                      };
                    return result;
                  }
                : undefined,
          },
        );
        guard();
        w.officialLookup = {
          documents: acquired.documents.length,
          cached: acquired.cached,
          issues: acquired.issues,
        };
        w.started = Date.now(); // Public acquisition has its own bounded requests; reserve a usable model response budget.
        add(
          w,
          "official_knowledge",
          JSON.stringify({
            documents: acquired.documents.length,
            cached: acquired.cached,
            issues: acquired.issues,
          }),
        );
      }
      const ctx = buildContext(db, read(), actor, {
        excludeSynthetic: session.known.memoryPolicy !== undefined,
        taskMemoryOnly: !!session.known.uiPage,
        includeItemRelationships: session.known.useItemMemories === "yes",
        companion: session.known.uiPage
          ? !!session.known.companionItemId
          : undefined,
        question: w.question,
        knowledgeQuery,
        mode: effectiveSession.mode,
        sessionId: session.id,
        itemId: effectiveSession.itemId,
        temporary,
      });
      trackExpiry(ctx.memories);
      if (ctx.item)
        itemSnapshots.set(ctx.item.id, JSON.stringify(itemContext(ctx.item)));
      if (
        ctx.externalKnowledge.some((c) => c.category !== "facts") &&
        effectiveSession.mode === "service"
      )
        activeSkill = skills["document-help"];
      if (route?.intent === "plan" && session.known.uiPage && !temporary) {
        w.calls = 0;
        try {
          const planningProvider: Provider = {
            ...provider,
            generate: async (...args) => {
              w.calls++;
              return provider.generate(...args);
            },
          };
          const plan = await planDiscovery(
            db,
            read(),
            actor,
            {
              goal: w.question,
              itemId: effectiveSession.itemId,
              previousIdeaIds: JSON.parse(session.known.lifeIdeaIds || "[]"),
              continuation: session.known.lifePlanContext
                ? JSON.parse(session.known.lifePlanContext)
                : undefined,
              model: provider.ready ?? true,
              includeSynthetic: false,
              candidates: 1,
              review: false,
              page: session.known.uiPage,
            },
            planningProvider,
            read,
          );
          guard();
          w.calls = plan.modelCalls;
          w.tokens = plan.tokens || null;
          session.known.lifePlanContext = JSON.stringify(plan.continuation);
          if (plan.ideas.length)
            session.known.lifeIdeaIds = JSON.stringify(
              plan.ideas.map((i) => i.id),
            );
          w.reply = {
            ...blank(
              plan.understanding +
                "\n\n" +
                (plan.ideas.some((i) => i.exploration)
                  ? plan.ideas
                      .map((i) => i.title + "\n" + (i.exploration?.text || ""))
                      .join("\n\n")
                  : plan.ideas[0]?.title ||
                    plan.failure?.message ||
                    "先核对可用物品，再继续规划。") +
                (plan.source === "model-creative" && plan.ideas[0]?.rationale
                  ? "\n关键原理与条件：" + plan.ideas[0].rationale
                  : ""),
              plan.ideas.length
                ? "answered"
                : plan.failure
                  ? "unavailable"
                  : "needs_info",
              plan.source === "model-creative"
                ? "model-creative"
                : "local-planning",
            ),
            steps: (plan.ideas[0]?.steps || []).map((text, n) => ({
              id: `life:${plan.ideas[0].id}:${n}`,
              text,
            })),
            questions: [],
            citations: (plan.ideas[0]?.creativeEvidenceSources || [])
              .filter((e) => e.url)
              .map((e) => ({
                id: e.id,
                title: e.title,
                url: e.url!,
                kind:
                  e.kind === "open-knowledge"
                    ? ("open_knowledge" as const)
                    : ("third_party" as const),
                section: e.license + "；" + e.attribution,
              })),
            evidenceIds: [],
            memoryIds: [],
            errorCode: plan.failure?.kind,
            caveat: [...plan.missing, ...(plan.ideas[0]?.limits || [])].join(
              " ",
            ),
          };
          add(w, "goal_planning", plan.source);
        } catch (error) {
          if (error instanceof AgentError) throw error;
          const e =
            error instanceof ProviderError
              ? error
              : new ProviderError(
                  "internal",
                  "本次规划未完成，请保留目标后重试。",
                );
          w.reply = { ...blank(e.message, "unavailable"), errorCode: e.code };
          add(w, "goal_planning_failed", e.code);
        }
        return { work: w };
      }
      storyPlan = planMemoryStory(ctx, effectiveSession);
      // Safety decisions and domain actions take priority over conversational polish.
      if (
        unsafe.test(withoutProhibitedActions(w.question)) ||
        (route && !["story", "companion"].includes(route.intent))
      )
        storyPlan = undefined;
      if (storyPlan) activeSkill = skills["memory-storytelling"];
      const skill = activeSkill;
      trackExpiry(ctx.memories);
      add(w, "skill_selected", `${skill.goal}; version=${skill.version}`);
      add(
        w,
        "context_ready",
        `purpose=${session.mode}; memoryRefs=${ctx.cloudMemories.map((m) => m.id).join(",")}; prompt=${PROMPT_VERSION}`,
      );
      // Synthesize the whole question before local excerpt shortcuts can finish it.
      // Keep hazardous guidance, creative planning and story composition on their existing paths.
      if (provider.ready && ctx.item && ctx.externalKnowledge.length &&
          effectiveSession.mode === "service" && !storyPlan &&
          (operationQuestion(knowledgeQuery) || process.env.WUJIAN_EXPERIMENTAL_FACT_QA === "true") &&
          !unsafe.test(withoutProhibitedActions(w.question)) &&
          (!route || route.intent === "help")) {
        try {
          guard();
          w.calls++;
          const result = await answerKnownItem(ctx, session, w.question, provider, operationQuestion(knowledgeQuery));
          w.modelTurns++; w.tokens = result.tokens;
          guard();
          w.reply = result.reply;
          add(w, "grounded_answer", `one-round; modelMs=${Math.round(result.modelMs)}`);
          return { work: w };
        } catch (error) {
          if (error instanceof AgentError && error.status !== 400) throw error;
          w.reply = { ...(offlineDocumentHelp(ctx.externalKnowledge, session) || blank("模型暂未完成回答，可重试或查看原始资料。", "unavailable")), errorCode: error instanceof ProviderError ? error.code : "network" };
          w.reply.answer = "本轮模型回答未完成或未通过资料核对，以下保留原始摘录供查看；不是完整操作指导。";
          w.reply.outcome = "needs_info";
          add(w, "grounded_answer_failed", "local excerpt fallback; no automatic paid retry");
          return { work: w };
        }
      }
      w.reply =
        (session.known.memoryPolicy !== undefined &&
        !temporary &&
        ctx.persona.memoryUse !== "off" &&
        !(provider.ready && ctx.cloudFragments.length)
          ? recallLifeFragments(
              db,
              read(),
              actor,
              w.question,
              effectiveSession.itemId,
            )
          : undefined) ||
        (route &&
          !(route.intent === "story" && ctx.cloudFragments.length) &&
          homeDecision(
            db,
            read(),
            actor,
            session,
            w.question,
            route,
            temporary,
          )) ||
        (!unsafe.test(withoutProhibitedActions(w.question)) &&
        effectiveSession.itemId &&
        effectiveSession.mode === "service"
          ? sourceReply(
              db,
              read(),
              actor,
              effectiveSession.itemId,
              w.question,
              !ctx.knowledge.facts.length,
            )
          : undefined) ||
        (!ctx.cloudFragments.length
          ? curatedDecision(
              w.question,
              effectiveSession,
              ctx,
              session.mode === "auto",
              !!provider.ready,
            )
          : undefined);
      if (
        !w.reply &&
        ctx.item &&
        operationQuestion(knowledgeQuery) &&
        ctx.externalKnowledge.length &&
        ctx.externalKnowledge.every((e) => e.category === "facts")
      ) {
        w.reply = {
          ...blank(
            `已找到${ctx.item.model}的官方资料入口，但可读取正文只有资料/规格信息，缺少可核对的操作图解。可从下方原始来源打开对应说明；本轮不从规格补造步骤。`,
            "needs_info",
          ),
          citations: ctx.externalKnowledge.map((e) => ({
            id: e.id,
            title: e.title,
            url: e.url,
            kind: "official" as const,
          })),
          caveat: "型号入口经过核对；图片式步骤/动态下载内容尚未完整提取。",
        };
      }
      if (
        !w.reply &&
        w.officialLookup &&
        !w.officialLookup.documents &&
        !ctx.externalKnowledge.length &&
        !ctx.knowledge.pack &&
        ctx.item?.model &&
        ctx.item.model !== "待确认" &&
        operationQuestion(knowledgeQuery)
      ) {
        w.reply = {
          ...blank(
            `已确认档案型号为${ctx.item.model}。${ctx.item.supportUrl ? "已记录提供的官方链接，但本轮读取未成功；不需要重复提供同一链接。" : ""}本轮未取得可靠的专属操作资料，不能猜测按键、时长或套用相似型号。通用准备可先核对实物标签与包装说明；可稍后刷新，或补充可读取的对应资料。`,
            "needs_info",
          ),
          caveat: w.officialLookup.issues.join(" "),
        };
      }
      if (storyPlan) {
        add(
          w,
          "memory_story_planned",
          `${STORYTELLING_VERSION}; refs=${storyPlan.sources.map((m) => m.id).join(",")}`,
        );
        if (canComposeInCloud(storyPlan)) {
          w.reply = undefined;
          w.messages = storytellingMessages(storyPlan);
          add(w, "memory_story_composition", "authorized-cloud");
        } else {
          w.reply = localMemoryStory(storyPlan);
          add(w, "memory_story_composition", "local-private-or-demo");
        }
      } else if (
        ctx.externalKnowledge.some((c) => c.category !== "facts") &&
        effectiveSession.mode === "service" &&
        !unsafe.test(withoutProhibitedActions(w.question))
      ) {
        w.reply =
          provider.ready === false
            ? offlineDocumentHelp(ctx.externalKnowledge, session)
            : undefined;
      }
      if (!w.reply && !storyPlan) {
        const prior = session.messages
          .slice(Number(session.known.itemMemoryBoundary || 0))
          .filter(
            (m) =>
              !(
                ctx.persona.memoryUse === "off" &&
                m.role === "assistant" &&
                m.reply?.memoryIds.length
              ) &&
              (m.role === "feedback" ||
                m.role === "action" ||
                (session.known.memoryPolicy !== undefined &&
                  (m.role === "user" || m.role === "assistant"))) &&
              (m.itemId || session.itemId || "") ===
                (effectiveSession.itemId || ""),
          )
          .slice(session.known.memoryPolicy ? -8 : -3)
          .map((m) => ({ role: m.role, text: m.text.slice(0, 500) }));
        w.messages = [
          {
            role: "system",
            content:
              SYSTEM_PROMPT +
              "\n回答前核对用户这句话中的所有问题，分别覆盖，不以第一个命中的知识片段代替整个回答。相关物品资料是完整的小型型号资料包；综合使用其中的材质、结构、规格、限制和未知项。型号设计事实、用户登记及实物当前状态分开说。资料未覆盖的问题明确说未知，可给有用的核对路径。普通交流自然回应，不把分享感受变成录入、确认记忆或选择物品的任务。" +
              ITEM_CONTEXT_INSTRUCTIONS +
              "\n严格区分‘助手建议过’和‘用户明确说已经做过’。建议的选中、复制、连接或保存不能当成已经执行；继续下一步前保留未完成的前置动作，不假设剪贴板已有内容。当前对话只显示文字，没有语音朗读或代打电话；只能提供文字说明，不能声称能读给用户听。照片识别只在pageContext明确列为可用时才能建议走该入口，不保证一定识别成功或一定找到官方资料。" +
              (session.known.interfaceMode === "care"
                ? "\n当前为大字关怀版：短句、常用词，一次先给1—3个当前可执行的小步骤，至多追问一项必要信息；完整流程可分段继续，不能省略安全前提和资料缺口。用户已经做过的步骤不要重复。普通输入操作不猜按键的物理位置。仍待维修或被家人提醒停用的物品，先停用并询问维修负责人，不建议通电或试用来验证。"
                : "") +
              (ctx.persona.enabled
                ? "\n表达风格：" +
                  {
                    neutral:
                      "简洁直接、正常交流；不用动作扮演、抒情比喻或大量表情。",
                    warm: "自然亲切，适度回应感受，不渲染共同经历。",
                    playful:
                      "轻松有趣，可以有少量明确比喻；不假装实物移动或感知。",
                  }[ctx.persona.style]
                : "\n默认正常自然交流，不扮演拟人物品。") +
              "个人关系记忆是用户报告，不代表已核实情感或当前状态。回答当前实际目标时，结合给出的尺寸、限制和获准故事，不要只复述回忆。分身只是一种表达方式，不具有感知或控制实物的能力。没有提供获准经历时，不能预设‘我们上次一起去过’；应直接说没有可确认的记录。不能承诺自动保存、开机提醒或控制实物；用户需主动确认保存。" +
              (route
                ? "\n统一对话：当前意图=" +
                  route.intent +
                  "。角色信息由本轮 item 数据给出。自然回应用户当下的话，不要求填写画像，不捏造共同经历。story 意图使用 general 回应真实叙述，至多追问一件相关的事，不补写虚构经历。历史私人记忆仅限提供的已授权片段；未提供时不声称记得。没有服务端行动回执，不声称已经通知家人、保存计划或控制设备。"
                : "") +
              "\n本次任务：" +
              skill.goal +
              "\n" +
              skill.instructions,
          },
          {
            role: "user",
            content: JSON.stringify({
              question: w.question,
              pageContext: session.known.uiPage
                ? {
                    page: session.known.uiPage,
                    interfaceMode: session.known.interfaceMode || "standard",
                    appCapabilities: {
                      available: [
                        ...(visionStatus().ready
                          ? ["照片视觉候选，须逐张确认上云并人工确认实例"]
                          : []),
                        "手动/照片/扫码录入，型号需确认",
                        "来源资料问答",
                        "目标规划与反馈",
                        "图文故事手动保存",
                        "记忆候选与明确保存",
                        process.env.AUTH_MODE === "authenticated" ? "独立账号家庭、明确授权共享与选择故事的礼物认领" : "本机演示家庭与社交礼物",
                      ],
                      unavailable: [
                        ...(!visionStatus().ready ? ["视觉识物尚未启用"] : []),
                        ...(process.env.AUTH_MODE === "authenticated" ? ["短信、推送和其他外部通知未接入"] : ["真实家庭账户/跨设备通知"]),
                        "当前对话语音朗读、自动拨号或接通真人客服",
                        "自动购物下单",
                        "受限社区全站API",
                      ],
                    },
                    goal: session.known.uiGoal || session.known.goal,
                    currentItemId: ctx.item?.id,
                  }
                : undefined,
              goal: session.known.goal,
              mode: effectiveSession.mode,
              item: ctx.item
                ? {
                    name: ctx.item.name,
                    brand: ctx.item.brand,
                    model: ctx.item.model,
                    region: ctx.item.region || "未确认",
                    category: ctx.item.category,
                    attributes: ctx.item.attributes,
                    state: ctx.item.state,
                    availability: ctx.item.availability,
                  }
                : null,
              itemContexts: ctx.itemContexts,
              knowledgeSnapshot: ctx.sharedKnowledge.snapshot,
              evidence: ctx.knowledge,
              officialDocuments: ctx.externalKnowledge,
              knowledgeTask: ctx.knowledgeTask,
              officialLookup: w.officialLookup,
              memories: ctx.cloudMemories.map((m) => ({
                id: m.id,
                kind: m.kind,
                text: m.text,
              })),
              preferences: ctx.cloudPreferences,
              authorizedLifeStories: ctx.cloudFragments,
              resources: ctx.resources,
              persona: ctx.persona.enabled ? ctx.persona : undefined,
              prior,
              tried: session.tried,
              completedSteps: session.messages
                .flatMap((m) => m.reply?.steps || [])
                .filter((s) => session.tried.includes(s.id))
                .slice(-12)
                .map((s) => ({ id: s.id, text: s.text })),
            }),
          },
        ];
      } else if (w.reply) add(w, "curated_answer", w.reply.outcome);
      return { work: w };
    })
    .addNode("model", async ({ work }) => {
      guard();
      const w = { ...work, trace: [...work.trace] };
      if (
        (w.modelTurns || 0) >= turnBudget.modelTurns ||
        Date.now() - w.started > agentBudgetMs
      ) {
        w.reply = {
          ...blank(
            "本次推敲已达到处理时限或回合上限，尚未形成最终回答。可缩小到一件物品或一个问题后重试；这不表示你的资料有误。",
            "unavailable",
          ),
          errorCode: "turn_budget_exhausted",
        };
        add(
          w,
          "turn_budget_exhausted",
          `rounds=${w.modelTurns || 0}; attempts=${w.calls}`,
        );
        return { work: w };
      }
      try {
        w.calls++;
        w.modelTurns = (w.modelTurns || 0) + 1;
        add(
          w,
          "model_started",
          `attempt=${w.calls}; round=${w.modelTurns}/${turnBudget.modelTurns}`,
        );
        const allowedNames: readonly string[] = activeSkill.tools;
        const activeTools =
          w.modelTurns === turnBudget.modelTurns
            ? []
            : tools.filter(
                (t) =>
                  allowedNames.includes(t.function.name) &&
                  (t.function.name !== "explore_owned_software" ||
                    (process.env.WUJIAN_ENABLE_DEVICE_LAB === "true" &&
                     read().items.some(i => i.id === effectiveSession.itemId && i.owner === actor && i.synthetic && i.model === "WUJIAN-SOFTWARE-LAMP-1"))) &&
                  !(
                    w.officialLookup &&
                    t.function.name === "fetch_official_knowledge"
                  ) &&
                  !(
                    !!w.officialLookup?.documents &&
                    activeSkill === skills["document-help"] &&
                    t.function.name === "search_product_knowledge"
                  ),
              );
        w.response = provider.complete
          ? await provider.complete(w.messages, activeTools, {
              timeoutMs: Math.max(1, agentBudgetMs - (Date.now() - w.started)),
              maxTokens: activeSkill === skills["document-help"] ? 2600 : 1500,
            })
          : {
              ...(await provider.generate(
                w.messages[0].content || SYSTEM_PROMPT,
                JSON.parse(w.messages[1].content || "{}"),
              )),
              toolCalls: [],
              finishReason: "stop",
            };
        guard();
        const t = w.response.tokens;
        if (t)
          w.tokens = {
            input: (w.tokens?.input || 0) + t.input,
            output: (w.tokens?.output || 0) + t.output,
          };
        add(w, "model_returned", `tools=${w.response.toolCalls.length}`);
        if (storyPlan && w.response.toolCalls.length) {
          w.reply = localMemoryStory(storyPlan);
          add(w, "memory_story_fallback", "unexpected_tool_call");
        }
      } catch (error) {
        if (error instanceof AgentError) throw error;
        const e =
          error instanceof ProviderError
            ? error
            : new ProviderError("internal", "暂时无法生成可靠回答。");
        if (storyPlan) {
          w.reply = {
            ...localMemoryStory(storyPlan),
            errorCode: e.code,
          };
          add(w, "memory_story_fallback", "provider_unavailable");
        } else if (route?.intent === "story" && isStoryNarration(w.question)) {
          const ctx = buildContext(db, read(), actor, {
            excludeSynthetic: session.known.memoryPolicy !== undefined,
            taskMemoryOnly: !!session.known.uiPage,
            includeItemRelationships: session.known.useItemMemories === "yes",
            companion: session.known.uiPage
              ? !!session.known.companionItemId
              : undefined,
            question: w.question,
            mode: "story",
            itemId: effectiveSession.itemId,
            sessionId: session.id,
            temporary,
          });
          w.reply = {
            ...curatedDecision(w.question, effectiveSession, ctx)!,
            caveat: "本次使用本地故事记录；AI 暂不可用，未生成模型回应。",
            errorCode: e.code,
          };
        } else if (route?.intent === "companion") {
          w.reply = {
            ...blank(
              "我在这里，可以继续说说。当前是本地简短回应；云端 AI 尚未开启。",
              "answered",
              "local-dialogue",
            ),
            caveat: "本地简短回应；AI 暂不可用，没有读取未授权的历史记忆。",
            errorCode: e.code,
          };
        } else
          w.reply = { ...blank(e.message, "unavailable"), errorCode: e.code };
        add(w, "provider_failed", e.code);
      }
      return { work: w };
    })
    .addNode("tools", async ({ work }) => {
      guard();
      const w = {
        ...work,
        messages: [...work.messages],
        trace: [...work.trace],
      };
      const calls = w.response!.toolCalls;
      if (w.toolCount + calls.length > turnBudget.toolCalls) {
        w.reply = blank(
          "本轮读取次数已用完，尚未完成回答。可以缩小物品范围后重试。",
          "unavailable",
        );
        w.reply.errorCode = "tool_budget_exhausted";
        return { work: w };
      }
      w.messages.push({
        role: "assistant",
        content: w.response!.text || null,
        tool_calls: calls,
      });
      for (const call of calls) {
        guard();
        w.toolCount++;
        let value: unknown;
        try {
          const allowed: readonly string[] = activeSkill.tools;
          if (!allowed.includes(call.function.name))
            throw new AgentError("本任务未开放此工具");
          const args: {
            query?: string;
            itemId?: string;
            offset?: number;
            limit?: number;
          } = (
            call.function.name === "list_accessible_items"
              ? z
                  .object({
                    offset: z.number().int().min(0).optional(),
                    limit: z.number().int().min(1).max(40).optional(),
                  })
                  .strict()
              : ["read_item_context", "explore_owned_software"].includes(call.function.name)
                ? z.object({ itemId: z.string().min(1).max(100) }).strict()
                : z
                    .object({ query: z.string().trim().min(1).max(200) })
                    .strict()
          ).parse(JSON.parse(call.function.arguments));
          const query = args.query || "";
          const ctx = buildContext(db, read(), actor, {
            excludeSynthetic: session.known.memoryPolicy !== undefined,
            taskMemoryOnly: !!session.known.uiPage,
            includeItemRelationships: session.known.useItemMemories === "yes",
            companion: session.known.uiPage
              ? !!session.known.companionItemId
              : undefined,
            question: query || w.question,
            mode: effectiveSession.mode,
            sessionId: session.id,
            itemId: effectiveSession.itemId,
            temporary,
          });
          trackExpiry(ctx.cloudMemories);
          if (call.function.name === "explore_owned_software") {
            if (args.itemId !== effectiveSession.itemId || temporary) throw new AgentError("只分析当前物品，临时提问不保存探索结果", 403);
            value = await analyzeOwnedLamp(db, read, actor, args.itemId!);
            guard();
          } else if (call.function.name === "read_item_context") {
            value = readItemContext(
              read(),
              actor,
              args.itemId!,
              !!ctx.item?.demo,
            );
            if (!value) throw new AgentError("物品不存在或未获授权");
          } else if (call.function.name === "fetch_official_knowledge") {
            if (
              !effectiveSession.itemId ||
              !session.known.uiPage ||
              process.env.WUJIAN_ALLOW_PUBLIC_FETCH !== "true"
            )
              throw new AgentError("本轮未开放官方联网读取");
            const acquired = await acquireKnowledge(
              db,
              read,
              actor,
              effectiveSession.itemId,
              { persist: !temporary },
            );
            guard();
            value = {
              issues: acquired.issues,
              documents: retrieveKnowledge(
                db,
                read(),
                actor,
                effectiveSession.itemId,
                query || w.question,
              ),
            };
          } else
            value =
              call.function.name === "search_product_knowledge"
                ? {
                    ...relevantKnowledge(
                      query || w.question,
                      ctx.knowledge.pack,
                    ),
                    officialDocuments: ctx.externalKnowledge,
                  }
                : call.function.name === "search_personal_memory"
                  ? ctx.cloudMemories.map((m) => ({
                      id: m.id,
                      text: m.text,
                      kind: m.kind,
                    }))
                  : itemContextPage(
                      read(),
                      actor,
                      !!ctx.item?.demo,
                      args.offset,
                      args.limit,
                    );
          if (
            ["read_item_context", "list_accessible_items"].includes(
              call.function.name,
            )
          ) {
            const returned = (
              call.function.name === "list_accessible_items"
                ? (value as ReturnType<typeof itemContextPage>).items
                : [value]
            ) as ItemContext[];
            w.toolItemIds = [
              ...new Set([
                ...(w.toolItemIds || []),
                ...returned.map((i) => i.id),
              ]),
            ];
            for (const record of returned) {
              itemSnapshots.set(record.id, JSON.stringify(record));
              const item = read().items.find(
                (i) => i.id === record.id && canRead(i, actor),
              );
              if (item)
                session.itemScopes = {
                  ...session.itemScopes,
                  [item.id]: itemStamp(item),
                };
            }
          }
          add(w, "tool_completed", call.function.name);
        } catch {
          value = { error: "工具不存在、参数无效或不在本任务授权范围" };
          add(w, "tool_denied", call.function.name);
        }
        w.messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(value),
        });
      }
      return { work: w };
    })
    .addNode("validate", async ({ work }) => {
      guard();
      const w = {
        ...work,
        messages: [...work.messages],
        trace: [...work.trace],
      };
      try {
        const ctx = buildContext(db, read(), actor, {
          excludeSynthetic: session.known.memoryPolicy !== undefined,
          taskMemoryOnly: !!session.known.uiPage,
          includeItemRelationships: session.known.useItemMemories === "yes",
          companion: session.known.uiPage
            ? !!session.known.companionItemId
            : undefined,
          question: session.known.goal || w.question,
          mode: effectiveSession.mode,
          sessionId: session.id,
          itemId: effectiveSession.itemId,
          temporary,
        });
        ctx.knowledgeTask.question += "\n本轮用户条件：" + w.question;
        ctx.itemContexts = [
          ...new Map(
            [
              ...ctx.itemContexts,
              ...(w.toolItemIds || []).flatMap((id) => {
                const item = readItemContext(
                  read(),
                  actor,
                  id,
                  !!ctx.item?.demo,
                );
                return item ? [item] : [];
              }),
            ].map((i) => [i.id, i]),
          ).values(),
        ];
        w.reply = storyPlan
          ? validateStorytelling(w.response!.text, storyPlan)
          : validateModelPacket(
              w.response!.text,
              ctx,
              effectiveSession.mode,
              session.tried,
              session.messages,
            );
        // Repair only an omitted, source-backed action. Keep the usable original
        // steps; no transport retries or wholesale re-generation of valid guidance.
        if (
          !storyPlan &&
          ctx.knowledgeTask.full &&
          ctx.knowledgeTask.cooking &&
          w.reply.source === "model-with-evidence" &&
          (w.modelTurns || 0) < turnBudget.modelTurns &&
          (w.repairs || 0) < turnBudget.repairs
        ) {
          const missing = ctx.knowledgeTask.checklist.filter(
            (c) =>
              c.sourceIds.length &&
              w.reply!.taskProgress?.missing.some((m) => m.startsWith(c.label)),
          );
          if (missing.length) {
            const originalPacket = JSON.parse(w.response!.text);
            try {
              w.calls++;
              w.repairs = (w.repairs || 0) + 1;
              add(
                w,
                "repair_missing_actions",
                missing.map((m) => m.id).join(","),
              );
              const patch = await provider.generate(
                "只补齐有原文依据但被遗漏的动作，不重写已有步骤。输出JSON {additions:[{beforeIndex,phase,covers,text,sourceIds,sourceQuote}]}。beforeIndex为原steps的0开始插入位置；引文逐字来自证据，步骤不得添加无据参数。将炸盘放入篮子不是装料，需明确将食材逐一放入；食材/份量未确认时不自拟食谱参数。已完成动作不重复。",
                {
                  missing,
                  steps: originalPacket.steps,
                  evidence: ctx.externalKnowledge.filter((e) =>
                    missing.some((m) => m.sourceIds.includes(e.id)),
                  ),
                  completedSteps: session.messages
                    .flatMap((m) => m.reply?.steps || [])
                    .filter((s) => session.tried.includes(s.id)),
                  conditions: w.question,
                },
                {
                  maxTokens: 1100,
                  timeoutMs: Math.max(
                    1,
                    Math.min(30000, agentBudgetMs - (Date.now() - w.started)),
                  ),
                },
              );
              if (patch.tokens)
                w.tokens = {
                  input: (w.tokens?.input || 0) + patch.tokens.input,
                  output: (w.tokens?.output || 0) + patch.tokens.output,
                };
              guard();
              const additions = z
                .object({
                  additions: z
                    .array(
                      z
                        .object({
                          beforeIndex: z
                            .number()
                            .int()
                            .min(0)
                            .max(originalPacket.steps.length),
                          phase: z.string(),
                          covers: z.array(z.string()).optional(),
                          text: z.string(),
                          sourceIds: z.array(z.string()),
                          sourceQuote: z.string(),
                        })
                        .strict(),
                    )
                    .max(3),
                })
                .parse(JSON.parse(patch.text)).additions;
              for (const { beforeIndex, ...step } of additions.sort(
                (a, b) => b.beforeIndex - a.beforeIndex,
              ))
                originalPacket.steps.splice(beforeIndex, 0, step);
              w.reply = groundedReply(
                originalPacket,
                ctx.externalKnowledge,
                { tried: session.tried, messages: session.messages },
                ctx.knowledgeTask,
              );
              add(w, "missing_actions_rechecked", String(additions.length));
            } catch (error) {
              add(
                w,
                "partial_repair_failed",
                error instanceof ProviderError
                  ? error.code
                  : "patch_validation",
              );
              // The previously accepted result remains explicitly partial.
            }
          }
        }
        w.reply.model = w.response!.model;
        if (!storyPlan)
          w.reply.memoryIds = [
            ...ctx.cloudMemories.map((m) => m.id),
            ...ctx.cloudFragments.map((f) => f.id),
          ];
        add(w, "validated", w.reply.outcome);
      } catch (error) {
        add(
          w,
          "validation_failed",
          error instanceof AgentError ? error.message : "schema_or_support",
        );
        if (storyPlan) {
          w.reply = localMemoryStory(storyPlan);
          add(w, "memory_story_fallback", "invalid_narrative");
        } else if (
          (w.modelTurns || 0) < turnBudget.modelTurns &&
          (w.repairs || 0) < turnBudget.repairs
        ) {
          w.repairs = (w.repairs || 0) + 1;
          w.messages.push(
            { role: "assistant", content: w.response!.text },
            {
              role: "system",
              content:
                "内部校验反馈，不是用户的新问题或经历。请继续回答用户的原始问题：" +
                JSON.stringify(w.question) +
                "。校验失败原因：" +
                (error instanceof AgentError ? error.message : "结构无效") +
                (activeSkill === skills["document-help"]
                  ? "。不要原样重复。去掉未经逐步引用支持的参数/按钮/装配细节，不从另一段借数字。使用grounded，steps每项必须有phase和sourceIds，answer只引导；knowledgeTask.requiredPhases缺少的用gaps说明。已知型号不再询问。"
                  : effectiveSession.mode === "service"
                    ? "。保持使用帮助意图。官方证据只选相关factIds；用户登记的材质、状态、限制请用general与实际itemIds，不把登记伪装成官方supported事实。普通电脑操作可用general。缺少型号专属依据则用needs_info或referred并给出下一步，不编造按钮，不改聊故事，不把校验文字当成用户说过的话。只输出合法JSON。"
                    : "。保持当前聊天/故事意图，不把校验反馈当成用户经历。仅输出合法JSON，使用标准双引号。"),
            },
          );
        } else {
          const ctx = buildContext(db, read(), actor, {
            question: w.question,
            mode: effectiveSession.mode,
            itemId: effectiveSession.itemId,
            temporary,
          });
          const pack = ctx.knowledge.pack;
          if (pack && ctx.knowledge.facts.length) {
            // An unsafe paraphrase must not hide still-useful verified facts.
            // This is explicitly extractive fallback, never a successful model answer.
            w.reply = {
              ...blank(
                ctx.knowledge.facts.map((f) => f.text).join("\n") +
                  "\n尚未确认：" +
                  [
                    ...new Set([
                      ...(pack.understanding?.unknowns || []),
                      "这件实物当前的完好程度、设备电量及实际连接状态；登记状态不是实时检测",
                    ]),
                  ].join("；"),
                "needs_info",
              ),
              evidenceIds: ctx.knowledge.facts.map((f) => f.id),
              citations: [
                {
                  id: pack.id,
                  title: pack.source.title,
                  url: pack.source.url,
                  kind: "official",
                },
              ],
              errorCode: "validation_failed_partial",
              caveat:
                "模型综合回答未通过检查；以上仅摘录当前型号资料，未展示未经支持的操作。" +
                pack.limits.join(" "),
            };
            add(
              w,
              "verified_facts_fallback",
              "model paraphrase rejected; extractive only",
            );
          } else
            w.reply = {
              ...blank(
                "本轮模型候选未通过资料或物品条件检查，修正后仍未得到可靠答案，未展示该草稿。可缩小到一个具体问题后重试；已登记的物品无需重复录入。",
                "unavailable",
              ),
              errorCode: "validation_failed",
              caveat:
                error instanceof AgentError
                  ? "候选未通过的原因：" + error.message
                  : "模型输出格式未通过检查。",
            };
        }
      }
      return { work: w };
    })
    .addNode("wait", ({ work }) => {
      const next = interrupt({
        sessionId: session.id,
        outcome: work.reply?.outcome,
      });
      if (!next || typeof next.question !== "string")
        throw new AgentError("继续提问格式无效");
      return { work: fresh(next.question) };
    })
    .addEdge(START, "route")
    .addEdge("route", "prepare")
    .addConditionalEdges("prepare", ({ work }) =>
      work.reply ? "wait" : "model",
    )
    .addConditionalEdges("model", ({ work }) =>
      work.reply
        ? "wait"
        : work.response?.toolCalls.length
          ? "tools"
          : "validate",
    )
    .addConditionalEdges("tools", ({ work }) => (work.reply ? "wait" : "model"))
    .addConditionalEdges("validate", ({ work }) =>
      work.reply ? "wait" : "model",
    )
    .addEdge("wait", "route")
    .compile({ checkpointer: saver });
  const config = {
    configurable: { thread_id: actor + ":" + session.id },
    recursionLimit: 24,
  };
  const previous = await graph.getState(config);
  const input = previous.next?.includes("wait")
    ? new Command<
        unknown,
        { work?: Work },
        | "model"
        | "tools"
        | "__start__"
        | "prepare"
        | "validate"
        | "wait"
        | "route"
      >({ resume: { question } })
    : { work: fresh(question) };
  try {
    const result = await graph.invoke(input, { ...config, durability: "sync" });
    guard();
    const w = result.work;
    return {
      reply: route ? { ...w.reply!, route } : w.reply!,
      trace: w.trace,
      tokens: w.tokens,
      modelCalls: w.calls,
    };
  } catch (error) {
    await saver.deleteThread(actor + ":" + session.id);
    throw error;
  }
}
