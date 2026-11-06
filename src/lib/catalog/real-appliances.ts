import type { Item } from "../domain.ts";
export type RealAppliance = {
  reviewedNotesHash: string;
  id: string;
  key: string;
  name: string;
  brand: string;
  model: string;
  region: string;
  variant: string;
  productUrl: string;
  imageUrl: string;
  manualUrl: string;
  itemIds: string[];
  photo: string;
  checkedAt: string;
  manualTitle: string;
  manualTextHash: string;
  manualPdfHash: string;
  pageNumbers: number[];
  photoSha256: string;
};
export const realAppliances: RealAppliance[] = [
  {
    id: "mi-lamp-1s-tw",
    key: "lamp",
    name: "米家 LED 智慧台灯 1S",
    brand: "小米",
    model: "MJTD01SYL",
    region: "tw",
    variant: "台湾版 · 白色",
    productUrl: "https://www.mi.com/tw/mi-led-desk-lamp-1s/",
    imageUrl:
      "https://i01.appmifile.com/webfile/globalimg/products/pc/mi-led-desk-lamp-1s/lamp1s-07a.jpg",
    manualUrl:
      "https://user-guide2024.cnbj1.mi-fds.com/user-guide2024/Taiwan/N/Mi%20Smart%20LED%20Desk%20Lamp%201S%20User%20Manual.pdf",
    itemIds: ["lamp"],
    photo: "/products/real-v1/mi-lamp-1s-tw.webp",
    manualTextHash:
      "6b8ca4723e841ecccf71cc8448d01ef654e71c8e0183c61253ea16a358533d5d",
    manualPdfHash:
      "2f64790d6bf8062ceb1812c175c50a76d298964bb7b3179d20e096e9c1c1acdc",
    pageNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    checkedAt: "2026-11-06",
    manualTitle: "米家 LED 智慧台灯 1S MJTD01SYL · 官方使用说明书",
    photoSha256:
      "5534ffa3f6b5f5af4c14ad015772cbccd5843dac65f3c33d04abebc6e2e97360",
    reviewedNotesHash:
      "15fd91bb7c2589015169cea00ddb8384649ccaf17fc40cc2b97ce5368f0c8625",
  },
  {
    id: "philips-add6910-hk",
    key: "filter",
    name: "飞利浦 RO 净饮机",
    brand: "飞利浦",
    model: "ADD6910",
    region: "hk",
    variant: "ADD6910/90 · 香港版",
    productUrl:
      "https://www.philips.com.hk/en/c-p/ADD6910_90/ro-water-dispenser",
    imageUrl:
      "https://images.philips.com/is/image/philipsconsumer/0f385fe3840d47fcb8a7af2300f47a7c?$png$&wid=800&hei=800&fit=constrain",
    manualUrl:
      "https://www.documents.philips.com/assets/20221003/bd20017ac37440a48eb4af23012764c5.pdf",
    itemIds: ["filter"],
    photo: "/products/real-v1/philips-add6910-hk.webp",
    manualTextHash:
      "b5cf9dda559e6eebd3e7b88310aa642bbb13c58e3656ec8d952ecc21b2ae6ede",
    manualPdfHash:
      "2a4bf4953d1952dc107ff990cf016d513710decbc54bbd7d06b52a9bd3cd340f",
    pageNumbers: [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      22, 23, 24, 25, 26,
    ],
    checkedAt: "2026-11-06",
    manualTitle: "飞利浦 RO 净饮机 ADD6910 · 官方使用说明书",
    photoSha256:
      "33378fb3333fa3f65422f7adf401722e88192eb5d81a5f6689def76231198f7d",
    reviewedNotesHash:
      "83c3b869fab30a00dcae1ad396ec7da651a03391cee64c03dca3d49802eb9d8d",
  },
  {
    id: "xiaomi-kettle2-uk",
    key: "kettle",
    name: "小米 Electric Kettle 2 电热水壶",
    brand: "小米",
    model: "MJDSH04YM",
    region: "uk",
    variant: "UK/EU 220–240V · 白色",
    productUrl: "https://www.mi.com/uk/product/xiaomi-electric-kettle-2/",
    imageUrl:
      "https://i01.appmifile.com/v1/MI_18455B3E4DA706226CF7535A58E875F0267/pms_1672993563.59472856.png",
    manualUrl:
      "https://cdn.alsgp0.fds.api.mi-img.com/cwdq/2025/Xiaomi%20Electric%20Kettle%202/EU/Xiaomi%20Electric%20Kettle%202.pdf",
    itemIds: ["demo-household-kettle", "life-sample-3"],
    photo: "/products/real-v1/xiaomi-kettle2-uk.webp",
    manualTextHash:
      "af8420bbd5e1f5924a9271e4a9b342c0ff70de85f36da88fb3621c164d658fa5",
    manualPdfHash:
      "a567f820b4036e1c1e2ae82cf46df86d963a6940c1dfdbc07465184a625a098b",
    pageNumbers: [1, 2, 3, 4, 5, 6, 7, 8],
    checkedAt: "2026-11-06",
    manualTitle: "小米 Electric Kettle 2 电热水壶 MJDSH04YM · 官方使用说明书",
    photoSha256:
      "a176f4b0e00acf0c208f109b25c7e575d9526fef48efd35129e58c0249ac4904",
    reviewedNotesHash:
      "7cb12718c882b672701ac1710885057e8d187eca2f706893431a6d2653bc532e",
  },
  {
    id: "xiaomi-purifier4lite-global",
    key: "purifier",
    name: "小米 Smart Air Purifier 4 Lite 空气净化器",
    brand: "小米",
    model: "AC-M17-SC",
    region: "global",
    variant: "国际版 · 白色",
    productUrl:
      "https://www.mi.com/global/product/xiaomi-smart-air-purifier-4-lite/",
    imageUrl:
      "https://i01.appmifile.com/v1/MI_18455B3E4DA706226CF7535A58E875F0267/pms_1666841860.93832993.png",
    manualUrl:
      "https://cdn.azams0.fds.api.mi-img.com/xiaomi-b2c-i18n-upload/User-Guide-Upload-mi.com/Air_Purifier/35053-Xiaomi-Smart-Air-Purifier4-UserGuide-EU.pdf",
    itemIds: ["demo-household-purifier", "life-sample-4"],
    photo: "/products/real-v1/xiaomi-purifier4lite-global.webp",
    manualTextHash:
      "35c7e7c4c318ad1b1b8d3bcaa53b6f241ef870b58fc8c6547dca34bce8a4e305",
    manualPdfHash:
      "f21907d886ae4a2f76344c195d46d3bb09eaed5a3f84397f460b626f8d217f1b",
    pageNumbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    checkedAt: "2026-11-06",
    manualTitle:
      "小米 Smart Air Purifier 4 Lite 空气净化器 AC-M17-SC · 官方使用说明书",
    photoSha256:
      "0f7d6a19ffe2c17d3864d422d37a52a77c42232f5fce00db3cffb20f11bb67af",
    reviewedNotesHash:
      "f5ea315de466131f1a9a5290027b10b6a585e34084f5aaf96c6b2864d6db960b",
  },
  {
    id: "xiaomi-airfryer65-uk",
    key: "fryer",
    name: "小米 Smart Air Fryer 6.5L 空气炸锅",
    brand: "小米",
    model: "MAF10",
    region: "uk",
    variant: "UK/GB 版 · 白色",
    productUrl:
      "https://www.mi.com/uk/product/xiaomi-smart-air-fryer-6-5-liter/",
    imageUrl:
      "https://i05.appmifile.com/123_item_uk/25/03/2024/4e05f4e82b74ea5d42a0d0b86a375665.png",
    manualUrl:
      "https://cdn.azams0.fds.api.mi-img.com/xiaomi-b2c-i18n-upload/EU-ERP-Userguide-upload/Kitchen-and-bathroom-appliances/47711-Xiaomi-Smart-Air-Fryer-6.5L-Black&White-UserGuide-GB.pdf",
    itemIds: ["demo-household-fryer", "life-sample-5"],
    photo: "/products/real-v1/xiaomi-airfryer65-uk.webp",
    manualTextHash:
      "b43f64b6f14fd462d785e45bdd01cea012993a8055142b962b636ac1c0dca7c0",
    manualPdfHash:
      "167b65ea0ed12f834cb18f26fd1f3bc1d7aa5672312118349c9e13ef8c7e0df7",
    pageNumbers: [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ],
    checkedAt: "2026-11-06",
    manualTitle: "小米 Smart Air Fryer 6.5L 空气炸锅 MAF10 · 官方使用说明书",
    photoSha256:
      "dad594accd01fdf15cb2fdf28d3f97ca6d512c3ac583bad3753a44dfaba5f825",
    reviewedNotesHash:
      "7fb5427c0c7ad66c8e2e92bc9a2f2b8f6d4eb4c84b59ccad6c74d0f5e66a9e17",
  },
  {
    id: "xiaomi-g20lite-uk",
    key: "vacuum",
    name: "小米 Vacuum Cleaner G20 Lite 无线吸尘器",
    brand: "小米",
    model: "C203",
    region: "uk",
    variant: "UK 版 · 白色",
    productUrl: "https://www.mi.com/uk/product/xiaomi-vacuum-cleaner-g20-lite/",
    imageUrl:
      "https://i02.appmifile.com/232_item_au/18/09/2025/ac967a38c37a28cf1135c8afbf4b6b5d.png",
    manualUrl:
      "https://xiaomi-b2c-i18n-upload.azams0.mi-fds.com/xiaomi-b2c-i18n-upload/EU-ERP-Userguide-upload/Vacuum-Cleaner/55018-Xiaomi-Vacuum-Cleaner-G20-Lite-UserGuide-UK.pdf",
    itemIds: ["demo-household-vacuum", "life-sample-6"],
    photo: "/products/real-v1/xiaomi-g20lite-uk.webp",
    manualTextHash:
      "228767d8dbf3054cfc040911cfc4ccbf3f6a47ed2c3f9f2246d3dd18d34eb76a",
    manualPdfHash:
      "627ed4dcacdf011a96e5315bc74f7d0b74ea9b556488d1f83b4d565c3fc6c45c",
    pageNumbers: [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      22, 23, 24, 25,
    ],
    checkedAt: "2026-11-06",
    manualTitle:
      "小米 Vacuum Cleaner G20 Lite 无线吸尘器 C203 · 官方使用说明书",
    photoSha256:
      "1d5771289320c7a3f6ea493624a803d9fa933577af0e2255be37db7e1d8d21af",
    reviewedNotesHash:
      "c04421db5d6c798bc04a9f8944be68872ea93d9e80424c3fa64c910d1e274d21",
  },
  {
    id: "logitech-m185-mr0061",
    key: "mouse",
    name: "罗技 M185 无线鼠标",
    brand: "罗技",
    model: "M-R0061",
    region: "unspecified",
    variant: "M185 · M-R0061 硬件版 · 灰色",
    productUrl:
      "https://www.logitech.com/en-us/products/mice/m185-wireless-mouse.html",
    imageUrl:
      "https://resource.logitech.com/w_800,c_limit,q_auto,f_png,dpr_1.0/d_transparent.gif/content/dam/logitech/en/products/mice/m185/gallery/2025-update-assets/m185-grey-top-angle-1.png",
    manualUrl:
      "https://www.logitech.com/assets/42356/5/m185-quick-start-guide.pdf",
    itemIds: ["life-sample-0"],
    photo: "/products/real-v1/logitech-m185-mr0061.webp",
    manualTextHash:
      "6bd25dfecc8e181a753b1f698f1a5536d25bf93e109fa16363cbe976158b4a09",
    manualPdfHash:
      "14ae0507d2ddb74e80544074df39e654e3680fe6ccfbe18438ebd8888b3f49ac",
    pageNumbers: [1, 2],
    checkedAt: "2026-11-06",
    manualTitle: "罗技 M185 · 官方快速入门指南（含已核对图示转写）",
    photoSha256:
      "b59cc6e134c4fd9da1357e2eacd809c246ddd0df6846f3a5eb206600876fc226",
    reviewedNotesHash:
      "66b682bf599e635f11411ccfdf425ba7a4a2b1a8146ee7a27ddb4b481186a4d8",
  },
  {
    id: "jbl-go4-global",
    key: "speaker",
    name: "JBL GO 4 便携蓝牙音箱",
    brand: "JBL",
    model: "GO 4",
    region: "global",
    variant: "国际版 · 白色",
    productUrl: "https://www.jbl.com/GO-4.html",
    imageUrl:
      "https://www.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dw2b9b5788/JBL_GO_4_HERO_GREY_48155_x4%20%281%29.png?sh=800&sw=800",
    manualUrl:
      "https://global.jbl.com/on/demandware.static/-/Sites-masterCatalog_Harman/default/dw4e5b74f6/pdfs/PA_JBL_GO%204_QSG_Global_SOP.pdf",
    itemIds: ["life-sample-1"],
    photo: "/products/real-v1/jbl-go4-global.webp",
    manualTextHash:
      "6e10e4bf6ad60d5e75e86904f88595de8c642f411f029bd13794684da76a532c",
    manualPdfHash:
      "8dccd011dfc9de3a9983f5eaa0691f77d3cbb93516c2236df481959b0385c3db",
    pageNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    checkedAt: "2026-11-06",
    manualTitle:
      "JBL GO 4 便携蓝牙音箱 GO 4 · 官方使用说明书（含已核对图示转写）",
    photoSha256:
      "604935df405cedb453679199833a4e199d49d1939e7fc79436741e9fbaff85a6",
    reviewedNotesHash:
      "fdc863cf139ecff69a0d1e826e35c0fb63de6f96cc71526ce32039bcb845325b",
  },
  {
    id: "sony-wx350",
    key: "camera",
    name: "索尼 Cyber-shot 数码相机",
    brand: "索尼",
    model: "DSC-WX350",
    region: "unspecified",
    variant: "DSC-WX350 · 黑/白/粉官方产品展示",
    productUrl: "https://www.sony.jp/cyber-shot/products/DSC-WX350/",
    imageUrl: "https://www.sony.jp/products/picture/middle/DSC-WX350.jpg",
    manualUrl: "https://helpguide.sony.net/gbmig/45298511/v1/en/print.pdf",
    itemIds: ["life-sample-13"],
    photo: "/products/real-v1/sony-wx350.webp",
    manualTextHash:
      "454cf1dd7b9f19f3195c26dbb6a785257c9d8276f5979031b86a4f30a1f09d95",
    manualPdfHash:
      "9c0d52fdc0c7a3b5af9cbf5575a39b73837a5fc6a75eff8a1ced335c617d556b",
    pageNumbers: [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
      40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
      58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75,
      76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93,
      94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
      110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124,
      125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137,
    ],
    checkedAt: "2026-11-06",
    manualTitle: "索尼 Cyber-shot 数码相机 DSC-WX350 · 官方使用说明书",
    photoSha256:
      "7cb9d6e12309a3a162fb538dcea26483ceec382162341df9873668e5d4ab0844",
    reviewedNotesHash:
      "f698eb2c684f4913328ae685f15d613de2dc55fc686c7ac1818f9bf6e7d33daa",
  },
];
export function referenceAppliance(item: Item) {
  const p = realAppliances.find((p) => p.id === item.referenceProductId);
  return p &&
    item.brand === p.brand &&
    item.model === p.model &&
    item.region === p.region
    ? p
    : undefined;
}
export function bindReferenceAppliance(item: Item, id: string) {
  const p = realAppliances.find((p) => p.id === id);
  if (!p) throw Error("没有这款已核验的产品");
  item.brand = p.brand;
  item.model = p.model;
  item.region = p.region;
  item.referenceProductId = p.id;
  item.photo = p.photo;
  item.supportUrl = p.productUrl;
  item.source = "已选定真实型号的产品样例";
  if (item.note === "合成物品实例；分类照片为示意照，不代表该型号实拍。")
    item.note = "对应官方产品图；问答默认使用档案型号与官方说明书。";
  if (item.note === "维护周期是演示设置，不是厂家建议。")
    item.note =
      "滤芯与保养要求以这款产品的说明书为准；家庭维护日期为用户记录。";
  delete item.productBinding;
  return item;
}
