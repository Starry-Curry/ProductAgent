import { canRead, type Item, type Person } from "../domain.ts";

const groups = [
  [
    "净水器",
    "净水机",
    "饮水机",
    "直饮机",
    "净饮机",
    "淨水機",
    "淨水器",
    "water purifier",
  ],
  ["空气净化器", "空气净化机", "空净", "空氣淨化器", "air purifier"],
  ["水壶", "烧水壶", "热水壶", "电热壶", "电水壶", "烧水的", "kettle"],
  ["音箱", "音响", "蓝牙喇叭", "蓝牙音箱", "扬声器", "蓝牙扬声器", "speaker"],
  ["台灯", "书桌灯", "阅读灯", "床头灯", "桌灯", "desk lamp"],
  ["吸尘器", "吸尘机", "无线吸尘", "vacuum"],
  ["空气炸锅", "炸锅", "air fryer", "airfryer"],
  ["洗衣机", "洗衣機", "洗烘一体机", "washer", "washing machine"],
  ["鼠标", "滑鼠", "mouse"],
  ["相机", "照相机", "数码相机", "camera"],
  ["冰箱", "冰柜", "fridge"],
  ["电饭煲", "电饭锅", "饭煲", "rice cooker"],
  ["桌子", "桌面", "餐桌", "茶几", "边桌", "书桌"],
  ["座椅", "椅子", "凳子", "沙发"],
];
export function normalizeItemWords(text: string) {
  let value = text.toLowerCase().replace(/\s+/g, " ");
  for (const words of groups) {
    const alternatives = [...words]
      .sort((a, b) => b.length - a.length)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    value = value.replace(new RegExp(alternatives, "gi"), words[0]);
  }
  return value;
}
const objectName = (name: string) =>
  normalizeItemWords(name.split("的").at(-1) || name);
export function inventoryTermMatches(name: string, term: string) {
  const item = objectName(name),
    target = normalizeItemWords(term);
  const accessory = /电池|充电器|充电线|存储卡|滤芯|配件/.exec(target)?.[0];
  if (accessory && !item.includes(accessory)) return false;
  if (item.includes(target)) return true;
  if (accessory) return item.includes(accessory);
  return groups.some((g) => item.includes(g[0]) && target.includes(g[0]));
}
export function matchInventoryQuestion(
  question: string,
  items: Item[],
  actor: Person,
) {
  const visible = items.filter((i) => canRead(i, actor) && !i.demo);
  const exact = visible.filter((i) =>
    question.toLowerCase().includes(i.name.toLowerCase()),
  );
  if (exact.length) return { candidates: exact, alias: false };
  const q = normalizeItemWords(question);
  const keys = groups.map((g) => g[0]).filter((key) => q.includes(key));
  let candidates = visible.filter((i) =>
    keys.some((key) => objectName(i.name).includes(key)),
  );
  if (/家里|家中|我们家|咱家|家庭/.test(question)) {
    const shared = candidates.filter((i) => i.shared);
    if (shared.length) candidates = shared;
  }
  // Duplicate demo instances of the same reference are one suggestion; prefer the household record.
  candidates = candidates.sort((a, b) => Number(b.shared) - Number(a.shared));
  const seen = new Set<string>();
  candidates = candidates.filter((i) => {
    const key = i.synthetic ? i.referenceProductId || i.id : i.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { candidates: candidates.slice(0, 5), alias: candidates.length > 0 };
}

export function isEventPreparationRequest(question: string) {
  if (
    /怎么用|怎么开|怎么洗|按哪|如何使用|怎么设置|多少度|几分钟|食谱|做法/.test(
      question,
    ) &&
    !/清单|需要带|准备什么/.test(question)
  )
    return false;
  if (/昨天|上次|去年|回忆|是什么|什么意思|翻译|怎么拼|怎么读/.test(question))
    return false;
  return /野餐|露营|出差|旅行|出游|摄影|准备.*清单|家庭聚会|家里.*(?:聚会|party|派对)|(?:开|办|组织|准备|明天|周末).*(?:party|派对|聚会|生日会|桌游|火锅|看球)/i.test(
    question,
  );
}
