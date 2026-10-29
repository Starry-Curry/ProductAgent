import { STORYTELLING_INSTRUCTIONS } from "./memory-storytelling.ts";
export const skills = {
  "task-preparation": {
    version: "1.0.0",
    instructions:
      "先区分真实持有与当前可用。摄影出游使用有限本地准备规则，生成可确认的计划；不自动执行或标记现实完成。变化保留已有报告，重新核对受影响依赖。",
    goal: "保存并跟踪摄影出游准备",
    tools: [],
    success: "本人确认保存、逐项报告、刷新恢复，变化可追溯",
  },
  "document-help": {
    version: "1.0.0",
    goal: "从当前型号/地区官方文档提出可执行下一步，结合已尝试反馈继续",
    instructions:
      "已有officialDocuments时组织可完成任务的操作/清洁/维护流程。knowledgeTask.full时按requiredPhases覆盖相应阶段，每步填phase、sourceIds和sourceQuote（逐字摘录对应原文），相关前置条件、警告放在对应步骤。使用knowledgeTask.phaseLabels对应任务语义，充电不写开机；一条步骤只包含有原文支持的操作，功能/限制不能凭同类产品补充。依据内容决定长度，不为凑字数补充材质后果、化学品、工具、固件或五金细节。清洁仅有湿布/干布原文时就给两步，不扩写完整电器流程；用户只问下一步时给1-3步。只有完整首次烹饪任务才按证据覆盖准备到结束；不写段号、页码，不把原文offset当页码。不写等待几分钟/默认状态/咔嗒提示等无引用内容。只有必要时最后问一次食材，以便继续选用对应食谱，不能自定食品时温。资料不足的阶段写gaps，不造时温或食品熟度。answer只引导，不重复steps；可返回最多10步grounded。tried和completedSteps是用户已完成的具体操作，不表示整个阶段都完成。用户问下一步时先接续尚未完成的操作，不重述已完成的清洗；已完成条件只作前置事实，不再反复要求品牌型号。不因正文说明‘用户已经做过’误当助手执行。",
    tools: ["search_product_knowledge", "fetch_official_knowledge"],
    success: "有可追溯步骤，或说明具体资料缺口，不重复已确认信息",
  },
  "memory-storytelling": {
    version: "1.0.0",
    instructions: STORYTELLING_INSTRUCTIONS,
    goal: "从有来源的记忆中选取相关片段，组织自然、有物品特色的故事回应",
    tools: [],
    success: "自然连贯、来源可追溯，不编经历、不把历史要求当成当前动作",
  },
  "item-help": {
    version: "1.0.1",
    instructions:
      "先区分通用设置与硬件专属问题。通用问题不要求建档；专属过程必须有当前型号资料。每次最多追问两项会改变下一步的信息。复用系统与接收器条件，已尝试步骤不重复。完成只能由用户反馈确认。",
    goal: "帮助用户使用具体物品或完成通用设置，按需追问并记录尝试",
    tools: [
      "list_accessible_items",
      "read_item_context",
      "search_product_knowledge",
      "fetch_official_knowledge",
      "search_personal_memory",
    ],
    success: "提供适用下一步或清楚的补充/交接路径",
  },
  "item-story": {
    version: "1.1.0",
    instructions:
      "围绕当前具体物品回应本人真实叙述，原始故事与派生记忆分别保留。回忆由 memory-storytelling 组织语言，不逐条列出检索原文；不捏造共同经历，不追问画像字段，不自动共享给家人或收礼者。私人片段本地组织，只有逐条获准的片段可交给模型；不宣称未经提交的业务操作已经完成。",
    goal: "以人与物讲述故事的窗口逐步理解用户和关系",
    tools: [],
    success: "故事绑定真实 Item、本人作者与来源，可追溯可控制",
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
    version: "1.1.0",
    instructions:
      "以本人对具体物品的真实故事为主要来源；从正常聊天、持有登记、尝试和反馈静默提取。不同来源分别保留；购买、送礼、年龄不转换为喜好。临时提问和暂停期间不采集。当前要求有范围和期限；纠正与忘记优先，阻止历史复活。默认不上云。",
    goal: "低负担、有来源、可纠正和忘记的静默记忆",
    tools: [],
    success: "记录有来源、可撤销并使旧上下文失效",
  },
  companion: {
    version: "1.0.1",
    instructions:
      "只有用户主动开启时使用选定称呼和语气。nickname 是用户给助手或物品角色选的称呼，不是用户真人姓名。真实故事引用可访问且本人授权的记录，空记忆时坦诚询问。温和建议和基于真实记录的交流归 general；需要物品清单时调用 list_accessible_items，不猜测。可创作想象片段，但不得自动写成真实记忆，不制造依赖或愧疚。",
    goal: "基于用户选择的风格与获准故事交流，创作与真实经历分开",
    tools: [
      "search_personal_memory",
      "list_accessible_items",
      "read_item_context",
    ],
    success: "可关闭、可解释的自然交流，不捏造共同经历",
  },
  "evidence-discovery": {
    version: "1.0.0",
    instructions:
      "从可访问、可用的物品出发，先核对组合约束，再参考本人明确兴趣；当前意愿优先。候选、用户报告、实物验证分别标识。不得从送礼或物品归属推断收礼人喜好。",
    goal: "结合物品约束和明确兴趣提出候选，当前意愿优先",
    tools: [
      "list_accessible_items",
      "read_item_context",
      "search_personal_memory",
    ],
    success: "候选有适用条件，不冒充实物验证",
  },
} as const;
export type SkillId = keyof typeof skills;
