import { alphaProductPacks } from "./catalog/alpha-products.ts";
import { householdProductPacks } from "./catalog/household-products.ts";
export type ProductPack = {
  understanding?: {
    properties: { key: string; value: string; factIds: string[] }[];
    unknowns: string[];
    possibilities: {
      function: string;
      principle: string;
      basisFactIds: string[];
      conditions: string[];
    }[];
  };
  id: string;
  product: string;
  model: string;
  version: string;
  source: {
    title: string;
    url: string;
    section: string;
    checkedAt: string;
    kind: "official";
  };
  claims: { id: string; text: string }[];
  /** Optional reviewed procedures. A specification claim never implicitly becomes an operation. */
  procedures?: {
    id: string;
    title: string;
    goal: string;
    preconditions: string[];
    steps: { id: string; text: string; sourceSection: string }[];
    limits: string[];
    fieldChecks: string[];
    sourceUrl: string;
    model: string;
    region?: string;
  }[];
  capabilities?: string[];
  constraints?: {
    indoorOnly?: boolean;
    maxLoadKg?: number;
    foodContact?: boolean;
    quantityForStereo?: number;
  };
  limits: string[];
};

// Small, manually curated catalog. Never infer hardware revision from appearance.
export const productPacks: ProductPack[] = ["M-R0061", "MR0102"].map(
  (model) => ({
    id: `logitech-m185-${model.toLowerCase()}`,
    product: "Logitech 罗技 M185 无线鼠标",
    model,
    version: "2026-10-16.1",
    source: {
      title: "Logitech M185 Technical Specifications",
      url: "https://support.logi.com/hc/en-za/articles/360023302074-M185-Technical-Specifications",
      section: `${model} / Mouse Specifications & Receiver Specifications`,
      checkedAt: "2026-10-16",
      kind: "official" as const,
    },
    claims: [
      { id: `${model}:battery`, text: "电源为一节可更换 AA 电池。" },
      {
        id: `${model}:connection`,
        text: `使用 2.4GHz 非 Unifying 无线连接；此版本列出的 USB 接收器型号为 ${model === "MR0102" ? "CU0019" : "C-U0010"}。`,
      },
      { id: `${model}:switch`, text: "鼠标带有开关，规格表没有列出指示灯。" },
    ],
    limits: [
      "请核对鼠标底部 M/N；M185 系列名不足以确定硬件版本。",
      "本资料包只有规格摘编，不含配对、更换电池或维修操作教程。",
      "列出原配接收器不代表任意同型号接收器都能直接使用；兼容与配对需另行核实。",
    ],
  }),
);

productPacks.push(
  {
    id: "jbl-go4",
    product: "JBL Go 4 便携音箱",
    model: "GO 4",
    version: "2026-10-17.1",
    source: {
      title: "JBL Go 4 official specifications",
      url: "https://www.jbl.com/GO-4.html",
      section: "Features / Control and Connection Specifications",
      checkedAt: "2026-10-17",
      kind: "official",
    },
    claims: [
      { id: "go4:bluetooth", text: "JBL Go 4 使用蓝牙 5.3。" },
      {
        id: "go4:stereo",
        text: "两台 JBL Go 4 可以组成立体声；多音箱连接要求兼容 JBL Auracast。",
      },
      { id: "go4:protection", text: "JBL Go 4 的官方防尘防水等级为 IP67。" },
    ],
    limits: [
      "必须核对 GO 4，不能套用于 GO 3 或其他型号。",
      "资料没有证明当前电量、连接状态或配对成功；防水等级不是主动浸水或湿态充电建议。",
    ],
    capabilities: ["audio-playback"],
    constraints: { quantityForStereo: 2 },
  },
  {
    id: "ikea-raskog-30629711",
    product: "IKEA RÅSKOG 米色推车",
    model: "306.297.11",
    version: "2026-10-17.1",
    source: {
      title: "IKEA UAE RÅSKOG 306.297.11",
      url: "https://www.ikea.com/ae/en/p/raskog-trolley-beige-30629711/",
      section: "Good to know / Measurements",
      checkedAt: "2026-10-17",
      kind: "official",
    },
    claims: [
      {
        id: "raskog:load",
        text: "货号 306.297.11 的单层载荷上限为 6 千克，总载荷上限为 18 千克。",
      },
      {
        id: "raskog:indoor",
        text: "货号 306.297.11 仅适合室内使用，未获准用于直接接触食品。",
      },
      {
        id: "raskog:dimensions",
        text: "货号 306.297.11 的尺寸为长 35、宽 45、高 77 厘米。",
      },
    ],
    limits: [
      "仅适用于该货号与页面地区规格，旧款相似推车不得直接沿用。",
      "未确认实际载荷、地面和稳定性之前，不判定当前摆放安全。",
    ],
    capabilities: ["indoor-storage"],
    constraints: { indoorOnly: true, maxLoadKg: 18, foodContact: false },
  },
);

productPacks.push(...householdProductPacks, ...alphaProductPacks);

export function findPack(id: string) {
  return productPacks.find((p) => p.id === id);
}
export function searchProducts(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return productPacks
    .filter((p) => {
      const text = `${p.product} ${p.model}`.toLowerCase();
      const model = p.model.toLowerCase().replace(/[\s_/-]/g, "");
      return (
        text.includes(q) ||
        (model.length >= 4 && q.replace(/[\s_/-]/g, "").includes(model))
      );
    })
    .slice(0, 3);
}
