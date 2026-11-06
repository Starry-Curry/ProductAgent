import { productPacks, type ProductPack } from "../products.ts";
import type { Citation } from "../agent/contracts.ts";
export type Knowledge = {
  facts: { id: string; text: string; topics: string[] }[];
  procedures: Procedure[];
  pack?: ProductPack;
};
export type Procedure = {
  id: string;
  title: string;
  steps: { id: string; text: string }[];
  citation: Citation;
  limits: string[];
};
export const windowsMouse: Procedure = {
  id: "windows11-double-click",
  title: "调整 Windows 11 双击速度",
  steps: [
    { id: "win-mouse-settings", text: "打开“设置 → 蓝牙和设备 → 鼠标”。" },
    { id: "win-mouse-properties", text: "在相关设置中打开“其他鼠标设置”。" },
    {
      id: "win-double-click",
      text: "在“鼠标属性”的“按钮”页调整双击速度，测试合适后确定。",
    },
  ],
  citation: {
    id: "ms:double-click",
    title: "Microsoft：更改鼠标设置",
    url: "https://support.microsoft.com/en-us/windows/hardware/input-devices/change-mouse-settings",
    kind: "official",
    section: "Windows 11 / Change the double-click speed",
  },
  limits: ["仅适用 Windows 11；界面语言和系统版本可能改变菜单名称。"],
};
export const mouseSetup: Procedure = {
  id: "m185-original-receiver-start",
  title: "M185 原配接收器首次设置",
  steps: [
    { id: "m185-power", text: "打开电脑，将鼠标电源开关拨至 On。" },
    {
      id: "m185-tab",
      text: "首次使用且存在电池绝缘拉片时，按入门图示打开电池仓并取出拉片。",
    },
    {
      id: "m185-receiver",
      text: "将随这只鼠标附带的 USB nano 接收器插入电脑 USB 端口，再检查是否可移动指针。",
    },
  ],
  citation: {
    id: "logi:m185-qsg",
    title: "Logitech M185 Getting Started",
    url: "https://www.logitech.com/assets/42356/3/m185-quick-start-guide.pdf",
    kind: "official",
    section: "Setup steps 1–3",
  },
  limits: [
    "仅在实物与图示一致、拥有原配接收器时使用；不据此推断替换接收器可直接配对。",
  ],
};
const topicPatterns: Record<string, RegExp> = {
  controls: /开关|指示灯|指示|灯亮/,
  environment: /室内|户外|食品|食物|接触食品/,
  battery: /电池|供电|充电|AA|AAA/i,
  connection: /接收器|蓝牙|连接|无线|Wi-Fi|wifi/i,
  load: /承重|载荷|重量|净重|千克|公斤/,
  stereo: /立体声|两台|多音箱|auracast/i,
  protection: /防水|防尘|IP67|浸水/i,
  dimensions: /尺寸|长宽高|多大|厘米|毫米/,
  capacity: /容量|容积|尘杯|升/,
  power: /功率|瓦/,
  coverage: /覆盖面积|适用面积|平方米/,
  airflow: /CADR|洁净空气量|立方米/i,
  anchoring: /固定|倾倒|掉落|螺丝|螺栓/,
  care: /保养|擦拭|湿布|清洁要求/,
};
export function topics(question: string) {
  return Object.entries(topicPatterns)
    .filter(([, r]) => r.test(question))
    .map(([k]) => k);
}
export function relevantKnowledge(
  question: string,
  pack?: ProductPack,
): Knowledge {
  const wanted = /介绍一下|有哪些功能|全部参数|产品规格|整体规格/.test(question)
    ? Object.keys(topicPatterns)
    : topics(question);
  const facts = (pack?.claims || [])
    .map((c) => ({
      ...c,
      topics: Object.keys(topicPatterns).filter((k) =>
        topicPatterns[k].test(c.text),
      ),
    }))
    .filter((c) => wanted.some((t) => c.topics.includes(t)));
  return { facts, procedures: [], pack };
}
export function knowledgeCatalog(query: string) {
  return productPacks
    .filter((p) =>
      `${p.product} ${p.model}`.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 4)
    .map((p) => ({
      id: p.id,
      model: p.model,
      claims: p.claims,
      limits: p.limits,
    }));
}
export function procedureReply(p: Procedure, tried: string[]) {
  const steps = p.steps.filter((s) => !tried.includes(s.id));
  return {
    answer: steps.length
      ? p.title
      : "已有步骤你都试过了。先确认哪一步出现不同，再决定下一步；不要反复做同样的操作。",
    steps,
    questions: steps.length ? [] : ["你看到的实际现象与哪一步不同？"],
    evidenceIds: [p.citation.id],
    citations: [p.citation],
    caveat: p.limits.join(" "),
  };
}
