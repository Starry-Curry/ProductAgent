import test from "node:test";
import assert from "node:assert/strict";
import { itemContext } from "../src/lib/context/items.ts";
import { itemAdviceIssues } from "../src/lib/context/item-advice.ts";
import type { Item } from "../src/lib/domain.ts";
const item = {
  id: "cup",
  name: "无盖不锈钢水杯",
  category: "水杯",
  owner: "lin",
  shared: false,
  state: "在用",
  availability: "available",
  brand: "未知",
  model: "未知",
  source: "用户录入",
  attributes: {
    material: "不锈钢，单层，无杯盖",
    care: "食品接触与耐热未确认；不加热；镜面未确认；食品级未确认；不承重",
  },
} as Item;
for (const text of [
  "不能确定。档案中仅登记为不锈钢，未注明304牌号或食品级认证。",
  "是否安全使用，取决于其实际等级（如是否为食品级304），目前缺少这些信息。",
  "杯底具体弧度、是否镜面抛光、厚度分布等条件均未确认。",
  "没有官方资料支持直接装沸水，无法确认沸水安全性。",
  "这只杯子没有被确认是透明的，不能假设它的光学性质。",
  "镜面、凹槽和承重都尚未确认，先不要据此设计。",
  "因此，无法从现有资料确定它是304食品级不锈钢。若需用于盛装食物或饮品，建议优先确认产品标识。",
  "这些信息直接影响能否安全装沸水。",
])
  test(`真实失败回归：谨慎表述不误拒 ${text}`, () =>
    assert.deepEqual(itemAdviceIssues(text, [itemContext(item)]), []));
for (const text of [
  "镜面未经确认，但可以用它的镜面反射文字。",
  "材质未注明，但它就是304食品级不锈钢。",
  "这只杯子可以盛装热水。最后再确认耐热。",
  "食品级未确认，不过可以用这只杯子喝水。",
  "杯子的承重足够。",
  "材质未注明但它就是304食品级不锈钢。",
])
  test(`否定说明不能掩盖独立断言 ${text}`, () =>
    assert.ok(itemAdviceIssues(text, [itemContext(item)]).length));

test("破损物品的禁止提示和维修前提不误作正在使用", () => {
  const broken = {
    ...item,
    name: "损坏小台灯",
    availability: "broken" as const,
    attributes: { care: "电线破损，禁止通电" },
  };
  assert.deepEqual(
    itemAdviceIssues(
      "当前电线破损，不能安全通电使用。历史使用状态不证明现在能用。如需继续使用，建议先交专业维修核对。",
      [itemContext(broken)],
    ),
    [],
  );
  assert.ok(
    itemAdviceIssues("建议先通电使用损坏小台灯。", [itemContext(broken)])
      .length,
  );
});

for (const advice of [
  "稳妥做法是先装温水试用。",
  "若想尝试，可将杯底朝下平放于文字上方，缓慢调整高度观察放大。",
])
  test(`真实输出漏检回归：${advice}`, () =>
    assert.ok(itemAdviceIssues(advice, [itemContext(item)]).length));

test("食品接触前提不能授权其他未经确认的性质或破损状态", () => {
  assert.ok(
    itemAdviceIssues("如果确认食品接触适用，才用杯子盛装热水并加热。", [
      itemContext(item),
    ]).length,
  );
  assert.ok(
    itemAdviceIssues("如果确认食品接触适用，利用杯底弧面放大文字。", [
      itemContext(item),
    ]).length,
  );
  assert.ok(
    itemAdviceIssues("如果确认食品接触适用，直接使用该杯。", [
      itemContext({ ...item, availability: "broken" }),
    ]).length,
  );
});
