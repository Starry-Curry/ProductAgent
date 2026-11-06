import { canRead, type Item, type Person } from "./domain.ts";
export type Preparation = { label: string; reason: string; items: Item[] };
const picnic = [
  ["饮用水与水杯", "按人数和活动时长准备饮水", /水杯|保温杯|水壶|饮用水/],
  ["食物", "确认人数、饮食禁忌和保存条件", /食物|面包|水果|零食/],
  ["餐具", "按人数准备，检查是否干净", /餐具|筷|餐盘|餐盒/],
  ["野餐垫", "确认场地与尺寸是否适合", /野餐垫|地垫|坐垫/],
  ["垃圾袋与纸巾", "离开前带走垃圾", /垃圾袋|纸巾/],
  [
    "防晒与天气准备",
    "出发前查看天气，再决定帽子、雨具和防晒用品",
    /防晒|帽子|雨伞|雨衣/,
  ],
] as const;
const travel = [
  ["随身包", "确认容量和携带方式", /背包|旅行包|行李箱/],
  ["饮水", "确认装满、清洁与密封", /水杯|保温杯|水壶/],
  ["手机与充电用品", "检查电量和线材适配", /手机|充电|数据线/],
  ["证件与出行信息", "按行程确认所需证件和预约", /证件|身份证/],
  ["天气准备", "出发前查看天气，按需准备雨具和衣物", /雨伞|雨衣|外套/],
] as const;
export function prepareActivity(
  goal: string,
  items: Item[],
  actor: Person,
): Preparation[] | null {
  const rules = /野餐|郊游/.test(goal)
    ? picnic
    : /旅行|出门|出游/.test(goal)
      ? travel
      : null;
  if (!rules) return null;
  const usable = items.filter(
    (i) =>
      canRead(i, actor) &&
      !i.demo &&
      ["在用", "闲置", "待确认"].includes(i.state),
  );
  return rules.map(([label, reason, pattern]) => ({
    label,
    reason,
    items: usable.filter((i) => pattern.test(i.name)),
  }));
}
