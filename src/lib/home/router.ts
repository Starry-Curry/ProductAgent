import { canRead, type State, type Person } from "../domain.ts";
import type { ServiceSession } from "../agent/contracts.ts";
import { isStoryNarration } from "../memory/ambient.ts";
import type { HomeRoute } from "./contracts.ts";
import { isMemoryRecallRequest } from "../skills/memory-storytelling.ts";

export function routeHome(
  question: string,
  state: State,
  actor: Person,
  session: ServiceSession,
): HomeRoute {
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
  if (/短接|冒烟|漏电|烧焦|带电.*拆/.test(q))
    return decision("help", "service", "先处理安全与实际现象");
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
      /^(还是|仍然|试过|没变化|windows|win\s*11|11$|原配|有的|是的)/i.test(q))
  )
    return decision("help", "service", "继续上一轮澄清，保留已经尝试的步骤");
  return decision(
    "companion",
    "companion",
    "自然交流；明确的物品经历才进入故事",
  );
}
function isPastStory(q: string) {
  return (
    isStoryNarration(q) && /去年|那年|那天|上次|以前|第一次|我们曾|记得/.test(q)
  );
}
