import { executeHomeTask } from "./home-task.ts";
import { executePractical } from "./practical.ts";
import { isPreparationChange } from "../life/task-planning.ts";
import { hazardousActions,hasReportedCriticalHazard,criticalHazardGuidance,withoutProhibitedActions,withoutFileSelectionGestures } from "./safety-language.ts";
import { reportedItemHazard } from '../life/availability.ts';
import { authorize } from '../foundation/policy.ts';
import { itemContext } from "../context/items.ts";
import { itemAdviceIssues } from "../context/item-advice.ts";
import { groundedReply } from "../skills/document-help.ts";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { canRead, ideas, type State, type Person } from "../domain.ts";
import type { Provider } from "../ai/provider.ts";
import { AgentError,type AssistantReply,type ServiceSession,type Trace } from "./contracts.ts";
import { buildContext } from "../context/builder.ts";
import { windowsMouse,mouseSetup,procedureReply,relevantKnowledge,topics } from "../skills/knowledge.ts";
import { planMemoryStory,localMemoryStory,canComposeInCloud,isMemoryRecallRequest,STORYTELLING_VERSION } from "../skills/memory-storytelling.ts";
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
  // The general label is not an escape hatch for unsupported item-specific facts.
  // Only the scoped product-help path is closed here; ordinary companion/chat,
  // local guidance and source-checked replies retain their existing behavior.
  if (packet.kind === "general" && mode === "service" && ctx.productConversation &&
      ctx.item && ctx.externalKnowledge.length) {
    return {...blank("这份答复没有可核对的型号依据，因此没有作为商品事实展示。资料未提及不等于支持或不支持；可查看现有来源，或补充适用型号与地区的官方资料。","needs_info"),
      citations:[...new Map(ctx.externalKnowledge.map(d=>[d.url,{id:d.documentId,title:d.title,url:d.url,kind:"official" as const}])).values()],
      caveat:"型号帮助的自由事实综合仍未通过质量门禁；不会用general标签绕过核对。"};
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
/** Domain routing and offline guidance only. All general online model/tool
 * turns belong to executePractical; legacy environment flags cannot revive the
 * retired complete/generate/repair graph. Session persistence remains in service. */
export async function executeGraph(
 db:DatabaseSync,read:()=>State,actor:Person,session:ServiceSession,
 question:string,provider:Provider,temporary=false,
){
 const trace:Trace[]=[];
 const add=(stage:string,detail:string)=>trace.push({stage,detail,at:new Date().toISOString()});
 const result=(reply:AssistantReply)=>({reply:route?{...reply,route}:reply,trace,tokens:null,modelCalls:0});
 const guard=()=>{
  if(epoch(db,actor)!==session.memoryEpoch||!sessionAccess(session,read(),actor))throw new AgentError('物品或记忆授权已改变，请重新开始',409);
  if(!temporary){const row=db.prepare('SELECT revision,body FROM agent_sessions WHERE id=?').get(session.id) as {revision:number;body:string}|undefined;
   if(!row||row.revision!==session.revision||JSON.parse(row.body).status==='closed')throw new AgentError('会话已更新，请重新打开',409);
  }
  const id=session.itemId||session.known.activeItemId;
  if(id&&!authorize(db,read(),actor,id).allowed)throw new AgentError('物品不存在或未获授权',403);
 };
 guard();
 let route:HomeRoute|undefined,storyHint=false;
 const safetyState=read(),safetyItem=safetyState.items.find(i=>i.id===(session.itemId||session.known.activeItemId)&&canRead(i,actor)&&authorize(db,safetyState,actor,i.id).allowed);
 if(hasReportedCriticalHazard(question)||unsafe.test(withoutProhibitedActions(question))||safetyItem&&reportedItemHazard(safetyItem)){
  add('reported_hazard_restricted','Deterministic restriction; no provider request or external action');
  return result({...blank(criticalHazardGuidance,'blocked'),caveat:'基于用户报告采取预防限制，不是设备诊断或实体处置。'});
 }
 const continuingPreparation=session.mode==='auto'&&!!session.known.taskPlanId&&isPreparationChange(question);
 if(!continuingPreparation&&(session.known.homeId==='young-apartment-v1'||session.known.foundationTaskId&&session.known.foundationHasItems==='true'&&session.known.foundationComplexTask==='true'&&session.known.uiPage))
  return executeHomeTask(db,read,actor,session,question,provider,temporary);
 if(session.mode==='auto'){
  route=routeHome(question,read(),actor,session);
  // A keyword classifier is not consent to record a story. In unified chat its
  // story hint stays conversational; only the explicit story mode may trigger
  // commitTurn's existing raw-story write. The Agent can prepare a confirmation.
  if(route.intent==='story'){storyHint=true;route={...route,intent:'help',mode:'service'};}
  const turnScope=route.itemId||'home';
  if(session.known.turnScope&&session.known.turnScope!==turnScope){
   for(const key of ['goal','pending','os','originalReceiver','lastOutcome','unresolvedReason'])delete session.known[key];session.tried=[];
  }
  session.known.turnScope=turnScope;
  if(session.known.lastIntent!==route.intent){delete session.known.goal;delete session.known.pending;}
  session.known.lastIntent=route.intent;
  if(route.itemId){const item=read().items.find(i=>i.id===route!.itemId&&authorize(db,read(),actor,i.id).allowed);
   if(item){session.itemScopes={...session.itemScopes,[item.id]:itemStamp(item)};if(!item.demo)session.known.activeItemId=item.id;}
  }
  add('intent_routed',route.intent+'; target='+(route.itemId||'home')+'; domain metadata, not a model answer');
 }
 const effectiveSession=route?{...session,itemId:route.itemId,mode:route.mode}:session;
 if(session.known.interfaceMode==='care'&&route&&['prepare','plan','move','handoff'].includes(route.intent))
  return result(blank('这项计划或管理操作可以切换到右上角的普通版继续。大字关怀版里，你可以问物品怎么用，或查看家人交代的事。','answered','local-dialogue'));
 // These are existing deterministic domain previews/queries, not knowledge
 // shortcuts. Ordinary help/creative/mixed goals never terminate here online.
 if(route&&['prepare','move','handoff'].includes(route.intent)){
  const reply=homeDecision(db,read(),actor,session,question,route,temporary);
  if(reply){guard();add('domain_decision',route.intent+'; explicit confirmation still required for writes');return result(reply);}
 }
 const ctx=buildContext(db,read(),actor,{question,mode:effectiveSession.mode,itemId:effectiveSession.itemId,sessionId:session.id,temporary,excludeSynthetic:session.known.memoryPolicy!==undefined,
  taskMemoryOnly:!!session.known.uiPage,includeItemRelationships:session.known.useItemMemories==='yes',companion:session.known.uiPage?!!session.known.companionItemId:undefined});
 const storyPlan=planMemoryStory(ctx,(storyHint||isMemoryRecallRequest(question))&&!isStoryNarration(question)?{...effectiveSession,mode:'story'}:effectiveSession);
 if(storyPlan&&(!provider.ready||!provider.converse||session.mode==='story'&&!canComposeInCloud(storyPlan))){
  add('skill_selected','组织自然故事; '+STORYTELLING_VERSION);add('memory_story_composition','local-private-or-provider-unavailable');
  return result(localMemoryStory(storyPlan));
 }
 // Story input is kept as the user's original words by commitTurn. A private
 // narrative is not sent to the model merely because general chat is enabled.
 if(effectiveSession.mode==='story'&&isStoryNarration(question)){
  const reply=curatedDecision(question,effectiveSession,ctx,false);
  if(reply){add('local_story_record','Original user input only; no model-generated story write');return result(reply);}
 }
 if(provider.ready&&provider.converse){
  const execution=await executePractical(db,read,actor,session,question,provider,temporary);
  return {...execution,reply:route?{...execution.reply,route}:execution.reply,trace:[...trace,...execution.trace]};
 }
 // Genuine local records/curated instructions remain usable offline. No
 // generate-only provider, complete-only provider or environment flag starts a
 // second general executor or claims that the model answered.
 const localRecall=!temporary&&ctx.persona.memoryUse!=='off'?recallLifeFragments(db,read(),actor,question,effectiveSession.itemId):undefined;
 const reply=localRecall||(route&&homeDecision(db,read(),actor,session,question,route,temporary))||
  (effectiveSession.itemId&&effectiveSession.mode==='service'?sourceReply(db,read(),actor,effectiveSession.itemId,question,!ctx.knowledge.facts.length):undefined)||
  curatedDecision(question,effectiveSession,ctx,session.mode==='auto',false);
 if(reply){guard();add('curated_answer',reply.outcome+'; zero model requests');return result(reply);}
 if(route?.intent==='companion')return result({...blank('我在这里，可以继续说说。当前是本地简短回应；云端 AI 尚未开启。','answered','local-dialogue'),caveat:'本地简短回应；没有读取未授权的历史记忆。'});
 add('provider_unavailable','converse interface not configured; retired runtime cannot be re-enabled');
 return result({...blank('当前模型工具接口尚未可用，未生成模型回答。已有物品、资料和私人记录仍保留，请稍后继续。','unavailable','local-dialogue'),errorCode:'not_configured'});
}
