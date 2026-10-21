import { canRead, type State, type Person } from "../domain.ts";
import type { ServiceSession } from "../agent/contracts.ts";
import { isStoryNarration } from "../memory/ambient.ts";
import type { HomeRoute } from "./contracts.ts";
import { isMemoryRecallRequest } from "../skills/memory-storytelling.ts";
import { withoutProhibitedActions } from "../agent/safety-language.ts";
import {
  isPreparationGoal,
  isPreparationChange,
} from "../life/task-planning.ts";

export const isStepFollowup = (q: string) =>
  /第[一二三四五六七八九十\d]+步|下一步|接下来|然后呢/.test(q);
export function routeHome(
  question: string,
  state: State,
  actor: Person,
  session: ServiceSession,
): HomeRoute {
  if (session.known.uiPage)
    return routeProductTurn(question, state, actor, session);
  const q = question.trim();
  const visible = state.items.filter((i) => canRead(i, actor));
  const selected = session.itemId
    ? visible.find((i) => i.id === session.itemId)
    : undefined;
  // Only match user-visible item names. Never enumerate hidden names to explain a miss.
  const matches = visible.filter(
    (i) =>
      q.includes(i.name) ||
      (i.name.replace(/^\[示例\]\s*/, "").length >= 2 &&
        q.includes(i.name.replace(/^\[示例\]\s*/, ""))),
  );
  const aliases = matches.length
    ? matches
    : visible.filter((i) => {
        const words = [
          "水壶",
          "书架",
          "边桌",
          "净化器",
          "空气炸锅",
          "吸尘器",
          "推车",
          "台灯",
          "相框",
          "水杯",
          "滤水壶",
        ];
        return words.some((word) => q.includes(word) && i.name.includes(word));
      });
  const namedPhrase = q
    .match(
      /([\p{Script=Han}A-Za-z0-9]{2,}(?:书架|水壶|边桌|台灯|相框|净化器|吸尘器))(?=在哪|怎么|如何|的)/u,
    )?.[1]
    ?.replace(
      /^(?:(?:帮我|请|把|将|找一下|找找|找|我的|家里的|那件|这件))+/u,
      "",
    );
  const unresolvedName =
    !matches.length &&
    namedPhrase &&
    !["书架", "水壶", "边桌", "台灯", "相框", "净化器", "吸尘器"].includes(
      namedPhrase,
    );
  const previous = session.known.activeItemId
    ? visible.find((i) => i.id === session.known.activeItemId && !i.demo)
    : undefined;
  const target =
    selected ||
    (aliases.length === 1
      ? aliases[0]
      : /它|这件|刚才|继续|还是|第一步|第二步/.test(q) || session.known.pending
        ? previous
        : undefined);
  const base = { itemId: target?.id, itemName: target?.name };
  const decision = (
    intent: HomeRoute["intent"],
    mode: HomeRoute["mode"],
    reason: string,
  ): HomeRoute => ({ ...base, intent, mode, reason });
  if (
    !target &&
    session.known.memoryPolicy &&
    !/在哪|位置|有哪些物品|请爸爸|请家人|野餐|郊游|旅行|出游|阅读角|怎么|如何|故障|型号|按钮|设置|承重/.test(
      q,
    )
  )
    return decision(
      "companion",
      "companion",
      "普通交流可不关联物品；仅按本次政策整理候选",
    );
  if (/短接|冒烟|漏电|烧焦|带电.*拆/.test(q))
    return decision("help", "service", "先处理安全与实际现象");
  if (
    isPreparationGoal(q) ||
    (session.known.taskPlanId && isPreparationChange(q))
  )
    return {
      intent: "prepare",
      mode: "service",
      reason: "摄影出游准备，确认后保存并跟踪现实步骤",
    };
  if (
    !selected &&
    (aliases.length > 1 || unresolvedName) &&
    !/野餐|旅行|阅读角|布置|组合/.test(q)
  )
    return {
      intent: "clarify",
      mode: "service",
      reason: "还不能准确确定是哪件物品，请选择",
      candidates: aliases.map((i) => ({ id: i.id, name: i.name })),
    };
  if (
    /在哪|哪里|找一下|找找|位置|有哪些物品/.test(q) &&
    !/^(帮我|请|把|将).*(挪|移|放|搬)/.test(q)
  )
    return decision("locate", "service", "查看用户记录的位置");
  if (!selected && target?.demo)
    return {
      intent: "clarify",
      mode: "service",
      reason: "请点开演示物品，故事会在对应案例内独立保存",
      candidates: [{ id: target.id, name: target.name }],
    };
  if (
    /请爸爸|叫爸爸|提醒爸爸|让爸爸|交给爸爸|请小林|交给小林|请家人|交给家人|让家人/.test(
      q,
    )
  )
    return decision("handoff", "service", "预览家庭事项摘要，不附私人对话");
  if (
    /^(帮我|请|把|将|挪|移动|放到|搬到)/.test(q) &&
    /挪|移|放到|放在|搬到/.test(q)
  )
    return decision("move", "service", "预览位置调整，确认后才保存");
  if (/野餐|郊游|旅行|出游|阅读角/.test(q) && !isPastStory(q))
    return {
      intent: "plan",
      mode: "ideas",
      reason: "结合日常可用物品准备有限场景计划",
    };
  if (/假设|如果|虚构|编一个|编个|帮我写/.test(q))
    return decision("companion", "companion", "想象交流不保存为真实故事");
  if (
    /难过|累了|很累|孤独|陪我|陪陪|心情|想聊|你好|谢谢|晚安/.test(q) &&
    !/毕业|那天|送我|送给|一起挑|以前/.test(q)
  )
    return decision(
      "companion",
      "companion",
      "回应当下感受，不把情绪改写成长期偏好",
    );
  if (
    isStoryNarration(q) &&
    /我|我们|爸爸|妈妈|家人/.test(q) &&
    /今天|昨天|周末|上周|那天|刚刚/.test(q) &&
    /读|看|做|喝|写|坐|用|陪|聊|挑|买|搬|放|送/.test(q) &&
    !/想要|打算|准备|计划/.test(q)
  )
    return decision("story", "story", "记录与当前物品相关的明确日常经历");
  if (
    /^(帮我|请|我想|想|一起|给我).*(布置|整理|安排|规划)/.test(q) ||
    /(怎么|如何).*(布置|整理|安排)/.test(q)
  )
    return {
      intent: "plan",
      mode: "ideas",
      reason: "结合可访问物品提出建议；可保存的场景使用预览卡",
    };
  if (
    /故事|回忆|记得|以前|来历|毕业|搬家|送给|送我的|一起挑/.test(q) ||
    (session.known.lastIntent === "story" && isMemoryRecallRequest(q)) ||
    (isStoryNarration(q) &&
      /我(们)?.*(喜欢|爱好|兴趣|买了|用了|用过|一起|陪|送|挑)/.test(q))
  )
    return decision(
      "story",
      "story",
      target ? "围绕当前物品的真实经历与记忆" : "先选择承载故事的物品",
    );
  if (
    /怎么|如何|不会|故障|坏了|晃|松动|固定|承重|载荷|容量|功率|尺寸|规格|型号|按钮|配对|双击|设置|能不能|使用方法|怎么用|多少|清洁/.test(
      q,
    )
  )
    return decision("help", "service", "核对适用资料与使用条件");
  if (/难过|累了|很累|孤独|陪我|陪陪|心情|想聊|你好|谢谢|晚安/.test(q))
    return decision(
      "companion",
      "companion",
      "回应当下感受，不把情绪改写成长期偏好",
    );
  if (
    session.known.lastIntent === "help" &&
    (session.known.pending ||
      isStepFollowup(q) ||
      /^(还是|仍然|试过|没变化|我已经|已经|windows|win\s*11|11$|原配|有的|是的)/i.test(
        q,
      ))
  )
    return decision("help", "service", "继续上一轮澄清，保留已经尝试的步骤");
  return decision(
    "companion",
    "companion",
    "自然交流；明确的物品经历才进入故事",
  );
}
function isPastStory(q: string) {
  return isStoryNarration(q) && /去年|那年|那天|上次|以前|我们曾|记得/.test(q);
}
/** Page and session scopes come from authorized item IDs, never model guesses. */
export function routeProductTurn(
  question: string,
  state: State,
  actor: Person,
  session: ServiceSession,
): HomeRoute {
  const q = question.trim(),
    items = state.items.filter((i) => canRead(i, actor));
  const named = items.filter((i) => q.includes(i.name));
  const selected = items.find((i) => i.id === session.itemId);
  const previous = items.find((i) => i.id === session.known.activeItemId);
  const companionScope =
    !!selected && session.known.companionItemId === selected.id;
  const target =
    named.length === 1
      ? named[0]
      : selected ||
        (/这个|它|这件|刚才|继续|还是|然后|有的|是的|原配|windows|win11|第.步/.test(
          q,
        ) || session.known.pending
          ? previous
          : undefined);
  const result = (
    intent: HomeRoute["intent"],
    mode: HomeRoute["mode"],
    reason: string,
    scoped = true,
  ): HomeRoute => ({
    intent,
    mode,
    reason,
    itemId: scoped ? target?.id : undefined,
    itemName: scoped ? target?.name : undefined,
  });
  if (target && /说明书|拼搭步骤|操作步骤|使用说明|怎么组装|怎样组装/.test(q))
    return result(
      "help",
      "service",
      "查询当前物品的操作资料，不把“哪里看说明”误判为找位置",
    );
  if (/我知道了|我已知晓/.test(q) && /修好|维修|能用|可以用|状态/.test(q))
    return result("app", "service", "解释提醒知晓与实际维修状态的区别", false);
  if (
    /(?:物间|这个App|这个软件|这款App|应用|app).*(?:怎么用|功能|能做|如何|是什么)|(?:怎么|如何).*(?:录入|添加物品|保存故事|删除记忆|开启千问)|你(?:可以|能)做什么/i.test(
      q,
    )
  )
    return result(
      "app",
      "service",
      "回答当前应用实际功能与入口，不套商品澄清",
      false,
    );
  if (/短接|冒烟|漏电|烧焦|带电.*拆/.test(withoutProhibitedActions(q)))
    return result("help", "service", "安全优先");
  if (
    isPreparationGoal(q) ||
    (session.known.taskPlanId && isPreparationChange(q))
  )
    return result(
      "prepare",
      "service",
      "准备与进度管理，不转为创意活动",
      false,
    );
  if (isMemoryRecallRequest(q))
    return result("story", "story", "按当前授权回忆本人记录");
  if (
    target &&
    /带我|教我|首次清洗|第一次使用|首次使用|如何清洗|清洗|清洁|充电|维护|保养|排障/.test(
      q,
    ) &&
    !isPastStory(q)
  )
    return result("help", "service", "使用已确认物品处理实际操作任务");
  if (
    /压力|焦虑|烦恼|难过|孤独|心情|陪我|想聊|随便聊|聊聊|闲聊|今天很累|工作很累|电影|新闻|聊点别的/.test(
      q,
    ) &&
    !/故障|漏电/.test(q)
  )
    return result(
      "companion",
      "companion",
      "回应这次交流，不强行围绕物品",
      companionScope,
    );
  if (
    isStoryNarration(q) &&
    !isMemoryRecallRequest(q) &&
    /今天|昨天|那天|上周|刚才|买了|用过|送我|我们曾|我(?:很)?喜欢|我的兴趣|我爱好/.test(
      q,
    ) &&
    !/想|打算|准备|计划|希望/.test(q)
  )
    return result(
      "companion",
      "companion",
      "聊天叙述留在本次会话；生活故事需明确保存",
      companionScope,
    );
  if (
    /创意|玩法|新用途|灵感|有趣|组合|继续这个目标|不买东西|不想买|整理桌面|收纳规划|学习计划|学点|出行计划|生活改善|换个方向|更简单|只有这些|不用这件/.test(
      q,
    ) ||
    (session.known.lastIntent === "plan" &&
      /换|更|不要|只有|只用|分钟|小时|试试/.test(q))
  )
    return result("plan", "ideas", "理解目标、检索能力并核对组合条件");
  const known = { ...session.known };
  delete known.uiPage;
  delete known.memoryPolicy;
  return routeHome(q, state, actor, { ...session, itemId: target?.id, known });
}
