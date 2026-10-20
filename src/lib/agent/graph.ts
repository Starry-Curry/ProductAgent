import {
  acquireKnowledge,
  retrieveKnowledge,
  operationQuestion,
} from "../life/acquisition.ts";
import { groundedReply, offlineDocumentHelp } from "../skills/document-help.ts";
import { planDiscovery } from "../life/planning.ts";
import { withoutProhibitedActions } from "./safety-language.ts";
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
import { SYSTEM_PROMPT, PROMPT_VERSION, tools } from "./prompts.ts";
import { isStoryNarration } from "../memory/ambient.ts";
import { epoch } from "../memory/store.ts";
import { sessionAccess } from "../repositories/sessions.ts";
import { routeHome } from "../home/router.ts";
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
  })
  .strict();
const unsafe =
  /短接|拆开.{0,8}电池|加热.{0,8}电池|电池.{0,8}加热|带电.{0,8}拆|湿.{0,8}充电|冒烟|漏电|烧焦/;
const hazardousActions =
  /短接|拆开.{0,8}电池|加热.{0,8}电池|电池.{0,8}加热|带电.{0,8}拆|湿.{0,8}充电/;
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
    /原配|^(有|是|有的|是的|有原装的)[。！!]?$/u.test(question)
  )
    session.known.originalReceiver = "yes";
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
    !/怎么|如何|故障|不行|失灵|维修|修好/.test(goal)
  ) {
    return {
      ...blank(knowledge.facts.map((f) => f.text).join("\n")),
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
    (!ctx.item?.model || ctx.item.model === "待确认") &&
    /预约|配对|兼容|接收器|型号|复位|重置|拆|电池规格|承重|载荷/.test(goal)
  )
    return {
      ...blank(
        "我可以帮你核对。先告诉我品牌和具体型号，或补充对应说明书；这样才能判断专属步骤，避免套用相似产品。",
        "needs_info",
      ),
      questions: ["品牌和具体型号是什么？"],
    };
  return undefined;
}
export function validateModelPacket(
  text: string,
  ctx: ReturnType<typeof buildContext>,
  mode: string,
  tried: string[] = [],
): AssistantReply {
  const value = JSON.parse(text);
  if (value?.kind === "grounded")
    return groundedReply(
      value,
      ctx.externalKnowledge,
      { tried },
      ctx.knowledgeTask,
    );
  const packet = packetSchema.parse(value);
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
    return {
      ...blank(
        selected.map((f) => f!.text).join("\n"),
        "answered",
        "model-with-evidence",
      ),
      evidenceIds: packet.factIds,
      citations: [
        {
          id: pack.id,
          title: pack.source.title,
          url: pack.source.url,
          kind: "official",
          section: pack.source.section,
        },
      ],
      caveat: pack.limits.join(" "),
    };
  }
  const actionable = packet.answer.replace(
    /(?:不要|不能|禁止|切勿|请勿|避免|不建议)[^，,。；！？\n]{0,120}/g,
    "",
  );
  const questionsUnsafe = packet.questions.some(
    (q) =>
      /(请|尝试|试着|直接|先把|先将)/.test(q) &&
      (hazardousActions.test(q) || deviceClaims.test(q)),
  );
  if (
    hazardousActions.test(withoutProhibitedActions(actionable)) ||
    deviceClaims.test(withoutProhibitedActions(actionable)) ||
    /我(?:已经|已)(?:帮你|为你)?(?:通知|联系|发送|下单|购买|移动|挪|创建|保存|安排|控制)/.test(
      actionable,
    ) ||
    questionsUnsafe
  )
    throw new AgentError("输出包含未核实的操作、状态或共同经历");
  if (
    packet.kind === "general" &&
    ctx.knowledge.facts.length &&
    !ctx.productConversation &&
    mode !== "companion"
  )
    throw new AgentError("存在相关事实，请选择来源 ID 或说明还缺什么条件");
  if (packet.kind === "creative" && !["ideas", "companion"].includes(mode))
    throw new AgentError("当前任务不接受虚构替代事实");
  if (
    (packet.kind === "general" || packet.kind === "creative") &&
    /预约|配对|兼容|承重|载荷|电池规格|复位|重置|维修|拆机/.test(ctx.question)
  )
    throw new AgentError("需要型号证据");
  if (!packet.answer.trim()) throw new AgentError("没有可用回答");
  return {
    ...blank(
      packet.answer,
      packet.kind === "needs_info"
        ? "needs_info"
        : packet.kind === "referred"
          ? "referred"
          : "answered",
      packet.kind === "creative" ? "model-creative" : "model-general",
    ),
    questions: packet.questions,
    caveat:
      packet.kind === "creative"
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
    toolCount: 0,
    started: Date.now(),
    session,
    tokens: null,
  });
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
            route.mode === "story"
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
      const knowledgeQuery =
        /^(还是|仍然|没变化|依然|试过|我试过|第二步|第一步|第三步|已经|我已经)/.test(
          w.question,
        )
          ? session.known.goal || w.question
          : w.question;
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
        question: w.question,
        knowledgeQuery,
        mode: effectiveSession.mode,
        sessionId: session.id,
        itemId: effectiveSession.itemId,
        temporary,
      });
      trackExpiry(ctx.memories);
      if (
        ctx.externalKnowledge.some((c) => c.category !== "facts") &&
        effectiveSession.mode === "service"
      )
        activeSkill = skills["document-help"];
      if (route?.intent === "plan" && session.known.uiPage && !temporary) {
        w.calls = (provider.ready ?? true) ? 1 : 0;
        try {
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
              review: true,
              page: session.known.uiPage,
            },
            provider,
            read,
          );
          guard();
          w.calls = plan.modelCalls;
          session.known.lifePlanContext = JSON.stringify(plan.continuation);
          if (plan.ideas.length)
            session.known.lifeIdeaIds = JSON.stringify(
              plan.ideas.map((i) => i.id),
            );
          w.reply = {
            ...blank(
              plan.understanding +
                "\n\n" +
                (plan.ideas[0]?.title || "先核对可用物品，再继续规划。"),
              plan.ideas.length ? "answered" : "needs_info",
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
      w.reply =
        (session.known.memoryPolicy !== undefined &&
        !temporary &&
        ctx.persona.memoryUse !== "off"
          ? recallLifeFragments(
              db,
              read(),
              actor,
              w.question,
              effectiveSession.itemId,
            )
          : undefined) ||
        (route &&
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
        curatedDecision(
          w.question,
          effectiveSession,
          ctx,
          session.mode === "auto",
        );
      if (
        !w.reply &&
        ctx.item &&
        operationQuestion(w.question) &&
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
        operationQuestion(w.question)
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
                    appCapabilities: {
                      available: [
                        "手动/照片/扫码录入，型号需确认",
                        "来源资料问答",
                        "目标规划与反馈",
                        "图文故事手动保存",
                        "记忆候选与明确保存",
                        "本机演示家庭与社交礼物",
                      ],
                      unavailable: [
                        "视觉识物尚未启用",
                        "真实家庭账户/跨设备通知",
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
              resources: ctx.resources,
              persona: ctx.persona.enabled ? ctx.persona : undefined,
              prior,
              tried: session.tried,
            }),
          },
        ];
      } else if (w.reply) add(w, "curated_answer", w.reply.outcome);
      return { work: w };
    })
    .addNode("model", async ({ work }) => {
      guard();
      const w = { ...work, trace: [...work.trace] };
      if (w.calls >= 3 || Date.now() - w.started > 45000) {
        w.reply = blank(
          "这次还需要补充资料。我已保留问题，可以说明卡住的地方，或请家人协助。",
          "referred",
        );
        return { work: w };
      }
      try {
        w.calls++;
        add(w, "model_started", `attempt=${w.calls}`);
        const allowedNames: readonly string[] = activeSkill.tools;
        const activeTools = tools.filter(
          (t) =>
            allowedNames.includes(t.function.name) &&
            !(
              w.officialLookup && t.function.name === "fetch_official_knowledge"
            ),
        );
        w.response = provider.complete
          ? await provider.complete(w.messages, activeTools, {
              timeoutMs: Math.max(1, 45000 - (Date.now() - w.started)),
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
      if (w.toolCount + calls.length > 6) {
        w.reply = blank(
          "我还需要更准确的线索。你可以补充型号或描述实际现象，我会接着处理。",
          "needs_info",
        );
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
          const args: { query?: string } = (
            call.function.name === "list_accessible_items"
              ? z.object({}).strict()
              : z.object({ query: z.string().trim().min(1).max(200) }).strict()
          ).parse(JSON.parse(call.function.arguments));
          const query = args.query || "";
          const ctx = buildContext(db, read(), actor, {
            excludeSynthetic: session.known.memoryPolicy !== undefined,
            taskMemoryOnly: !!session.known.uiPage,
            question: query || w.question,
            mode: effectiveSession.mode,
            sessionId: session.id,
            itemId: effectiveSession.itemId,
            temporary,
          });
          trackExpiry(ctx.cloudMemories);
          if (call.function.name === "fetch_official_knowledge") {
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
                  : read()
                      .items.filter(
                        (i) =>
                          canRead(i, actor) &&
                          (ctx.item?.demo ? !!i.demo : !i.demo),
                      )
                      .map((i) => ({
                        name: i.name,
                        state: i.state,
                        demo: !!i.demo,
                      }));
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
          question: session.known.goal || w.question,
          mode: effectiveSession.mode,
          sessionId: session.id,
          itemId: effectiveSession.itemId,
          temporary,
        });
        w.reply = storyPlan
          ? validateStorytelling(w.response!.text, storyPlan)
          : validateModelPacket(
              w.response!.text,
              ctx,
              effectiveSession.mode,
              session.tried,
            );
        w.reply.model = w.response!.model;
        if (!storyPlan) w.reply.memoryIds = ctx.cloudMemories.map((m) => m.id);
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
        } else if (w.calls < 3) {
          w.messages.push(
            { role: "assistant", content: w.response!.text },
            {
              role: "user",
              content:
                "上次输出校验失败：" +
                (error instanceof AgentError ? error.message : "结构无效") +
                "。不要原样重复。去掉未经逐步引用支持的参数/按钮/装配细节，不从另一段借数字。使用grounded，steps每项必须有phase和sourceIds，answer只引导；knowledgeTask.requiredPhases缺少的用gaps说明。已知型号不再询问。",
            },
          );
        } else
          w.reply = blank(
            effectiveSession.itemId
              ? "已保留档案中的型号。本轮回答未通过资料核对，不能给出可靠的专属操作；可补充对应官方资料或描述当前卡住的现象，不必重新提供已确认型号。"
              : "资料还不足以给出适用步骤。请说明当前卡住的现象或必要的适用信息。",
            "needs_info",
          );
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
