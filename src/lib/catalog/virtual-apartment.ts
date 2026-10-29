/** Fixed, explicitly synthetic household. URLs identify products, never prove ownership. */
export const APARTMENT_ID = "young-apartment-v1";
export const apartmentProducts = [
  {
    key: "lamp",
    brand: "小米",
    name: "米家台灯1S",
    model: "MJTD01SYL",
    category: "照明",
    location: "书桌左后侧（模拟，尚未测量占地）",
    url: "https://www.mi.com/mjsmartlamp-1s/specs",
    manuals: [
      {
        url: "https://user-guide2024.cnbj1.mi-fds.com/user-guide2024/Hong%20Kong/N/Mi%20Smart%20LED%20Desk%20Lamp%201S%20User%20Manual.pdf",
        region: "hk",
        note: "官方香港版，电气参数与大陆版不混用；操作需核对实物版本",
      },
    ],
    note: "模拟设定：有原装适配器，旋钮外观完好；未连接网络。未进行真实设备检测。",
  },
  {
    key: "desk",
    brand: "IKEA",
    name: "MICKE 白色书桌",
    model: "803.542.81",
    category: "家具",
    location: "公寓靠墙的工作区",
    url: "https://www.ikea.cn/cn/zh/p/micke-desk-white-80354281/",
    note: "模拟设定：已装好，桌上物品可挪动；实际空余面积、插座位置及平整度未测量。",
  },
  {
    key: "samla",
    brand: "IKEA",
    name: "SAMLA 透明收纳盒",
    model: "194.408.48",
    category: "收纳用品",
    location: "书桌右后侧（模拟）",
    url: "https://www.ikea.cn/cn/zh/p/samla-box-with-lid-transparent-s19440848/",
    note: "模拟设定：放着旅行纸质纪念品，盖子在旁边；磨损与密合度未验证。",
  },
  {
    key: "knagglig",
    brand: "IKEA",
    name: "KNAGGLIG 松木盒",
    model: "103.926.01",
    category: "收纳用品",
    location: "书桌下的开放位置（模拟）",
    url: "https://www.ikea.cn/cn/zh/p/knagglig-ka-na-ge-he-song-mu-10392601/",
    note: "模拟设定：空盒可挪动；没有额外的盖子，不当作坐凳或墙架。",
  },
  {
    key: "speaker",
    brand: "JBL",
    name: "GO 4 蓝牙音箱",
    model: "GO 4",
    category: "音箱",
    location: "窗边（模拟）",
    url: "https://www.jbl.com/GO-4.html",
    alternatives:["https://www.jbl.com/on/demandware.static/-/Sites-masterCatalog_Harman/default/dw9308649c/pdfs/JBL%20Go%204_%20Specsheet_EN.pdf"],
    manuals: [
      {
        url: "https://support.jbl.com/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwfff30b69/pdfs/PA_JBL_GO%204_QSG_Global_SOP.pdf",
        region: "global",
        note: "官方全球快速入门指南；需核对地区与版本，私人充电状态未知",
      },
    ],
    note: "模拟设定：充电与连接状态未知。安静任务中不自动播放。",
  },
  {
    key: "bunny",
    brand: "Jellycat",
    name: "Bashful Beige Bunny",
    model: "BAS3B",
    category: "毛绒玩具",
    location: "床头（模拟）",
    url: "https://jellycat.com/bashful-beige-bunny/?sku=BAS3B",
    note: "模拟设定：搬家后留下的陪伴物；具体SKU尺寸、填充与清洗条件若官网未明确则保留未知。",
  },
  {
    key: "roses",
    brand: "LEGO",
    name: "玫瑰花束",
    model: "10328",
    category: "拼搭摆件",
    location: "客厅搁板（模拟）",
    url: "https://www.lego.com/en-us/product/bouquet-of-roses-10328",
    alternatives: [
      "https://www.lego.com/en-us/service/building-instructions/10328",
    ],
    manuals: [
      {
        url: "https://www.lego.com/cdn/product-assets/product.bi.core.pdf/6536293.pdf",
        region: "global",
        note: "从官方10328拼搭说明页实际发现的一册说明书，非全套；私人拼搭状态独立",
      },
    ],
    note: "模拟设定：已经拼好，没有额外花瓶；站立支撑与占地未知。",
  },
] as const;
export const homeItemId = (actor: string, key: string) =>
  `virtual-home:${actor}:${key}`;
