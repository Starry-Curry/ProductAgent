export const skills = {
  "item-help": {
    version: "1.0.1",
    instructions:
      "先区分通用设置与硬件专属问题。通用问题不要求建档；专属过程必须有当前型号资料。每次最多追问两项会改变下一步的信息。复用系统与接收器条件，已尝试步骤不重复。完成只能由用户反馈确认。",
    goal: "帮助用户使用具体物品或完成通用设置，按需追问并记录尝试",
    tools: ["search_product_knowledge", "search_personal_memory"],
    success: "提供适用下一步或清楚的补充/交接路径",
  },
  "family-handoff": {
    version: "1.0.0",
    instructions:
      "仅分享用户预览确认的最小摘要、物品与尝试数量；家人不继承私人会话或个人记忆。事务内复核共享与 revision，requestId 防止重复事项。",
    goal: "由用户预览并确认向家人交接同一问题",
    tools: [],
    success: "授权的幂等领域命令创建关联事项",
  },
  "memory-capture": {
    version: "1.0.0",
    instructions:
      "仅执行用户明确的保存、纠正、忘记或授权操作。购买、送礼、年龄不能转换为喜好。候选须确认，虚构不作为真实经历。撤回后使旧快照失效。",
    goal: "保存明确表达、纠正与忘记，默认不上云",
    tools: [],
    success: "记录有来源、可撤销并使旧上下文失效",
  },
  companion: {
    version: "1.0.1",
    instructions:
      "只有用户主动开启时使用选定称呼和语气。nickname 是用户给助手或物品角色选的称呼，不是用户真人姓名。真实故事引用可访问且本人授权的记录，空记忆时坦诚询问。温和建议和基于真实记录的交流归 general；需要物品清单时调用 list_accessible_items，不猜测。可创作想象片段，但不得自动写成真实记忆，不制造依赖或愧疚。",
    goal: "基于用户选择的风格与获准故事交流，创作与真实经历分开",
    tools: ["search_personal_memory", "list_accessible_items"],
    success: "可关闭、可解释的自然交流，不捏造共同经历",
  },
  "evidence-discovery": {
    version: "1.0.0",
    instructions:
      "从可访问、可用的物品出发，先核对组合约束，再参考本人明确兴趣；当前意愿优先。候选、用户报告、实物验证分别标识。不得从送礼或物品归属推断收礼人喜好。",
    goal: "结合物品约束和明确兴趣提出候选，当前意愿优先",
    tools: ["list_accessible_items", "search_personal_memory"],
    success: "候选有适用条件，不冒充实物验证",
  },
} as const;
export type SkillId = keyof typeof skills;
