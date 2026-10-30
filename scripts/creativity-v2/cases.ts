// Every possession, personal condition and measurement below is synthetic.
// Familiar branded packs are reused; unfamiliar objects are unbranded everyday
// goods, not invented manufacturer/model claims.
export type TestObject = {
  name: string;
  material?: string;
  dimensions?: string;
  facts?: Record<string, unknown>;
  pack?: string;
  model?: string;
  brand?: string;
};
export const cases: {
  id: string;
  goal: string;
  items: TestObject[];
  preference: string;
  review: string;
}[] = [
  {
    id: "01",
    goal: "让收纳盒变成一次只弹出一张旅行纸条的抽签机。不买不剪不粘。",
    items: [
      {
        name: "SAMLA透明盒",
        brand: "IKEA",
        model: "194.408.48",
        pack: "ikea-samla-19440848",
        material: "聚丙烯塑料",
        dimensions: "28×20×14厘米",
      },
      {
        name: "20张旅行纸条",
        material: "纸",
        facts: { contents: "20张旅行目的地" },
      },
    ],
    preference: "喜欢旅行，希望公平抽签",
    review: "旧失败：PP不证明弹性、倾斜不保证单张弹出",
  },
  {
    id: "02",
    goal: "松木盒放进透明盒，做一个可取出的分类芯，不买东西。",
    items: [
      {
        name: "透明盒",
        dimensions: "28×20×14厘米",
        facts: { open_container: true },
      },
      { name: "松木盒", dimensions: "23×16×10厘米" },
    ],
    preference: "桌面尽量整洁",
    review: "外尺寸不能证明内净尺寸",
  },
  {
    id: "03",
    goal: "两盒并排放在73厘米桌面的右半边，留下左半边写字。不买。",
    items: [
      {
        name: "桌子",
        dimensions: "73×50×75厘米",
        facts: { free_surface_mm: [365, 500, 0] },
      },
      { name: "透明盒", dimensions: "28×20×14厘米" },
      { name: "木盒", dimensions: "23×16×10厘米" },
    ],
    preference: "喜欢留白",
    review: "51厘米宽不等于可以放进36.5厘米宽；可旋转计算",
  },
  {
    id: "04",
    goal: "朋友送的40×30厘米画，没有支架；不能买、粘或打孔，也不平放，想独立站在桌上。",
    items: [
      {
        name: "朋友赠画",
        dimensions: "40×30×2厘米",
        facts: { rigid: true, flat_surface: false },
      },
      { name: "书桌", dimensions: "73×50×75厘米" },
    ],
    preference: "不改动纪念物",
    review: "不能虚构支撑装置或自立稳定",
  },
  {
    id: "05",
    goal: "给米家台灯1S增加按下旋钮就随机给旅行抽签的功能，不拆机不加设备。",
    items: [
      {
        name: "米家台灯1S",
        brand: "小米",
        model: "MJTD01SYL",
        facts: { light: true },
      },
    ],
    preference: "想玩随机旅行",
    review: "不能发明旋钮可编程/联网执行",
  },
  {
    id: "06",
    goal: "把空盒倒扣后在它内部收纳小物，同时当升高台，不买东西。",
    items: [
      {
        name: "空盒",
        dimensions: "28×20×14厘米",
        facts: { open_container: true },
      },
      { name: "三枚纽扣", dimensions: "2×2×0.3厘米" },
    ],
    preference: "省空间",
    review: "朝向与开口条件冲突",
  },
  {
    id: "07",
    goal: "让GO 4音箱当安静的桌面光影灯，不买不拆，不要音乐。",
    items: [
      {
        name: "JBL GO 4",
        brand: "JBL",
        model: "GO 4",
        facts: { sound: true, light: false },
      },
    ],
    preference: "喜欢安静",
    review: "不得虚构音箱照明功能",
  },
  {
    id: "08",
    goal: "旧塑料盒还能怎样用于晚间阅读，不当收纳，不买不粘？",
    items: [
      {
        name: "旧塑料盒",
        material: "塑料，具体类型未知",
        dimensions: "28×20×14厘米",
      },
      { name: "台灯", facts: { light: true } },
    ],
    preference: "不喜欢做观察实验",
    review: "未知透明/反射/耐热；不能只观察凑数",
  },
  {
    id: "09",
    goal: "这只长尾夹怎样变得更有趣、更有用？我还拥有线和书桌，不买东西、不粘贴。",
    items: [
      {
        name: "一只长尾夹",
        material: "金属",
        facts: { clamp: true, clamp_gap_mm: 12 },
      },
      { name: "充电线", dimensions: "100×0.4×0.4厘米" },
      { name: "书桌", dimensions: "80×50×74厘米" },
    ],
    preference: "不愿损坏桌面",
    review: "陌生品；夹口与桌厚/线头关系未知",
  },
  {
    id: "10",
    goal: "绣绷和旧纱巾闲着，可以结合耳饰创造哪些不同新玩法？不剪不粘。",
    items: [
      {
        name: "绣绷",
        material: "竹",
        dimensions: "20×20×1厘米",
        facts: { rigid: true },
      },
      { name: "旧纱巾", material: "织物", dimensions: "35×35×0.1厘米" },
      { name: "耳饰", facts: { mass_kg: 0.02 } },
    ],
    preference: "喜欢可随时恢复原状",
    review: "不能假定纱巾孔径或绣绷自立",
  },
  {
    id: "11",
    goal: "金属冷却架不再烘焙，结合画笔能创造什么新用途？不新增用品。",
    items: [
      {
        name: "金属冷却架",
        dimensions: "30×20×2厘米",
        facts: { flat_surface: true },
      },
      { name: "画笔", dimensions: "20×1×1厘米" },
    ],
    preference: "不希望笔毛变形",
    review: "间隙与笔头方向未知，不凭金属推承重",
  },
  {
    id: "12",
    goal: "硅胶垫能变成不会滑的手机支架吗？不用其他东西、不剪。",
    items: [
      { name: "硅胶垫", material: "硅胶", dimensions: "25×18×0.2厘米" },
      { name: "手机", dimensions: "15×7×0.8厘米", facts: { mass_kg: 0.2 } },
    ],
    preference: "看菜谱，禁止接触火源",
    review: "硅胶不证明可折自立/防滑系数",
  },
  {
    id: "13",
    goal: "旧围巾怎样帮我在睡前减少看到工作物品的压力？不买、不粘。",
    items: [
      { name: "旧围巾", material: "棉", dimensions: "160×35×0.2厘米" },
      { name: "工作资料盒", dimensions: "25×18×10厘米" },
    ],
    preference: "卧室不想看见工作，禁止覆盖电器",
    review: "低风险可逆遮挡；不是声学隔音证明",
  },
  {
    id: "14",
    goal: "闲置的裤夹衣架能让读食谱更方便吗？只用已有物品。",
    items: [
      { name: "裤夹衣架", facts: { clamp: true, clamp_gap_mm: 6 } },
      { name: "两页食谱", material: "纸", dimensions: "29.7×21×0.02厘米" },
    ],
    preference: "台面小，不想弄脏纸",
    review: "悬挂点不是当然存在的资源",
  },
  {
    id: "15",
    goal: "一只旧网球改善开罐困难，不允许切开、加热或买工具。",
    items: [
      { name: "旧网球", dimensions: "6.7×6.7×6.7厘米", material: "橡胶包毡" },
      { name: "带盖玻璃罐", dimensions: "8×8×12厘米" },
    ],
    preference: "手腕不适，不用大力",
    review: "不能把材质当摩擦/弹性测量；禁裁切",
  },
  {
    id: "16",
    goal: "纸筒和一张薄纸怎么变得有趣，符合我爱做饭的生活？不买不剪不粘。",
    items: [
      {
        name: "纸筒",
        dimensions: "12×5×5厘米",
        facts: { open_container: true },
      },
      { name: "薄纸", dimensions: "29.7×21×0.01厘米" },
    ],
    preference: "不想写长日记，希望随机选菜",
    review: "随机性与纸张尺寸/管孔未知",
  },
  {
    id: "17",
    goal: "不用的木衣架能帮助区分明早先穿哪件衣服吗？不买东西。",
    items: [
      { name: "两个木衣架", facts: { contents: "2个衣架" } },
      { name: "衬衫和外套", facts: { contents: "1件衬衫、1件外套" } },
    ],
    preference: "早上匆忙，喜欢少决策",
    review: "信息组织可能实用但新颖性有限",
  },
  {
    id: "18",
    goal: "用透明玻璃杯把手机屏幕放大来看电影，不买、不加水。",
    items: [
      { name: "空玻璃杯", material: "玻璃", facts: { transparent: true } },
      { name: "手机", dimensions: "15×7×0.8厘米" },
    ],
    preference: "喜欢看电影",
    review: "透明不等于透镜/放大率；光学未知",
  },
  {
    id: "19",
    goal: "利用闲置旅行收纳袋，让出门前的钥匙和卡片更不容易遗漏。",
    items: [
      {
        name: "旅行网袋",
        facts: { open_container: true, transparent: true, portable: true },
      },
      { name: "钥匙和卡片", facts: { contents: "1串钥匙、1张交通卡" } },
    ],
    preference: "经常匆忙出门，只用现有物品",
    review: "跨场景功能迁移；不可发明提醒感应器",
  },
  {
    id: "20",
    goal: "陶瓷碗可以给台灯反光，让书桌两侧一样亮吗？不买不改装。",
    items: [
      { name: "陶瓷碗", material: "釉面陶瓷" },
      { name: "台灯", facts: { light: true } },
    ],
    preference: "安静阅读",
    review: "釉面不证明镜面/均匀照度",
  },
  {
    id: "21",
    goal: "我想用磁铁把画吸在松木盒上展示，不买、不粘。",
    items: [
      { name: "冰箱磁铁", facts: { magnetic: true } },
      { name: "松木盒", material: "松木", facts: { magnetic: false } },
      { name: "画作", dimensions: "40×30×2厘米" },
    ],
    preference: "保护画作",
    review: "磁源不等于目标吸附，目标明确非磁性",
  },
  {
    id: "22",
    goal: "把1.5千克音箱放在标注1千克载荷的架子上，让它离耳朵近一点，不买。",
    items: [
      { name: "音箱", facts: { mass_kg: 1.5, sound: true } },
      { name: "小架子", facts: { flat_surface: true, max_load_kg: 1 } },
    ],
    preference: "不想占地",
    review: "确定的质量/载荷矛盾",
  },
  {
    id: "23",
    goal: "这个手提篮还能创造什么新功能，让它更符合我的生活？不买东西。",
    items: [
      {
        name: "手提篮",
        facts: {
          open_container: true,
          portable: true,
          contents: "工作笔记、文件夹",
        },
      },
    ],
    preference: "在一间房工作睡觉，晚上不看工作内容",
    review: "可迁移工作站；用户价值与普通收纳区别",
  },
  {
    id: "24",
    goal: "上次让围巾遮工作盒的方案我不感兴趣。不要再遮挡，换一个真正不同的作用，不买不剪。",
    items: [
      { name: "旧围巾", material: "棉", dimensions: "160×35×0.2厘米" },
      { name: "旅行网袋", facts: { open_container: true, portable: true } },
    ],
    preference: "喜欢旅行、轻装，不想再做遮挡",
    review: "否定反馈需要新机制而非换标题",
  },
];
