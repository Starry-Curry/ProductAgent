import type { DatabaseSync } from "node:sqlite";
import type { Person, Item } from "../domain.ts";
import { boundPack } from "../ai/harness.ts";
import { storeLifeIdea, type LifeIdea } from "./ideas.ts";
import { violatesGoal } from "./planning-constraints.ts";

/** Bounded low-risk operators over declared capabilities/materials; still deterministic, never an open model. */
export function capabilityPlans(
  db: DatabaseSync,
  actor: Person,
  items: Item[],
  goal: string,
  budget: number,
  anchor?: string,
): LifeIdea[] {
  const describe = (i: Item) =>
    [
      i.name,
      i.category,
      i.attributes?.material,
      ...(i.attributes?.capabilities || []),
      ...(boundPack(i)?.capabilities || []),
    ].join(" ");
  const find = (pattern: RegExp, omit?: string) =>
    [...items]
      .sort(
        (a, b) =>
          Number(b.id === anchor) - Number(a.id === anchor) ||
          a.id.localeCompare(b.id),
      )
      .find((i) => i.id !== omit && pattern.test(describe(i)));
  const candidates: LifeIdea[] = [];
  function offer(
    title: string,
    chosen: Item[],
    minutes: number,
    steps: string[],
    missing: string[],
    rationale: string,
  ) {
    if (
      !chosen.length ||
      minutes > budget ||
      (anchor && !chosen.some((i) => i.id === anchor)) ||
      violatesGoal(goal, steps.join(" "))
    )
      return;
    const evidence = chosen.flatMap((i) => {
      const p = boundPack(i);
      return p
        ? p.claims
            .slice(0, 1)
            .map((c) => ({ id: c.id, text: c.text, url: p.source.url }))
        : [];
    });
    candidates.push(
      storeLifeIdea(db, actor, {
        id: crypto.randomUUID(),
        title,
        itemIds: chosen.map((i) => i.id),
        minutes,
        steps,
        missing,
        rationale,
        evidence,
        limits: [
          "本地能力组合：登记属性与类别只是候选依据，尺寸、稳定性和实际适用性需现场确认；不改装、不加热。",
          ...chosen.map((i) =>
            i.attributes?.care
              ? `${i.name}：遵守已登记维护要求 ${i.attributes.care}`
              : `${i.name}：未登记维护限制，先核对实物标签/说明书`,
          ),
        ],
        source: "local-candidate",
        tested: false,
        direction: /限词/.test(title)
          ? "娱乐"
          : /角色|观察/.test(title)
            ? "创作"
            : "生活改善",
        goal,
      }),
    );
  }
  const writing = find(/纸|笔|书写|writing|annotation/i),
    container = find(/收纳|容器|盒|杯|storage|contain/i),
    carry = find(/背包|旅行包|携带|portable|carrying/i);
  if (writing && /娱乐|好玩|有趣|游戏|创作|换.*方向/.test(goal)) {
    offer(
      `用${writing.name}玩一轮限词编故事`,
      [writing],
      5,
      [
        "先确认有纸和能写的笔；缺一个可改为口述，不假定还有其他文具",
        "写下三个互不相干的日常词，用它们串成四句虚构小故事；不当成真实经历保存",
        "换一个词重写结尾，比较两个版本；可独自完成，也可征得同伴同意后轮流接句",
      ],
      ["纸笔是否完整须确认；多人参与不是前置条件"],
      "娱乐靠规则和表达成立，不依赖未确认的物理现象。",
    );
    if (container && container.id !== writing.id)
      offer(
        `借${container.name}的轮廓做角色草图`,
        [writing, container],
        10,
        [
          `确认${container.name}干净、干燥并可稳定放在纸上；玻璃不能放稳就只看轮廓画，不沿边描`,
          `用${writing.name}画出看到的外形，再添眼睛、线条或文字，变成一个明确虚构的角色`,
          "为角色写一句台词，再用同样外形画出另一种性格；不要求杯子自行印出痕迹",
        ],
        ["可写表面、笔和容器稳定性需本人确认；不涂写原物品"],
        "创作利用真实可见轮廓和纸笔，不承诺光学成像或自动印痕。",
      );
  }
  if (/整理|收纳|桌面|生活改善/.test(goal) && container) {
    offer(
      `把${container.name}变成可撤回的桌面归位点`,
      [container],
      5,
      [
        `选出桌面一类常用小物，确认${container.name}干净、干燥、稳定且尺寸合适`,
        "先试放小件，保持随手可取；不能放稳就恢复原状，不堆高或承重改造",
        "使用一次后调整位置，记录顺手与不顺手之处",
      ],
      ["容积、稳定性以及待收纳小物是否在场须确认；食品容器避免交叉污染"],
      "用已有容器的容纳能力解决一个小范围归位目标，不依赖品牌型号。",
    );
    if (writing && writing.id !== container.id)
      offer(
        `用${container.name}和${writing.name}做一份归位索引`,
        [container, writing],
        10,
        [
          "先确认具备可书写表面与书写工具；只有其中一种时不假定另一种存在",
          `按一类一位置试用${container.name}，不往原物品表面永久涂写`,
          `用${writing.name}记录位置规则，拿取一次后检查是否容易恢复`,
        ],
        ["完整纸笔组合未自动确认；可改用脑中记忆归位规则，无需购买"],
        "把容纳和记录两种能力组合成可试用的整理流程。",
      );
  }
  if (
    /学习|学点|观察|有趣|娱乐|玩法|新用途|换个方向/.test(goal) &&
    !/不要.{0,4}观察|不做科学|不要实验/.test(goal)
  ) {
    const subject =
      items.find(
        (i) =>
          i.id !== writing?.id &&
          /玻璃|木|布|金属|塑料|植物|家具|服装/.test(describe(i)),
      ) || items[0];
    if (subject)
      offer(
        `围绕${subject.name}做一次细节发现挑战`,
        [subject],
        5,
        [
          `在正常使用位置观察${subject.name}，找出三个平时未注意到的细节，不拆卸或移动不稳定物品`,
          "给三个细节分别写出一个已看到的事实和一个还不知道的问题；没有记录工具时口头完成",
          "用已有资料核对一个问题；找不到就保留未知，不能以猜测代替事实",
        ],
        [
          "材质/结构由本人登记，观察不等于检测；植物不尝食，食品不因游戏改变保存条件",
        ],
        "将任意一件可用物品转为观察与提问对象，练习区分事实和猜测。",
      );
    if (writing && subject && writing.id !== subject.id)
      offer(
        `用${writing.name}为${subject.name}做一张观察卡`,
        [writing, subject],
        10,
        [
          "先核对是否有完整纸笔或可写可擦的记录工具",
          `记录${subject.name}现在可观察的轮廓、用途和一个实际疑问`,
          "将登记资料和现场观察分栏比较，不编造材质、参数或过去经历；可按意愿另存生活片段",
        ],
        ["可写表面与工具、是否能安全近距离观察须本人确认"],
        "组合记录能力与具体观察对象；不用新购材料，也不凭类别推断精确性能。",
      );
  }
  if (/出行|旅行|出游|通勤|收拾行李/.test(goal) && carry) {
    const part =
      container && container.id !== carry.id
        ? container
        : find(/衣|服装|书|笔|水杯|便携/i, carry.id);
    offer(
      `用${carry.name}${part ? `与${part.name}` : ""}做一次出行减负试装`,
      part ? [carry, part] : [carry],
      10,
      [
        "先按自己的路线、天气和行程列出必需品；未知条件保持空白，不假定天气或身份文件齐备",
        `在${carry.name}中试装已选物品，检查实际尺寸、重量与取用顺序；不适合就减少携带`,
        "走动几步检查舒适度并恢复不合适的摆放；记录缺口，可选择缩短行程或替代，不自动购买",
      ],
      ["行程、天气、实际承重、防漏及必要随身物资需自行核对"],
      "用携带能力与现有物品组合做可逆试装，先核对缺口再决定是否出发。",
    );
  }
  if (/衣物|穿搭|搭配|服装/.test(goal)) {
    const clothes = items
      .filter((i) => /衣|服装|围巾|裤|裙/.test(describe(i)))
      .slice(0, 3);
    if (clothes.length)
      offer(
        "用已有衣物做两套场景搭配",
        clothes,
        10,
        [
          "先确认天气、场合和衣物是否干净可穿；未知保持待确认，不从照片推断尺码",
          "把已选衣物按颜色与层次摆成两种组合，缺少下装或鞋子时明确留空，不假定已有",
          "实际试穿比较活动便利与舒适度，不合适就换回原方案；可口头记下偏好",
        ],
        ["天气/场合、尺码舒适度及缺少单品需现场确认"],
        "仅用可穿着的登记衣物做可逆搭配，不声称品牌功能或个人审美已确定。",
      );
  }
  if (/烹饪准备|做饭准备|备菜/.test(goal)) {
    const food = items
      .filter((i) => /食品|食材|蔬菜|水果|面粉/.test(describe(i)))
      .slice(0, 3);
    if (food.length)
      offer(
        "用现有食材做一份开工前检查",
        food,
        5,
        [
          "核对实际份量、保质期与保存状态；未知或变质可疑的食材先排除，不以模型判断可食用",
          "按自己的已确认食谱核对食材，缺什么就记录缺口或改用有依据的替代食谱，不擅自用未登记材料",
          "仅整理准备顺序与现有食材，不在缺乏食谱/器具依据时设定加热时间、温度或熟度",
        ],
        [
          "可靠食谱、过敏限制、清洁用水与实际器具需核对；本方案不是烹饪安全结论",
        ],
        "先解决准备与缺口，不把原料清单冒充完整菜谱。",
      );
  }
  if (/摄影|拍照/.test(goal)) {
    const camera = find(/相机|拍摄|摄影|camera|图像记录/i),
      subject = items.find((i) => i.id !== camera?.id);
    if (camera && subject)
      offer(
        "为一件旧物拍三种构图",
        [camera, subject],
        10,
        [
          "确认记录设备可用、有电和空间；选择稳定且获准拍摄的物品，不移动脆弱或危险物件",
          "在原有环境分别尝试全貌、局部、与周围留白三种构图；不要求额外灯具或布景",
          "比较哪一张最能表达物品用途；拍不到就保留草图想法，不承诺特殊光学效果",
        ],
        ["记录设备状态、光线、照片隐私与拍摄许可需确认"],
        "将记录能力与真实物品组合，通过构图差异而非虚构物理机制增加玩法。",
      );
  }
  return candidates;
}
