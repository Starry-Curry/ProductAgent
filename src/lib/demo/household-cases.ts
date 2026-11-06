export const HOUSEHOLD_DEMO_VERSION = "household-2026-10-18-v1";
export const householdCases = [
  {
    id: "demo-household-kettle",
    title: "早晨给家人泡杯茶",
    icon: "kettle",
    location: "厨房",
    packId: "xiaomi-kettle2-uk",
    summary: "先核对容量，再聊聊一家人喝茶的习惯。",
    questions: ["容量是多少？", "聊聊以前的故事"],
    stories: [
      "搬家后第一个周末，我用这只水壶给来帮忙的爸爸泡了茶。",
      "我喜欢清晨安静地喝茶，周末会和家人慢慢聊天。",
    ],
    preference: "先听一段简短说明，再按需要展开。",
  },
  {
    id: "demo-household-fryer",
    title: "周末一起准备晚餐",
    icon: "fryer",
    location: "厨房",
    packId: "xiaomi-airfryer65-uk",
    summary: "查询明确规格，保留一起做饭的片段。",
    questions: ["容量是多少？", "额定功率是多少？", "聊聊以前的故事"],
    stories: [
      "第一次邀请朋友来新家，我们围着餐桌一起准备晚餐，空气炸锅是厨房里的新伙伴。",
      "我喜欢一起做饭的过程，不想为了聚餐一直忙着收拾。",
    ],
    preference: "先安排准备和收尾，不把规格当成食谱。",
  },
  {
    id: "demo-household-purifier",
    title: "给阅读角留一点安静",
    icon: "purifier",
    location: "客厅",
    packId: "xiaomi-purifier4lite-global",
    summary: "区分商品覆盖面积和真实空气状态。",
    questions: ["有效覆盖面积是多少？", "PM CADR 是多少？", "聊聊以前的故事"],
    stories: [
      "爸爸第一次来新家时，坐在阅读角翻了很久的旧相册。",
      "我想保留一个安静的小角落，读书时不被太多提示打断。",
    ],
    preference: "提醒温和，先说明理由；不推断健康。",
  },
  {
    id: "demo-household-vacuum",
    title: "十分钟收拾家的角落",
    icon: "vacuum",
    location: "储物间",
    packId: "xiaomi-g20lite-au",
    summary: "了解尘杯规格，记录家庭清洁分工。",
    questions: ["尘杯容量是多少？", "净重是多少？", "聊聊以前的故事"],
    stories: [
      "搬来以后，我们第一次一起收拾客厅，最后坐在地毯边吃了点心。",
      "我喜欢把家务拆成小段，做完一点就停下来休息。",
    ],
    preference: "每次只给一个容易开始的小任务。",
  },
  {
    id: "demo-household-side-table",
    title: "小边桌上的晚间阅读",
    icon: "table",
    location: "客厅",
    packId: "ikea-lack-00352988",
    summary: "核对桌面承重与保养，不把家具当作站台。",
    questions: [
      "桌面最大承重是多少？",
      "官方保养要求是什么？",
      "聊聊以前的故事",
    ],
    stories: [
      "这张小边桌最早放在租来的房间里，上面摆着第一盏台灯。",
      "我喜欢读完一章后写两句感想，再把书放回桌边。",
    ],
    preference: "收纳方案尽量不添新物品。",
  },
  {
    id: "demo-household-kallax",
    title: "让手作和照片各有位置",
    icon: "shelf",
    location: "书房",
    packId: "ikea-kallax-79384057",
    summary: "收纳故事和固定要求都能查到来源。",
    questions: ["每块搁板最大承重是多少？", "是否需要固定？", "聊聊以前的故事"],
    stories: [
      "和家人一起整理照片时，我们给旅行相片和小手工作品各留了一格。",
      "我喜欢把做过的小作品摆出来，它们让我记起一起动手的日子。",
    ],
    preference: "按用途分区，保留故事，不只统计数量。",
  },
  {
    id: "demo-household-billy",
    title: "从第一本书到一家人的书架",
    icon: "shelf",
    location: "书房",
    packId: "ikea-billy-00522047",
    summary: "保留书的来历，也核对书架固定要求。",
    questions: ["书架尺寸是多少？", "是否需要固定？", "聊聊以前的故事"],
    stories: [
      "搬家那天，爸爸把他读过的几本书放进这座书架，希望以后还能一起聊书。",
      "我喜欢旧书页里的笔记，希望家里的书能继续被人翻开。",
    ],
    preference: "先确认固定和现场条件，再谈摆放。",
  },
  {
    id: "demo-household-trolley",
    title: "把手作材料推到身边",
    icon: "trolley",
    location: "书房",
    packId: "ikea-raskog-30629711",
    summary: "查询载荷和室内使用限制，再尝试材料收纳。",
    questions: ["单层载荷是多少？", "是否适合户外？", "聊聊以前的故事"],
    stories: [
      "周末做小作品时，我们把常用材料归到推车里，结束后一起把桌面还原。",
      "我喜欢手工，但希望收尾简单，不用每次找半天材料。",
    ],
    preference: "优先整理已有材料，先检查稳定和载荷。",
  },
] satisfies {
  id: string;
  title: string;
  icon: string;
  location: string;
  packId: string;
  summary: string;
  questions: string[];
  stories: string[];
  preference: string;
}[];
