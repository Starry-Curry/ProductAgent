import type { ProductPack } from "../products.ts";
/** Two reviewed model-specific examples, not a crawler or a user's inventory. */
export const alphaProductPacks: ProductPack[] = [
  {
    id: "ikea-samla-19440848",
    product: "SAMLA 萨姆拉附盖储物盒",
    model: "194.408.48",
    version: "2026-10-29.alpha1",
    source: {
      title: "宜家中国 SAMLA 商品详情",
      url: "https://www.ikea.cn/cn/zh/p/samla-box-with-lid-transparent-s19440848/",
      section: "商品描述、商品尺寸、小贴士、材料",
      checkedAt: "2026-10-29",
      kind: "official",
    },
    claims: [
      {
        id: "samla:material",
        text: "材质为聚丙烯塑料，透明盒体便于查看内容物。",
      },
      {
        id: "samla:size",
        text: "组合商品尺寸为宽28、深20、高14厘米，标称容量5升；这些不是内部净尺寸。",
      },
      {
        id: "samla:lid",
        text: "盖子使用内嵌锁扣，可防尘并帮助叠放；没有宣称气密或水密。",
      },
      { id: "samla:limits", text: "仅供室内使用，不可直接接触食物。" },
      { id: "samla:care", text: "可用软布蘸水及中性洗涤剂或皂液擦拭。" },
    ],
    capabilities: ["透明可视", "容纳非食品轻小物", "盖子锁扣防尘"],
    constraints: { indoorOnly: true, foodContact: false },
    limits: [
      "不得直接接触食品；仅室内",
      "耐热范围、承重上限、气密性、内部净尺寸未知",
      "盖子不是承重台或经验证的光学器件",
    ],
    understanding: {
      properties: [
        { key: "material", value: "透明聚丙烯", factIds: ["samla:material"] },
        {
          key: "dimensions",
          value: "28×20×14厘米；5升（组合外尺寸/标称容量）",
          factIds: ["samla:size"],
        },
        { key: "structure", value: "盒体与锁扣盖", factIds: ["samla:lid"] },
      ],
      unknowns: [
        "耐热范围",
        "承重上限",
        "内部净尺寸",
        "是否适合具体待放物",
        "气密或水密",
      ],
      possibilities: [
        {
          function: "可见的进度容器",
          principle: "可透过盒壁区分内容物而不频繁开盖",
          basisFactIds: ["samla:material"],
          conditions: [
            "只放已登记的非食品轻小物",
            "不把透明等同于光学成像性能",
          ],
        },
      ],
    },
  },
  {
    id: "ikea-knagglig-10392601",
    product: "KNAGGLIG 卡纳格松木盒",
    model: "103.926.01",
    version: "2026-10-29.alpha1",
    source: {
      title: "宜家中国 KNAGGLIG 商品详情与组装文件入口",
      url: "https://www.ikea.cn/cn/zh/p/knagglig-ka-na-ge-he-song-mu-10392601/",
      section: "商品描述、尺寸、材料、小贴士",
      checkedAt: "2026-10-29",
      kind: "official",
    },
    claims: [
      { id: "knagglig:material", text: "主体为实心松木，其它部分为镀锌钢。" },
      { id: "knagglig:size", text: "宽23、深16、高10厘米；不是内部净尺寸。" },
      { id: "knagglig:structure", text: "带提手，可叠放；最大承重2公斤。" },
      { id: "knagglig:limits", text: "不得挂墙；可用干布清洁。" },
    ],
    capabilities: ["容纳", "提拿", "叠放"],
    constraints: { maxLoadKg: 2 },
    limits: [
      "不得挂墙",
      "承重上限2公斤不是可坐踏或悬挂许可",
      "食品接触、耐热、内尺寸、具体实物紧固状态未知",
    ],
    understanding: {
      properties: [
        {
          key: "material",
          value: "实心松木；镀锌钢部件",
          factIds: ["knagglig:material"],
        },
        {
          key: "dimensions",
          value: "23×16×10厘米（外尺寸）",
          factIds: ["knagglig:size"],
        },
        {
          key: "structure",
          value: "带提手、可叠放；最大承重2公斤",
          factIds: ["knagglig:structure"],
        },
      ],
      unknowns: [
        "内部净尺寸",
        "耐热范围",
        "食品接触适用性",
        "实物紧固与磨损状态",
      ],
      possibilities: [
        {
          function: "可搬走的活动工作站",
          principle: "容纳与提手使一组已登记的小物能一起移动",
          basisFactIds: ["knagglig:structure"],
          conditions: [
            "总重不超过2公斤",
            "先检查连接与毛刺",
            "放置平稳；不得挂墙或坐踏",
          ],
        },
      ],
    },
  },
];
