import type { ProductPack } from "../products.ts";
// Facts paraphrased from official regional pages; synthetic user stories live elsewhere.
export const householdProductPacks: ProductPack[] = [
  {
    id: "xiaomi-kettle2-uk",
    product: "小米 Xiaomi Electric Kettle 2 电热水壶",
    model: "Electric Kettle 2 · UK",
    version: "2026-10-18.1",
    source: {
      title: "Xiaomi UK · Electric Kettle 2 / Specs",
      url: "https://www.mi.com/uk/product/xiaomi-electric-kettle-2/specs/",
      section: "商品规格 / 安全与保养（对应页面）",
      checkedAt: "2026-10-18",
      kind: "official",
    },
    claims: [
      {
        id: "xiaomi-kettle2-uk:capacity",
        text: "官方标称容量为 1.7 升。",
      },
      {
        id: "xiaomi-kettle2-uk:power",
        text: "该 UK 页面列出的额定功率为 1800 瓦。",
      },
      {
        id: "xiaomi-kettle2-uk:dimensions",
        text: "该页面列出的尺寸为 227 × 158 × 262 毫米。",
      },
    ],
    limits: [
      "UK 页面规格；不能直接推断其他地区电压或同名硬件修订版。",
      "人工整理的有限公开资料；未接入设备、订单或实物检测，不提供未审核的维修步骤。",
    ],
  },
  {
    id: "xiaomi-purifier4lite-global",
    product: "小米 Xiaomi Smart Air Purifier 4 Lite 空气净化器",
    model: "AC-M17-SC",
    version: "2026-10-18.1",
    source: {
      title: "Xiaomi Global · Smart Air Purifier 4 Lite / Specifications",
      url: "https://www.mi.com/global/product/xiaomi-smart-air-purifier-4-lite/specs/",
      section: "商品规格 / 安全与保养（对应页面）",
      checkedAt: "2026-10-18",
      kind: "official",
    },
    claims: [
      {
        id: "xiaomi-purifier4lite-global:coverage",
        text: "官方有效覆盖面积为 25–43 平方米。",
      },
      {
        id: "xiaomi-purifier4lite-global:cadr",
        text: "官方颗粒物洁净空气量 PM CADR 为 360 立方米/小时。",
      },
      {
        id: "xiaomi-purifier4lite-global:dimensions",
        text: "官方尺寸为 240 × 240 × 533.5 毫米。",
      },
    ],
    limits: [
      "这是商品规格，不证明当前空气质量、滤芯寿命或医疗效果。",
      "人工整理的有限公开资料；未接入设备、订单或实物检测，不提供未审核的维修步骤。",
    ],
  },
  {
    id: "xiaomi-airfryer65-uk",
    product: "小米 Xiaomi Smart Air Fryer 6.5L 空气炸锅",
    model: "MAF10",
    version: "2026-10-18.1",
    source: {
      title: "Xiaomi UK · Smart Air Fryer 6.5L / Specification",
      url: "https://www.mi.com/uk/product/xiaomi-smart-air-fryer-6-5-liter/specs/",
      section: "商品规格 / 安全与保养（对应页面）",
      checkedAt: "2026-10-18",
      kind: "official",
    },
    claims: [
      {
        id: "xiaomi-airfryer65-uk:capacity",
        text: "MAF10 的额定容量为 6.5 升。",
      },
      {
        id: "xiaomi-airfryer65-uk:power",
        text: "该 UK 规格列出的额定功率为 1800 瓦。",
      },
      {
        id: "xiaomi-airfryer65-uk:wifi",
        text: "无线连接规格为 Wi-Fi IEEE 802.11 b/g/n 2.4GHz。",
      },
    ],
    limits: [
      "仅适用于 UK 页面 MAF10；规格不是食谱、食材熟度证明或清洁拆装教程。",
      "人工整理的有限公开资料；未接入设备、订单或实物检测，不提供未审核的维修步骤。",
    ],
  },
  {
    id: "xiaomi-g20lite-au",
    product: "小米 Xiaomi Vacuum Cleaner G20 Lite 无线吸尘器",
    model: "C203",
    version: "2026-10-18.1",
    source: {
      title: "Xiaomi Australia · G20 Lite / Specifications",
      url: "https://www.mi.com/au/product/xiaomi-vacuum-cleaner-g20-lite/specs/",
      section: "商品规格 / 安全与保养（对应页面）",
      checkedAt: "2026-10-18",
      kind: "official",
    },
    claims: [
      {
        id: "xiaomi-g20lite-au:capacity",
        text: "C203 的尘杯容积约为 0.55 升。",
      },
      {
        id: "xiaomi-g20lite-au:weight",
        text: "该页面列出的净重为 2.4 千克。",
      },
      {
        id: "xiaomi-g20lite-au:power",
        text: "该页面列出的额定功率为 215 瓦。",
      },
    ],
    limits: [
      "仅适用澳大利亚页面 C203；没有据此推断能吸液体、电池状态或可水洗部件。",
      "人工整理的有限公开资料；未接入设备、订单或实物检测，不提供未审核的维修步骤。",
    ],
  },
  {
    id: "ikea-lack-00352988",
    product: "IKEA LACK 拉克黑色边桌",
    model: "003.529.88",
    version: "2026-10-18.1",
    source: {
      title: "IKEA 中国 · LACK 003.529.88 / 商品详情",
      url: "https://www.ikea.cn/cn/zh/p/lack-la-ke-bian-zhuo-hei-se-00352988/",
      section: "商品规格 / 安全与保养（对应页面）",
      checkedAt: "2026-10-18",
      kind: "official",
    },
    claims: [
      {
        id: "ikea-lack-00352988:dimensions",
        text: "货号 003.529.88 的长、宽、高分别为 55、55、45 厘米。",
      },
      {
        id: "ikea-lack-00352988:load",
        text: "该边桌桌面最大承重为 25 公斤。",
      },
      {
        id: "ikea-lack-00352988:care",
        text: "官方保养建议为湿布擦拭后擦干，并定期检查组装连接是否紧固。",
      },
    ],
    limits: [
      "仅适用此货号；最大承重不表示可站人，也未核验实际组装或桌面载荷。",
      "人工整理的有限公开资料；未接入设备、订单或实物检测，不提供未审核的维修步骤。",
    ],
  },
  {
    id: "ikea-kallax-79384057",
    product: "IKEA KALLAX 卡莱克白色带门搁架",
    model: "793.840.57",
    version: "2026-10-18.1",
    source: {
      title: "IKEA 中国 · KALLAX 793.840.57 / 商品详情",
      url: "https://www.ikea.cn/cn/zh/p/kallax-qia-lai-ke-dai-men-ge-jia-dan-yuan-bai-se-s79384057/",
      section: "商品规格 / 安全与保养（对应页面）",
      checkedAt: "2026-10-18",
      kind: "official",
    },
    claims: [
      {
        id: "ikea-kallax-79384057:dimensions",
        text: "货号 793.840.57 的详细尺寸为宽 76.5、深 39、高 76.5 厘米。",
      },
      {
        id: "ikea-kallax-79384057:load",
        text: "该组合页面列出的每块搁板最大承重为 13 公斤。",
      },
      {
        id: "ikea-kallax-79384057:anchor",
        text: "官方提示该产品存在倾倒和掉落风险，必须牢固固定；固定件与墙体不确定时请咨询专业人员。",
      },
    ],
    limits: [
      "77×77 是页面名义规格；详细尺寸为 76.5×39×76.5 厘米。不能据此断定已完成固定或墙体适用。",
      "人工整理的有限公开资料；未接入设备、订单或实物检测，不提供未审核的维修步骤。",
    ],
  },
  {
    id: "ikea-billy-00522047",
    product: "IKEA BILLY 毕利白色书架",
    model: "005.220.47",
    version: "2026-10-18.1",
    source: {
      title: "IKEA 中国 · BILLY 005.220.47 / 商品详情",
      url: "https://www.ikea.cn/cn/zh/p/00522047/",
      section: "商品规格 / 安全与保养（对应页面）",
      checkedAt: "2026-10-18",
      kind: "official",
    },
    claims: [
      {
        id: "ikea-billy-00522047:dimensions",
        text: "货号 005.220.47 的宽、深、高分别为 80、28、202 厘米。",
      },
      {
        id: "ikea-billy-00522047:load",
        text: "该书架每块搁板的最大承重为 30 公斤。",
      },
      {
        id: "ikea-billy-00522047:anchor",
        text: "官方提示倾倒风险，要求将产品安全固定；无法确定适合的螺丝和螺栓时应咨询专业人员。",
      },
    ],
    limits: [
      "仅适用该货号；必须依说明确认固定，不能把固定事项完成当作专业安装验证。",
      "人工整理的有限公开资料；未接入设备、订单或实物检测，不提供未审核的维修步骤。",
    ],
  },
];
