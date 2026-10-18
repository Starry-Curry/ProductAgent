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
import { SYSTEM_PROMPT, PROMPT_VERSION, tools } from "./prompts.ts";
import { isStoryNarration } from "../memory/ambient.ts";
import { epoch } from "../memory/store.ts";
import { sessionAccess } from "../repositories/sessions.ts";
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
): AssistantReply | undefined {
  if (unsafe.test(question))
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
    const stories = ctx.memories.filter(
      (m) =>
        m.itemId === session.itemId &&
        (m.kind === "story" || m.kind === "relationship"),
    );
    if (/记得|回忆|以前|聊聊|故事/.test(question) && stories.length)
      return {
        ...blank(
          "关于“" +
            ctx.item?.name +
            (ctx.item?.demo ? "”，案例中记录了：\n" : "”，你留下过：\n") +
            stories.map((m) => m.text).join("\n") +
            "\n可以接着讲它与你的近况。",
          "answered",
          "local-memory",
        ),
        memoryIds: stories.map((m) => m.id),
        caveat: ctx.item?.demo
          ? "合成案例故事或演示中的讲述，不代表真实用户经历。"
          : "引用本人的物品故事；没有生成共同经历。",
      };
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
    /^(还是|仍然|没变化|依然|试过|我试过|第二步|第一步|第三步)/.test(question);
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
    const records = ctx.memories.filter(
      (m) =>
        m.kind === "story" ||
        m.kind === "relationship" ||
        m.kind === "experience",
    );
    if (records.length && /故事|记得|回忆|以前|聊聊|想起/.test(question)) {
      const warm =
        ctx.persona.style === "playful"
          ? "我们翻开这一页小故事吧。"
          : "我们可以从你留下的这段记忆聊起。";
      return {
        ...blank(
          `${ctx.persona.nickname ? ctx.persona.nickname + " · " : ""}${warm}\n${records.map((m) => m.text).join("\n")}\n你现在想起它时，最想留下什么？`,
          "answered",
          "local-memory",
        ),
        memoryIds: records.map((m) => m.id),
        caveat: "来自你的记录，可在记忆中纠正或忘记。",
      };
    }
  }
  if (session.mode === "companion" && !ctx.persona.enabled)
    return {
      ...blank(
        "你可以先在“关于我与记住的事”里开启你喜欢的交流方式，也可以继续使用普通帮助。",
        "needs_info",
      ),
      questions: ["想使用普通帮助，还是开启可选陪伴？"],
    };
  if (session.mode === "ideas") {
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
    return blank("我在。想先解决一件物品的使用问题，还是聊聊最近留下的故事？");
  if (
    !pack &&
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
): AssistantReply {
  const packet = packetSchema.parse(JSON.parse(text));
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
    hazardousActions.test(actionable) ||
    deviceClaims.test(actionable) ||
    questionsUnsafe
  )
    throw new AgentError("输出包含未核实的操作、状态或共同经历");
  if (packet.kind === "general" && ctx.knowledge.facts.length)
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
        : "一般帮助，请对照当前条件；未验证实物状态。",
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
  const activeSkill =
    skills[
      session.mode === "story"
        ? "item-story"
        : session.mode === "companion"
          ? "companion"
          : session.mode === "ideas"
            ? "evidence-discovery"
            : "item-help"
    ];
  const allowedNames: readonly string[] = activeSkill.tools;
  const activeTools = tools.filter((t) =>
    allowedNames.includes(t.function.name),
  );
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
    .addNode("prepare", async ({ work }) => {
      guard();
      const w = { ...work, session, trace: [...work.trace] };
      const ctx = buildContext(db, read(), actor, {
        question: w.question,
        mode: session.mode,
        sessionId: session.id,
        itemId: session.itemId,
        temporary,
      });
      const skill = activeSkill;
      trackExpiry(ctx.memories);
      add(w, "skill_selected", `${skill.goal}; version=${skill.version}`);
      add(
        w,
        "context_ready",
        `purpose=${session.mode}; memoryRefs=${ctx.cloudMemories.map((m) => m.id).join(",")}; prompt=${PROMPT_VERSION}`,
      );
      w.reply = curatedDecision(w.question, session, ctx);
      if (!w.reply) {
        const prior = session.messages
          .filter((m) => m.role === "feedback")
          .slice(-3)
          .map((m) => ({ role: m.role, text: m.text.slice(0, 500) }));
        w.messages = [
          {
            role: "system",
            content:
              SYSTEM_PROMPT +
              "\n本次任务：" +
              skill.goal +
              "\n" +
              skill.instructions,
          },
          {
            role: "user",
            content: JSON.stringify({
              question: w.question,
              goal: session.known.goal,
              mode: session.mode,
              item: ctx.item
                ? { name: ctx.item.name, model: ctx.item.model }
                : null,
              evidence: ctx.knowledge,
              memories: ctx.cloudMemories.map((m) => ({
                id: m.id,
                kind: m.kind,
                text: m.text,
              })),
              preferences: ctx.cloudPreferences,
              persona: session.mode === "companion" ? ctx.persona : undefined,
              prior,
              tried: session.tried,
            }),
          },
        ];
      } else add(w, "curated_answer", w.reply.outcome);
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
        w.response = provider.complete
          ? await provider.complete(w.messages, activeTools, {
              timeoutMs: Math.max(1, 45000 - (Date.now() - w.started)),
            })
          : {
              ...(await provider.generate(
                SYSTEM_PROMPT,
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
      } catch (error) {
        if (error instanceof AgentError) throw error;
        const e =
          error instanceof ProviderError
            ? error
            : new ProviderError("internal", "暂时无法生成可靠回答。");
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
          const allowed: readonly string[] =
            skills[
              session.mode === "companion"
                ? "companion"
                : session.mode === "ideas"
                  ? "evidence-discovery"
                  : "item-help"
            ].tools;
          if (!allowed.includes(call.function.name))
            throw new AgentError("本任务未开放此工具");
          const args: { query?: string } = (
            call.function.name === "list_accessible_items"
              ? z.object({}).strict()
              : z.object({ query: z.string().trim().min(1).max(200) }).strict()
          ).parse(JSON.parse(call.function.arguments));
          const query = args.query || "";
          const ctx = buildContext(db, read(), actor, {
            question: query || w.question,
            mode: session.mode,
            sessionId: session.id,
            itemId: session.itemId,
            temporary,
          });
          trackExpiry(ctx.cloudMemories);
          value =
            call.function.name === "search_product_knowledge"
              ? relevantKnowledge(query || w.question, ctx.knowledge.pack)
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
          question: session.known.goal || w.question,
          mode: session.mode,
          sessionId: session.id,
          itemId: session.itemId,
          temporary,
        });
        w.reply = validateModelPacket(w.response!.text, ctx, session.mode);
        w.reply.model = w.response!.model;
        w.reply.memoryIds = ctx.cloudMemories.map((m) => m.id);
        add(w, "validated", w.reply.outcome);
      } catch {
        add(w, "validation_failed", "schema_or_support");
        if (w.calls < 3) {
          w.messages.push(
            { role: "assistant", content: w.response!.text },
            {
              role: "user",
              content:
                "上次输出未满足结构或证据要求。请仅使用相关证据ID；资料不足请给出 needs_info 或 referred，不补造操作。输出约定 JSON。",
            },
          );
        } else
          w.reply = blank(
            "资料还不足以给出适用步骤。请补充具体型号、系统或你看到的现象，我会继续核对。",
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
    .addEdge(START, "prepare")
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
    .addEdge("wait", "prepare")
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
        "model" | "tools" | "__start__" | "prepare" | "validate" | "wait"
      >({ resume: { question } })
    : { work: fresh(question) };
  try {
    const result = await graph.invoke(input, { ...config, durability: "sync" });
    guard();
    const w = result.work;
    return {
      reply: w.reply!,
      trace: w.trace,
      tokens: w.tokens,
      modelCalls: w.calls,
    };
  } catch (error) {
    await saver.deleteThread(actor + ":" + session.id);
    throw error;
  }
}
