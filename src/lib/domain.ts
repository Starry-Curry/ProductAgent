import { findPack } from "./products.ts";
export type Person = "lin" | "dad" | "friend";
export const people: Record<Person, string> = {
  lin: "小林",
  dad: "爸爸",
  friend: "小夏",
};
export type Item = {
  brand?: string;
  lifecycle?: "一次性" | "消耗型" | "可重复使用" | "长期耐用" | "持续养护";
  attributes?: { material?: string; dimensions?: string; power?: string; care?: string; quantity?: number; quantityUnit?: string; expiresOn?: string; capabilities?: string[] };
  availability?: "unknown" | "available" | "loaned" | "gifted" | "lost" | "broken" | "consumed";
  availabilityAt?: string;
  synthetic?: boolean;
  demo?: {
    caseId: string;
    title: string;
    summary: string;
    questions: string[];
  };
  id: string;
  name: string;
  category: string;
  model: string;
  location: string;
  owner: Person;
  shared: boolean;
  state: string;
  icon: string;
  photo?: string;
  note: string;
  source: string;
  maintenance?: string;
  cycle?: number;
  supportUrl?: string;
  productBinding?: {
    packId: string;
    version: string;
    confirmedBy: Person;
    confirmedAt: string;
  };
};
export type Task = {
  serviceContext?: {
    sourceSessionId: string;
    sourceRevision: number;
    summary: string;
    attemptedSteps: number;
  };
  id: string;
  itemId: string;
  title: string;
  assignee: Person;
  status: string;
  kind?: "repair" | "clean" | "purchase" | "notice" | "help";
  acknowledged?: boolean;
  requestId?: string;
  createdBy?: Person;
  logs: { by: Person; text: string; at: string }[];
};
export type Memory = {
  giftSnapshot?: boolean;
  demo?: boolean;
  sourceSessionId?: string;
  id: string;
  itemId: string;
  author: Person | null;
  owner?: Person;
  origin?: {
    memoryId: string | null;
    giftId: string;
    at: string | null;
    attribution: "known" | "legacy-unknown";
  };
  text: string;
  at: string;
  shared: boolean;
};
export type Gift = {
  id: string;
  itemId: string;
  sender: Person;
  token: string;
  message: string;
  nickname: string;
  stories: string[];
  storySnapshots?: {
    memoryId: string | null;
    author: Person | null;
    text: string;
    at: string | null;
  }[];
  claimedAt?: string;
  includeKnowledge: boolean;
  itemName: string;
  claimedBy?: Person;
  revoked: boolean;
};
export type Care = {
  consent: boolean;
  paused: boolean;
  away: boolean;
  offline: boolean;
  signal: "normal" | "missing";
  recipient: Person;
};
export type Plan = {
  id: string;
  actor: Person;
  goal: string;
  itemIds: string[];
  at: string;
  checklist?: { label: string; status: string }[];
};
export type ContextFact = {
  owner: Person;
  key: "instructionStyle" | "skillLevel";
  value: string | null;
  status: "explicit" | "inferred" | "unknown";
  source: "user" | "system";
  updatedAt: string;
  allowCloud: boolean;
};
export type State = {
  contexts?: ContextFact[];
  plans?: Plan[];
  items: Item[];
  tasks: Task[];
  memories: Memory[];
  gifts: Gift[];
  saved: Record<Person, string[]>;
  attempts: {
    id: string;
    actor: Person;
    ideaId: string;
    itemIds: string[];
    text: string;
    at: string;
  }[];
  care: Care;
};
export function canRead(item: Item, actor: Person) {
  return item.owner === actor || (item.shared && actor !== "friend");
}
export function careMessage(c: Care) {
  if (!c.consent) return "尚未授权，不评估使用信号";
  if (c.paused) return "监测已暂停";
  if (c.away) return "已设置外出，暂不产生关怀提醒";
  if (c.offline) return "设备离线，无法判断是否使用，请先确认连接";
  return c.signal === "missing"
    ? "示例设备缺少预期使用记录，可温和询问近况；这不代表健康或安全异常"
    : "示例信号正常，无需提醒";
}
export function seed(): State {
  return {
    items: [
      {
        id: "lamp",
        name: "书桌上的台灯",
        category: "日常家居",
        model: "示例台灯 · 型号待确认",
        location: "书房",
        owner: "lin",
        shared: true,
        state: "在用",
        icon: "lamp",
        note: "晚上看书和做手工时用。",
        source: "示例数据",
      },
      {
        id: "frame",
        name: "木质相框",
        category: "手工与收藏",
        model: "无品牌",
        location: "书房",
        owner: "lin",
        shared: false,
        state: "在用",
        icon: "frame",
        note: "留给下一件自己的作品。",
        source: "示例数据",
      },
      {
        id: "beads",
        name: "彩色拼豆材料",
        category: "手工与收藏",
        model: "材料包",
        location: "收纳柜",
        owner: "lin",
        shared: true,
        state: "待确认",
        icon: "beads",
        note: "余量和材料适用条件需要使用前确认。",
        source: "示例数据",
      },
      {
        id: "filter",
        name: "家里的净水器",
        category: "家用电器",
        model: "示例设备 · 未绑定真实型号",
        location: "厨房",
        owner: "dad",
        shared: true,
        state: "在用",
        icon: "filter",
        note: "维护周期是演示设置，不是厂家建议。",
        source: "示例数据",
        maintenance: "2026-07-01",
        cycle: 90,
      },
      {
        id: "cup",
        name: "随行保温杯",
        category: "出行用品",
        model: "500ml · 用户录入",
        location: "玄关",
        owner: "lin",
        shared: true,
        state: "在用",
        icon: "cup",
        note: "出门前确认清洁与密封。",
        source: "示例数据",
      },
    ],
    tasks: [
      {
        id: "task-filter",
        itemId: "filter",
        title: "核实净水器维护时间与滤芯型号",
        assignee: "lin",
        status: "待处理",
        logs: [
          {
            by: "dad",
            text: "先核实具体型号和官方说明，再决定是否更换。",
            at: "2026-10-15",
          },
        ],
      },
    ],
    memories: [
      {
        id: "memory-frame",
        itemId: "frame",
        author: "lin",
        text: "想把一起做的小作品装进这个相框。",
        at: "2026-10-15",
        shared: false,
      },
    ],
    gifts: [],
    saved: { lin: [], dad: [], friend: [] },
    attempts: [],
    care: {
      consent: false,
      paused: false,
      away: false,
      offline: false,
      signal: "normal",
      recipient: "lin",
    },
  };
}
export const ideas = [
  {
    id: "light",
    title: "给心爱的小物，拍一张生活照",
    subtitle: "台灯 × 相框",
    items: ["lamp", "frame"],
    time: "15 分钟",
    kind: "任务组合",
    description:
      "用相框安排画面层次，借助台灯现有照明，为小物拍照。保持散热，不覆盖灯具，不改装电气部分。",
    steps: [
      "确认灯具完好，周围留出散热空间",
      "摆放相框与小物，避免遮挡灯具",
      "调整拍摄角度，使用手机拍照",
    ],
    conditions: "需要手机；台灯可正常使用；相框摆放稳定。",
  },
  {
    id: "art",
    title: "把小小的灵感，装进相框",
    subtitle: "拼豆材料 × 木质相框",
    items: ["beads", "frame"],
    time: "30 分钟",
    kind: "创意候选",
    description:
      "先用材料试排图案并拍照，选择喜欢的构图。材料固定、加热与装框需要另行确认说明，本方案不提供未核实的加热步骤。",
    steps: [
      "检查材料余量和相框内尺寸",
      "在平面上试排图案，拍照记录",
      "按材料官方要求确认固定方法，未确认前仅保留构图",
    ],
    conditions: "确认尺寸、材料说明与固定方法；儿童操作需适当照看。",
  },
];
export const guidance = [
  "核对物品铭牌、型号及资料版本；未匹配资料时不推断专属步骤。",
  "描述现在看到的状态；如有异味、冒烟、漏电等风险，停止使用并寻求专业帮助。",
  "只执行已经核实、无需拆机的操作；找不到对应按钮时暂停，补充型号或照片。",
  "记录尝试结果；仍未解决时生成家庭协助事项，保留上下文。",
];
export function visible(s: State, a: Person) {
  const items = s.items.filter((i) => canRead(i, a));
  const ids = new Set(items.map((i) => i.id));
  return {
    ...s,
    contexts: (s.contexts || []).filter((c) => c.owner === a),
    plans: (s.plans || []).filter((p) => p.actor === a),
    items,
    tasks: s.tasks.filter(
      (t) =>
        a !== "friend" &&
        (!t.itemId ||
          (ids.has(t.itemId) &&
            items.some((i) => i.id === t.itemId && i.shared))),
    ),
    memories: s.memories.filter(
      (m) => (m.owner ?? m.author) === a || (m.shared && ids.has(m.itemId)),
    ),
    gifts: s.gifts.filter((g) => g.sender === a || g.claimedBy === a),
    saved: { [a]: s.saved[a] },
    attempts: s.attempts.filter((t) => t.actor === a),
    care: a === "friend" ? null : s.care,
  };
}
export function mutate(
  s: State,
  a: Person,
  action: string,
  p: Record<string, any>,
): State {
  const id = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const fail = (m: string): never => {
    throw new Error(m);
  };
  const str = (v: unknown, max = 2000) =>
    typeof v === "string" ? v.trim().slice(0, max) : "";
  const get = (key: string) => {
    const item = s.items.find((i) => i.id === key);
    if (!item || !canRead(item, a)) return fail("物品不存在或未获授权");
    return item;
  };
  if (action === "setContext") {
    if (p.owner && p.owner !== a) fail("不能修改其他成员的个人 Context");
    const allowed: Record<string, string[]> = {
      instructionStyle: ["short", "detailed"],
      skillLevel: ["beginner", "experienced"],
    };
    if (!allowed[p.key]) fail("不支持的偏好字段");
    if (p.value !== null && !allowed[p.key].includes(p.value))
      fail("偏好值无效");
    s.contexts = (s.contexts || []).filter(
      (c) => !(c.owner === a && c.key === p.key),
    );
    s.contexts.push({
      owner: a,
      key: p.key,
      value: p.value,
      status: p.value === null ? "unknown" : "explicit",
      source: "user",
      updatedAt: now(),
      allowCloud: p.allowCloud === true,
    });
  } else if (action === "createItem") {
    const name = str(p.name, 80);
    if (!name) fail("请填写物品名称");
    s.items.push({
      id: id(),
      name,
      category: str(p.category, 40) || "其他",
      model: str(p.model, 100) || "待确认",
      location: str(p.location, 80) || "未设置",
      owner: a,
      shared: false,
      state: "在用",
      icon: "box",
      note: str(p.note),
      source: "用户录入",
      brand: str(p.brand, 80),
      lifecycle: ["一次性", "消耗型", "可重复使用", "长期耐用", "持续养护"].includes(p.lifecycle) ? p.lifecycle : "长期耐用",
      availability: "unknown",
      photo:
        typeof p.photo === "string" &&
        /^data:image\/(png|jpeg|webp);base64,/.test(p.photo) &&
        p.photo.length < 1500000
          ? p.photo
          : undefined,
    });
  } else if (action === "bindProduct") {
    const item = get(p.itemId);
    if (item.owner !== a) fail("仅所有者可确认具体型号");
    const pack = typeof p.packId === "string" ? findPack(p.packId) : undefined;
    if (!pack || p.confirmed !== true) fail("请核对实物铭牌并明确确认型号");
    if (
      item.productBinding?.packId !== pack!.id ||
      item.productBinding?.version !== pack!.version ||
      item.model !== pack!.model
    ) {
      item.model = pack!.model;
      item.productBinding = {
        packId: pack!.id,
        version: pack!.version,
        confirmedBy: a,
        confirmedAt: now(),
      };
    }
  } else if (action === "updateItem") {
    const item = get(p.itemId);
    if (item.owner !== a) fail("仅所有者可修改归属信息与共享范围");
    if (typeof p.supportUrl === "string") {
      const value = str(p.supportUrl, 1000);
      if (value) {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          return fail("请填写完整的 HTTPS 售后链接");
        }
        if (url.protocol !== "https:" || url.username || url.password)
          fail("仅支持不含账号密码的 HTTPS 售后链接");
      }
      item.supportUrl = value || undefined;
    }
    if (
      typeof p.model === "string" &&
      str(p.model) &&
      str(p.model) !== item.model
    )
      delete item.productBinding;
    for (const k of ["name", "location", "model", "note", "state"] as const) {
      if (typeof p[k] === "string" && str(p[k])) item[k] = str(p[k]);
    }
    if (typeof p.shared === "boolean") item.shared = p.shared;
    if (typeof p.brand === "string") item.brand = str(p.brand, 80);
    if (["一次性", "消耗型", "可重复使用", "长期耐用", "持续养护"].includes(p.lifecycle)) item.lifecycle = p.lifecycle;
    if (["unknown", "available", "loaned", "gifted", "lost", "broken", "consumed"].includes(p.availability)) {
      item.availability = p.availability;
      item.availabilityAt = now();
      item.state = ({ unknown: "待确认", available: "在用", loaned: "借出", gifted: "已赠送", lost: "丢失", broken: "损坏", consumed: "用尽" } as Record<string,string>)[p.availability];
    }
    if (p.attributes && typeof p.attributes === "object") {
      const v = {...item.attributes,...p.attributes};
      if(v.quantity !== undefined && v.quantity !== null && (!Number.isFinite(v.quantity) || v.quantity < 0 || v.quantity > 100000)) fail("数量必须为0到100000之间的数值");
      if(v.expiresOn && (!/^\d{4}-\d{2}-\d{2}$/.test(v.expiresOn) || !Number.isFinite(Date.parse(v.expiresOn)) || new Date(v.expiresOn).toISOString().slice(0,10) !== v.expiresOn)) fail("有效期需要真实的年月日");
      item.attributes = {
        material: str(v.material, 100), dimensions: str(v.dimensions, 100), power: str(v.power, 100), care: str(v.care, 500),
        quantityUnit: str(v.quantityUnit, 20) || undefined,
        quantity: Number.isFinite(v.quantity) && v.quantity >= 0 ? Math.min(v.quantity, 100000) : undefined,
        expiresOn: /^\d{4}-\d{2}-\d{2}$/.test(v.expiresOn || "") ? v.expiresOn : undefined,
        capabilities: Array.isArray(v.capabilities) ? v.capabilities.filter((x: unknown) => typeof x === "string").map((x: string) => str(x, 60)).slice(0, 20) : [],
      };
    }
  } else if (action === "memory") {
    get(p.itemId);
    const text = str(p.text);
    if (!text) fail("请输入故事内容");
    s.memories.push({
      id: id(),
      itemId: p.itemId,
      author: a,
      text,
      at: now(),
      shared: false,
    });
  } else if (action === "savePlan") {
    const goal = str(p.goal, 150);
    if (!goal) fail("请填写目标");
    const itemIds = Array.isArray(p.itemIds)
      ? ([
          ...new Set(p.itemIds.filter((v: unknown) => typeof v === "string")),
        ] as string[])
      : [];
    itemIds.forEach(get);
    s.plans = [
      ...(s.plans || []),
      {
        id: id(),
        actor: a,
        goal,
        itemIds,
        at: now(),
        checklist: Array.isArray(p.checklist)
          ? p.checklist.slice(0, 30).map((r: any) => ({
              label: str(r?.label, 120),
              status: str(r?.status, 80),
            }))
          : undefined,
      },
    ];
  } else if (action === "saveIdea") {
    if (!ideas.some((i) => i.id === p.ideaId)) fail("灵感不存在");
    s.saved[a] = s.saved[a].includes(p.ideaId)
      ? s.saved[a].filter((v) => v !== p.ideaId)
      : [...s.saved[a], p.ideaId];
  } else if (action === "attempt") {
    const idea = ideas.find((i) => i.id === p.ideaId);
    if (!idea) fail("灵感不存在");
    idea!.items.forEach(get);
    if (!str(p.text)) fail("请记录本次尝试的结果");
    s.attempts.push({
      id: id(),
      actor: a,
      ideaId: p.ideaId,
      itemIds: idea!.items,
      text: str(p.text),
      at: now(),
    });
  } else if (action === "quickTask") {
    if (a === "friend") fail("你不是家庭成员");
    if (!["lin", "dad"].includes(p.assignee)) fail("请选择家庭成员");
    const title = str(p.title, 120);
    if (!title) fail("请写下需要做的事");
    if (!["repair", "clean", "purchase", "notice", "help"].includes(p.kind))
      fail("事项类型无效");
    const itemId = str(p.itemId, 100);
    if (itemId && !get(itemId).shared)
      fail("请先由所有者共享物品，或不关联私人物品");
    const requestId = str(p.requestId, 100);
    if (!requestId) fail("缺少请求编号");
    const existing = s.tasks.find(
      (t) => t.createdBy === a && t.requestId === requestId,
    );
    if (existing) {
      if (
        existing.title !== title ||
        existing.itemId !== itemId ||
        existing.assignee !== p.assignee ||
        existing.kind !== p.kind
      )
        fail("重复请求的内容不一致");
      return s;
    }
    s.tasks.push({
      id: id(),
      itemId,
      title,
      assignee: p.assignee,
      status: "待处理",
      kind: p.kind,
      createdBy: a,
      requestId,
      acknowledged: false,
      logs: [{ by: a, text: "用户创建家庭事项", at: now() }],
    });
  } else if (action === "ackTask") {
    const t = s.tasks.find((t) => t.id === p.taskId);
    if (!t || a === "friend" || t.assignee !== a)
      fail("仅接收人可确认收到提醒");
    if (t!.itemId && !get(t!.itemId).shared) fail("物品已停止共享");
    if (t!.kind !== "notice") fail("这不是提醒事项");
    if (!t!.acknowledged) {
      t!.acknowledged = true;
      t!.logs.push({
        by: a,
        text: "已知晓提醒；并不代表物品已修好或可以使用。",
        at: now(),
      });
    }
  } else if (action === "createTask") {
    const item = get(p.itemId);
    if (!item.shared) fail("请先由所有者共享物品再创建家庭事项");
    if (a === "friend") fail("你不是家庭成员");
    if (!["lin", "dad"].includes(p.assignee)) fail("请选择家庭成员");
    const title = str(p.title, 120);
    if (!title) fail("请填写事项");
    s.tasks.push({
      id: id(),
      itemId: item.id,
      title,
      assignee: p.assignee,
      status: "待处理",
      logs: [{ by: a, text: str(p.context) || "用户创建协助事项", at: now() }],
    });
  } else if (action === "task") {
    const t = s.tasks.find((t) => t.id === p.taskId);
    if (!t) fail("事项不存在");
    if (a === "friend") fail("你不是家庭成员");
    if (t!.itemId && !get(t!.itemId).shared) fail("物品已停止共享");
    if (a !== t!.assignee) fail("请由当前负责人更新处理记录");
    if (!["待处理", "进行中", "用户确认完成", "未解决"].includes(p.status))
      fail("状态无效");
    if (p.assignee && ["lin", "dad"].includes(p.assignee)) {
      t!.assignee = p.assignee;
    }
    t!.status = p.status;
    t!.logs.push({ by: a, text: str(p.text) || p.status, at: now() });
  } else if (action === "maintain") {
    const i = get(p.itemId);
    if (
      a !== i.owner &&
      !s.tasks.some((t) => t.itemId === i.id && t.assignee === a)
    )
      fail("仅所有者或事项负责人可记录维护");
    i.maintenance = now().slice(0, 10);
    i.cycle = i.cycle || 90;
    s.memories.push({
      id: id(),
      itemId: i.id,
      author: a,
      text: "用户确认完成维护；未经过设备自动验证。",
      at: now(),
      shared: true,
    });
  } else if (action === "care") {
    if (a === "friend") fail("仅家庭成员可查看关怀");
    if (a !== "dad") fail("请切换爸爸角色，由本人调整授权和监测设置");
    for (const k of ["consent", "paused", "away", "offline"] as const)
      if (typeof p[k] === "boolean") s.care[k] = p[k];
    if (["normal", "missing"].includes(p.signal)) s.care.signal = p.signal;
  } else if (action === "gift") {
    const item = get(p.itemId);
    if (item.owner !== a) fail("仅所有者可赠送");
    if (s.gifts.some((g) => g.itemId === item.id && !g.revoked && !g.claimedBy))
      fail("这件物品已有待认领礼物，请先撤销");
    const stories = s.memories
      .filter(
        (m) =>
          m.itemId === item.id &&
          (m.owner ?? m.author) === a &&
          Array.isArray(p.memoryIds) &&
          p.memoryIds.includes(m.id),
      )
      .map((m) => m.text);
    s.gifts.push({
      id: id(),
      itemId: item.id,
      sender: a,
      token: id(),
      message: str(p.message) || "希望它陪你度过美好的日常。",
      nickname: str(p.nickname, 40),
      stories,
      storySnapshots: s.memories
        .filter(
          (m) =>
            m.itemId === item.id &&
            (m.owner ?? m.author) === a &&
            Array.isArray(p.memoryIds) &&
            p.memoryIds.includes(m.id),
        )
        .map((m) => ({
          memoryId: m.origin?.memoryId ?? m.id,
          author: m.author,
          text: m.text,
          at: m.origin?.at ?? m.at,
        })),
      includeKnowledge: p.includeKnowledge === true,
      itemName: item.name,
      revoked: false,
    });
  } else if (action === "revoke") {
    const g = s.gifts.find((g) => g.id === p.giftId && g.sender === a);
    if (!g || g.claimedBy) fail("无法撤销已认领或无权操作的礼物");
    g!.revoked = true;
  } else if (action === "claim") {
    const g = s.gifts.find((g) => g.token === p.token);
    if (!g || g.revoked || g.claimedBy) fail("链接已失效或礼物已被认领");
    if (g!.sender === a) fail("请选择接收者演示身份");
    if (p.received !== true) fail("请确认已实际取得物品");
    const item = s.items.find((i) => i.id === g!.itemId);
    if (!item || item.owner !== g!.sender) fail("物品归属已改变");
    if (
      s.tasks.some((t) => t.itemId === item!.id && t.status !== "用户确认完成")
    )
      fail("该物品仍有关联事项，请先处理完成");
    g!.claimedBy = a;
    g!.claimedAt = now();
    s.memories
      .filter((m) => m.itemId === item!.id)
      .forEach((m) => {
        m.shared = false;
      });
    item!.owner = a;
    item!.availability = "unknown";
    item!.shared = false;
    item!.location = "待接收者更新";
    item!.note = "";
    item!.photo = undefined;
    item!.maintenance = undefined;
    item!.cycle = undefined;
    item!.supportUrl = undefined;
    // A new holder must confirm the hardware again; prior service history stays private.
    item!.productBinding = undefined;
    for (const story of g!.storySnapshots ??
      g!.stories.map((text) => ({
        memoryId: null,
        author: null,
        text,
        at: null,
      })))
      s.memories.push({
        id: id(),
        itemId: item!.id,
        author: story.author,
        owner: a,
        origin: {
          memoryId: story.memoryId,
          giftId: g!.id,
          at: story.at,
          attribution: story.author ? "known" : "legacy-unknown",
        },
        text: story.text,
        at: now(),
        shared: false,
      });
  } else fail("不支持的操作");
  return s;
}
