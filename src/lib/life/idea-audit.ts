import type { Item } from "../domain.ts";
import { withoutProhibitedActions } from "../agent/safety-language.ts";

export type ActionIssue = { code: string; step: number; reason: string };
export type ResourceAudit = {
  owned: string[];
  environment: string[];
  unconfirmed: string[];
  additional: string[];
  unsupported: string[];
  fieldVerification: string[];
};
/** Action-level checks derived from actual inventory, never from model self-ratings.
 * Not a universal physical verifier: unknown phenomena remain field conditions.
 */
export function auditIdeaActions(
  goal: string,
  items: Item[],
  value: {
    itemIds: string[];
    steps: string[];
    missing?: string[];
    rationale?: string;
  },
) {
  const used = items.filter((i) => value.itemIds.includes(i.id));
  const inventory = used
    .map((i) =>
      [
        i.name,
        i.category,
        i.attributes?.material,
        ...(i.attributes?.capabilities || []),
      ].join(" "),
    )
    .join(" ");
  const strict = /只(?:用|使用)|只有|不增加|仅(?:用|使用)|不新增/.test(goal);
  const issues: ActionIssue[] = [];
  const resources: ResourceAudit = {
    owned: used.map((i) => i.id),
    environment: [],
    unconfirmed: [],
    additional: [],
    unsupported: [],
    fieldVerification: [],
  };
  const tools: [RegExp, RegExp, string][] = [
    [
      /计时|倒计时|(?:\d+|[一二两三四五六七八九十百]+)\s*秒|半分钟|(?:每|限时|严格)\s*(?:\d+|[一二两三四五六七八九十百]+)\s*分钟|限时结束|时间到/,
      /计时|时钟|手表|秒表|手机|timer/i,
      "精确计时工具",
    ],
    [/裁剪|剪下|剪成|裁成/, /剪刀|裁纸|scissors/i, "剪裁工具"],
    [/粘贴|贴到|贴在|粘到/, /胶带|胶水|粘胶/i, "粘贴材料"],
    [/打印|冲印/, /打印机|打印服务|冲印/i, "照片打印条件"],
    [
      /测量.{0,8}(尺寸|长度)|量出.{0,8}(厘米|毫米)|\d+\s*(厘米|毫米|cm\b|mm\b)/i,
      /尺|卷尺|ruler/i,
      "尺寸测量工具",
    ],
    [/拍摄|拍照|录像/, /相机|摄像|手机|camera/i, "拍摄设备"],
    [
      /夹在书页|翻开书|书页里|书中|夹入书/,
      /书籍|书本|旧书|一本书|阅读书/,
      "书本",
    ],
    [/对着镜子|照镜|镜前/, /镜子|镜面|穿衣镜/, "镜子"],
    [
      /导出照片|建立文件夹|拼成.{0,8}(?:网格|九宫格)|整理出.{0,8}九宫格|修图软件/,
      /电脑|计算机|手机|图像编辑|拼图|文件管理/,
      "照片导出或编辑设备",
    ],
    [
      /另一种颜色.{0,2}笔|换.{0,3}颜色.{0,2}笔|不同颜色.{0,2}笔/,
      /彩笔|多色|双色|彩色|色笔/,
      "多色书写工具",
    ],
  ];
  value.steps.forEach((raw, step) => {
    const text = withoutProhibitedActions(raw);
    // A missing resource may only be used behind an explicit gate plus a viable alternative.
    const conditional =
      /(?:若|如果|如已|先确认).{0,40}(?:有|可用|存在|具备|具足)/.test(text) &&
      /否则|没有.{0,15}(?:改|用|跳过)|不具备.{0,15}(?:改|用|跳过)/.test(text);
    const issue = (code: string, reason: string) =>
      issues.push({ code, step, reason });
    for (const capability of [
      "网格线",
      "直方图",
      "EV",
      "指定文件夹",
      "微距模式",
    ]) {
      if (
        text.includes(capability) &&
        !used.some((i) =>
          i.attributes?.capabilities?.some((c) => c.includes(capability)),
        ) &&
        !conditional
      )
        issue(
          "unsupported-capability",
          `未确认设备具备${capability}功能，需改成基本操作或给能力不支持时的替代`,
        );
    }
    if (
      /照片/.test(text) &&
      /排布|排到|排列|拼到/.test(text) &&
      /纸|实体手账/.test(text) &&
      !/纸质照片|打印/.test(inventory)
    )
      issue(
        "digital-physical",
        "数字照片不能直接排布在纸上，改为文件编号与文字索引",
      );
    if (/(?:罩住|罩在|罩着|覆盖|包住).{0,15}(?:灯头|光源|灯具|手电)/.test(text))
      issue(
        "heat-obstruction",
        "不能用材料罩住灯头或光源；改用投向场景的光，不能靠‘确保散热’免除实物限制",
      );
    if (
      /照亮.{0,18}(?:轮廓|纸上|图案|墨迹)/.test(text) &&
      /投出|投影|投射/.test(text)
    )
      issue(
        "ink-projection",
        "普通纸上轮廓不是透光投影模板，改为观察物体自身影子或纸上创作",
      );
    if (
      /照片|相片/.test(text) &&
      /贴在|贴到|粘贴|打印|背面.{0,8}(?:写|画)/.test(text) &&
      !/纸质照片|冲印照片|照片打印件/.test(inventory)
    )
      issue(
        "digital-physical",
        "数字照片不是纸质实物；改为纸上文件编号索引，不能在背面写字或粘贴",
      );
    for (const [action, registered, name] of tools) {
      if (!action.test(text) || registered.test(inventory)) continue;
      if (
        name === "精确计时工具" &&
        /约|大约|粗略|默数/.test(text) &&
        !/严格|精确|没有.{0,5}计时|不(?:用|使用|依赖)(?:任何)?计时|无(?:需)?计时/.test(
          goal,
        )
      )
        continue;
      resources.unconfirmed.push(name);
      if (strict) resources.additional.push(name);
      if (!conditional)
        issue(
          "implicit-tool",
          `步骤${step + 1}依赖未登记的${name}，改成无该工具的动作或明确条件与替代；免责声明不能代替资源`,
        );
    }
    if (
      /(?:照片|相片).{0,25}(?:背面|反面).{0,12}(?:写|画|标)|(?:背面|反面).{0,12}(?:写|画|标).{0,12}(?:照片|相片)/.test(
        text,
      ) &&
      !/纸质照片|冲印照片|照片打印件/.test(inventory)
    ) {
      resources.unsupported.push("数码文件没有可书写的物理背面");
      issue(
        "digital-physical",
        "不能在数码照片背面写字；可在纸上记录对应文件编号和感想，保留摄影目标",
      );
    }
    if (
      strict &&
      /(?:桌面|书桌|房间|台面).{0,8}(?:杂物|物品|小物)|(?:杂物|待整理物品|零散物品|零散小物|小件零散物品).{0,25}(?:放|归位|分类|收进|卷|包)|(?:放|收|带|包).{0,25}(?:零散物品|零散小物|小件零散物品)/.test(
        text,
      ) &&
      !conditional
    ) {
      resources.unconfirmed.push("未登记的待整理对象");
      issue(
        "unconfirmed-subject",
        "只用登记物品时不能假定另有桌面杂物；只整理本清单中的具体物品，或先确认对象并给空桌面的替代",
      );
    }
    for (const name of ["钥匙", "纸巾", "钱包"]) {
      if (
        strict &&
        text.includes(name) &&
        !inventory.includes(name) &&
        !conditional
      ) {
        resources.unconfirmed.push(name);
        resources.additional.push(name);
        issue(
          "unconfirmed-subject",
          `步骤使用未登记的${name}；只处理清单中的具体对象，不能把出行情境当成持有证据`,
        );
      }
    }
    for (const feature of ["侧袋", "前袋", "挂钩", "颈带", "带扣"]) {
      if (
        text.includes(feature) &&
        !inventory.includes(feature) &&
        !conditional
      ) {
        resources.unconfirmed.push(feature);
        issue(
          "unsupported-capability",
          `未确认有${feature}结构，改为主容器/手持等基础操作，或给无该结构的替代`,
        );
      }
    }
    if (/桌面|台面|地面|窗边|户外|公园|墙面/.test(text))
      resources.environment.push(
        "可用场地、空间与访问条件须现场确认（不是已拥有物品）",
      );
    if (/折射|投影|聚焦|成像|凝露|彩虹|光斑/.test(text)) {
      resources.fieldVerification.push(
        "光学或环境效果取决于实际材质、照明与摆位，不保证出现",
      );
      if (
        /必然|一定|保证|形成清晰|得到清晰|就会.{0,8}(?:出现|形成|产生)|稳定产生/.test(
          text,
        )
      )
        issue(
          "unverified-effect",
          "未经实测的物理效果不能当成必然结果，改为可行的观察条件或不依赖该机制的创作",
        );
    }
  });
  const allSteps = value.steps.join(" ");
  if (
    /杯|玻璃/.test(inventory) &&
    /倒扣.{0,20}(?:杯底|底座)|杯.{0,6}倒扣/.test(allSteps) &&
    /(?:插入|插进|伸入|放进).{0,10}杯口/.test(allSteps)
  )
    issues.push({
      code: "inconsistent-geometry",
      step: -1,
      reason:
        "倒扣的杯子不能再从上方插入杯口；改用稳定的正立容器或平放布局，不搭建易倒玻璃结构",
    });
  if (
    /(?:走路|步行|行走).{0,12}(?:始终|一直|全程).{0,20}(?:取景|框住|盯着)/.test(
      allSteps,
    )
  )
    issues.push({
      code: "unsafe-attention",
      step: -1,
      reason: "不能边走边持续盯取景框；行走看路，停稳后再取景",
    });
  if (
    /香蕉|水果/.test(inventory) &&
    /(?:压|挤|划|掐).{0,15}(?:凹痕|果皮|香蕉皮)|(?:香蕉|果皮|香蕉皮).{0,15}(?:弯折|划出)/.test(
      allSteps,
    )
  )
    issues.push({
      code: "food-damage",
      step: -1,
      reason:
        "备餐不应为了游戏压折或划伤食物；保留完整水果，趣味不依赖损伤或无据保鲜效果",
    });
  if (/冷藏|冰箱/.test(allSteps) && !/冰箱|冷藏设备/.test(inventory) && strict)
    issues.push({
      code: "implicit-tool",
      step: -1,
      reason:
        "只用登记物品时不能假定有冷藏设备；给不依赖冷藏的方案并核对食品状态",
    });
  if (
    /延缓.{0,8}褐变|保留可食性|仍可食|可放心.{0,5}(?:食|吃)/.test(
      value.rationale || allSteps,
    )
  )
    issues.push({
      code: "unsupported-food-safety",
      step: -1,
      reason:
        "没有储存与食品状态证据，不能保证保鲜、可食性或用游戏状态判断食品安全",
    });
  // A narrowly identifiable goal needs a usable arrangement, not a balancing game.
  // Other creative goals stay open; this is not a general semantic judge.
  if (
    /整理.{0,8}(?:桌面|书桌)|(?:桌面|书桌).{0,8}整理/.test(goal) &&
    /平衡|杯沿|挑战|影子|光影/.test(value.steps.join(" ")) &&
    !/收纳|归位|分区|常用区|取放|摆放|立放|平放/.test(value.steps.join(" "))
  )
    issues.push({
      code: "goal-mismatch",
      step: -1,
      reason:
        "整理目标需要可保留、便于取放的实际布局，不能用平衡或光影游戏代替整理成果",
    });
  if (
    /零风险|全程无风险|绝对安全|神经重置|治疗效果/.test(value.rationale || "")
  )
    issues.push({
      code: "unsupported-outcome",
      step: -1,
      reason:
        "创意理由包含未经验证的安全或生理效果保证，删除该断言，保留实际可执行成果",
    });
  for (const key of Object.keys(resources) as (keyof ResourceAudit)[])
    resources[key] = [...new Set(resources[key])];
  return { issues, resources };
}
