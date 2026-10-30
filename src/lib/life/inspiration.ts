/** Human-reviewed principle index. Original Chinese factual abstracts only:
 * no copied tutorials, images or presumed blanket community-content license.
 * An author's build is evidence about their build, never this user's item. */
export type InspirationCase = {
  id: string;
  title: string;
  author: string;
  url: string;
  source: string;
  objects: string[];
  originalUse: string;
  problem: string;
  property: string;
  transfer: string;
  requires: string[];
  limits: string[];
  evidence: string;
  license: string;
  checkedAt: string;
  tags: string[];
};
const checkedAt = "2026-10-30";
export const inspirationCases: InspirationCase[] = [
  {
    id: "clip-cables",
    title: "用夹子的金属手柄引导线材",
    author: "Chad Upton",
    source: "Broken Secrets",
    url: "https://brokensecrets.com/2010/04/20/stop-cords-from-falling-behind-your-desk/",
    objects: ["长尾夹", "线材", "可夹桌边"],
    originalUse: "夹住纸张",
    problem: "插头落到桌后",
    property: "夹持边缘与手柄环形成导向/限位",
    transfer: "从压紧纸张转为保留常用线头的位置",
    requires: ["夹口匹配桌厚", "线头大于环隙或另有止挡"],
    limits: ["不夹坏线缆", "不能默认所有插头都能穿环或止挡"],
    evidence: "作者报告自己使用；页面明确提出线材滑出的问题。未独立实测。",
    license: "未核实复用许可；仅本项目原创事实摘要与链接",
    checkedAt,
    tags: ["夹持", "clamp", "导向", "线", "桌", "遗漏"],
  },
  {
    id: "hoop-display",
    title: "绣绷转作耳饰展示",
    author: "Ariean Krieger",
    source: "Sugar Bee Crafts",
    url: "https://sugarbeecrafts.com/embroidery-hoop-earring-display",
    objects: ["绣绷", "织物", "耳饰"],
    originalUse: "张紧刺绣底布",
    problem: "可见地挑选与整理耳饰",
    property: "环形框张紧薄片并提供分散挂点",
    transfer: "从加工夹具转为轻物展示面",
    requires: ["合适织物", "固定或支承位置"],
    limits: ["不能默认用户织物孔径或绣绷自立", "耳饰形式与重量需核对"],
    evidence:
      "作者发布的项目；本轮页面重取不稳定，搜索索引与可读页面核对标题作者。未实物验证。",
    license: "未核实；不收录原文或图片",
    checkedAt,
    tags: ["绣", "布", "展示", "耳饰", "张紧", "框", "画"],
  },
  {
    id: "ball-holder",
    title: "开口网球变成夹取小物的容器",
    author: "hakuna matata",
    source: "Instructables",
    url: "https://www.instructables.com/Tennis-Ball-Holders/",
    objects: ["网球", "底板"],
    originalUse: "运动击球",
    problem: "让小物有易取的存放位置",
    property: "球壳切口经挤压张开",
    transfer: "从回弹球壳转为可开合夹口",
    requires: ["切割工具", "粘接与挂装"],
    limits: [
      "禁止裁切或粘贴时不能照搬",
      "滚动与安装条件未知",
      "不提供危险切割指令",
    ],
    evidence: "作者提供制作与使用照片/步骤；不是本项目实测。",
    license: "页面许可未核实；仅原创机制摘要",
    checkedAt,
    tags: ["球", "弹性", "夹持", "elastic", "容纳", "开口"],
  },
  {
    id: "padded-clamp",
    title: "给文具夹加接触保护，转为手工夹具",
    author: "Philippos Trelos",
    source: "Instructables",
    url: "https://www.instructables.com/Leather-Workshop-Binder-Clips-two-Minutes-Hack/",
    objects: ["长尾夹", "保护垫"],
    originalUse: "夹纸",
    problem: "临时固定皮革又减少夹痕",
    property: "夹紧作用与柔性接触层分工",
    transfer: "保留夹紧，改变接触界面",
    requires: ["保护垫材料", "安装条件"],
    limits: ["保护垫不是用户默认已有物", "不能承诺无夹痕"],
    evidence: "作者项目说明；搜索索引可读，正文提取受限。未实物验证。",
    license: "未核实；不复用原文图片",
    checkedAt,
    tags: ["夹", "clamp", "柔性", "保护", "表面", "固定"],
  },
  {
    id: "seed-tube",
    title: "纸筒转为育苗容器",
    author: "Sciencecityed",
    source: "Instructables",
    url: "https://www.instructables.com/Recycled-Seed-Starters/",
    objects: ["纸筒", "育苗土", "种子", "托盘"],
    originalUse: "卷材内芯",
    problem: "为幼苗提供小型初始生长空间",
    property: "中空围挡形成容积，纸材遇水状态会变化",
    transfer: "从支承卷材转为暂时围住基质",
    requires: ["土、种子与浇水条件", "底部处理与排水"],
    limits: [
      "不默认有土种子",
      "不保证纸筒降解时间或根系通过",
      "潮湿、霉变需处理",
    ],
    evidence: "教育机构账号发布的制作项目。未针对用户纸材验证。",
    license: "未核实；仅原创事实摘要与链接",
    checkedAt,
    tags: ["纸筒", "中空", "容纳", "open_container", "园艺", "种植"],
  },
  {
    id: "milk-water",
    title: "废奶瓶转成浇水壶",
    author: "Royal Horticultural Society",
    source: "RHS",
    url: "https://www.rhs.org.uk/education-learning/school-gardening/resources/planet-friendly/milk-bottle-watering-can",
    objects: ["清洁奶瓶", "瓶盖"],
    originalUse: "盛放奶",
    problem: "以分散水流浇水",
    property: "保留容积与手柄，改变出水孔形态",
    transfer: "从一次倒出转为分流",
    requires: ["制孔工具", "清洁与成人操作条件"],
    limits: ["禁止打孔时不能照搬", "不把任何塑料推为耐热或食品级"],
    evidence: "园艺机构教学活动；不是用户实物检测。",
    license: "未核实；不转载步骤与图片",
    checkedAt,
    tags: ["瓶", "容器", "孔", "导向", "浇水", "植物"],
  },
  {
    id: "rotary-radio",
    title: "旧电话拨盘成为时空音乐入口",
    author: "Caroline Buttet",
    source: "creator / Hackaday",
    url: "https://carolinebuttet.ch/",
    objects: ["旧拨盘电话", "计算板", "选择界面"],
    originalUse: "拨打电话号码",
    problem: "用有触感的旧交互探索不同年代地点的音乐",
    property: "离散拨号动作映射到数字选择",
    transfer: "保留熟悉动作，替换背后的数字含义",
    requires: ["额外计算与接口硬件", "软件适配与授权"],
    limits: ["不是任意灯具旋钮都可编程", "本轮不接线改装或控制"],
    evidence:
      "设计师作品页列出 Rotary Radio；Hackaday 2020-06-24报道交叉核对。未在物间复现。",
    license: "作品许可未核实；原创原理摘要",
    checkedAt,
    tags: ["旋转", "旋钮", "控制", "交互", "音乐", "数字", "设备"],
  },
  {
    id: "retro-radio",
    title: "旧鼠标旋转输入迁移到复古收音机",
    author: "mircemk",
    source: "Hackaday.io",
    url: "https://hackaday.io/project/205174-building-a-vintage-tube-style-internet-radio",
    objects: ["旧鼠标编码器", "Raspberry Pi模块", "显示界面"],
    originalUse: "鼠标输入",
    problem: "以实体旋钮选择网络电台",
    property: "旋转编码输入与软件菜单建立映射",
    transfer: "复用输入部件，更换用途与外观",
    requires: ["附加硬件", "编程与组装"],
    limits: ["需要核对版本电气接口", "不等于已有商品可直接执行这些功能"],
    evidence: "作者标为完成的项目，有实现描述；未独立复现。",
    license: "项目许可未核实；不下载或复用代码",
    checkedAt,
    tags: ["旋转", "控制", "音乐", "设备", "交互", "编码"],
  },
];
const tokens = (s: string) =>
  new Set(
    (s.toLowerCase().match(/[a-z_]{3,}|[\p{Script=Han}]{2,}/gu) || []).flatMap(
      (w) =>
        /^[a-z_]+$/.test(w)
          ? [w]
          : Array.from({ length: Math.max(0, w.length - 1) }, (_, i) =>
              w.slice(i, i + 2),
            ),
    ),
  );
/** Swappable retrieval port. No login/cookies, scraping, provider content license
 * assumptions, or sending a person's stories to community search services. */
export function searchInspiration(
  query: string,
  limit = 4,
): { cases: InspirationCase[]; mode: "reviewed-index"; total: number } {
  const words = tokens(query);
  const ranked = inspirationCases
    .map((c) => ({
      c,
      score: [
        ...tokens(
          [
            c.title,
            c.problem,
            c.property,
            c.transfer,
            ...c.tags,
            ...c.objects,
          ].join(" "),
        ),
      ].filter((t) => words.has(t)).length,
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));
  return {
    cases: ranked.slice(0, Math.max(0, Math.min(8, limit))).map((r) => r.c),
    mode: "reviewed-index",
    total: inspirationCases.length,
  };
}
