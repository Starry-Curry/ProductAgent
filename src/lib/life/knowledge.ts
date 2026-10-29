import { createHash } from "node:crypto";
import { z } from "zod";
import { productPacks } from "../products.ts";
import { fetchPublicDocument, sourceURL } from "./sources.ts";

const brands = [
  {
    names: ["jbl"],
    domains: ["jbl.com", "jbl.com.cn"],
    home: "https://www.jbl.com/",
  },
  {
    names: ["jellycat"],
    domains: ["jellycat.com"],
    home: "https://jellycat.com/",
  },
  {
    names: ["乐高", "lego"],
    domains: ["lego.com"],
    home: "https://www.lego.com/service/buildinginstructions/",
  },
  {
    names: ["patagonia", "巴塔哥尼亚"],
    domains: ["patagonia.com"],
    home: "https://www.patagonia.com/",
  },
  {
    names: ["索尼", "sony"],
    domains: ["sony.com", "sony.net", "sony-asia.com"],
    home: "https://www.sony.com/electronics/support/",
  },
  {
    names: ["宜家", "ikea"],
    domains: ["ikea.cn", "ikea.com"],
    home: "https://www.ikea.cn/cn/zh/",
  },
  {
    names: ["飞利浦", "philips"],
    domains: [
      "philips.com.cn",
      "philips.com",
      "philips.com.tw",
      "documents.philips.com",
    ],
    home: "https://www.philips.com.cn/c-w/support-home.html",
  },
  {
    names: ["小米", "米家", "xiaomi"],
    domains: ["mi.com", "mi-img.com", "mi-fds.com", "xiaomi.com"],
    home: "https://www.mi.com/service/",
  },
  {
    names: ["罗技", "logitech", "logi"],
    domains: ["logitech.com", "logi.com"],
    home: "https://support.logi.com/hc/zh-cn",
  },
] as const;
export function brandEntry(brand: string) {
  return brands.find((b) =>
    b.names.some((n) => brand.toLowerCase().includes(n)),
  );
}
export function officialDomain(url: string, brand: string) {
  const host = sourceURL(url).hostname,
    b = brandEntry(brand);
  return !!b?.domains.some((d) => host === d || host.endsWith("." + d));
}
export function modelMentioned(text: string, model: string) {
  const words =
    model
      .normalize("NFKC")
      .toLowerCase()
      .match(/[a-z0-9]+|[\p{Script=Han}]+/gu) || [];
  if (!words.length) return false;
  const pattern = words
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s._/–-]*");
  return new RegExp(`(^|[^a-z0-9])${pattern}(?![a-z0-9])`, "iu").test(
    text.normalize("NFKC"),
  );
}
export type PublicDocument = Awaited<ReturnType<typeof fetchPublicDocument>>;
export const officialQuery = z
  .object({
    brand: z.string().trim().min(1).max(80),
    model: z.string().trim().min(2).max(100),
  })
  .strict();
/** Small official adapters, not a global search engine. Only explicit user brand/model leaves this machine. */
export async function findOfficial(
  raw: unknown,
  fetchDocument = fetchPublicDocument,
) {
  const { brand, model } = officialQuery.parse(raw),
    b = brandEntry(brand);
  const normalized = model.replace(/[.\s]/g, "");
  const candidates = productPacks
    .filter(
      (p) =>
        modelMentioned(`${p.model}`, model) &&
        `${p.product}`.toLowerCase().includes(brand.toLowerCase()),
    )
    .map((p) => p.source.url);
  if (b?.domains[0] === "lego.com" && /^\d{4,6}$/.test(model))
    candidates.push(
      `https://www.lego.com/en-us/service/buildinginstructions/${model}`,
    );
  if (b?.domains[0] === "ikea.cn" && /^\d{8}$/.test(normalized))
    candidates.push(`https://www.ikea.cn/cn/zh/p/${normalized}/`);
  if (
    b?.domains[0] === "philips.com.cn" &&
    /^[a-z]{1,5}\d{3,6}[\/_-]\d{2}$/i.test(normalized)
  )
    candidates.push(
      `https://www.philips.com.cn/c-p/${normalized.replace(/[/-]/g, "_")}/-/support`,
    );
  const documents: PublicDocument[] = [],
    issues: string[] = [];
  for (const url of [...new Set(candidates)].slice(0, 2)) {
    try {
      const d = await fetchDocument(url);
      if (
        !officialDomain(d.url, brand) ||
        !modelMentioned(d.title + " " + d.text, model)
      ) {
        issues.push(
          "站点返回内容未匹配完整型号，未采用；请核对地区与型号后缀。",
        );
        continue;
      }
      documents.push(d);
    } catch {
      issues.push(
        "官方候选未公开返回可读取资料；没有绕过限制，可人工打开官网或上传说明书。",
      );
    }
  }
  return {
    documents,
    issues,
    officialHome: b?.home,
    searchURL: `https://www.bing.com/search?q=${encodeURIComponent(`${b ? "site:" + b.domains[0] + " " : ""}${brand} ${model} 官方 说明书 FAQ`)}`,
    notice: documents.length
      ? "已找到官方站点与完整型号匹配的公开摘录。请核对实物、地区、后缀后选用；没有自动认证为完整Product Pack。"
      : "未取得可核对的完整型号正文。本机仅有有限官方地址适配，不假装已搜索全网；可打开官网检索、粘贴最终链接或上传说明书。",
  };
}
export function organizeKnowledge(
  source: {
    id: string;
    text: string;
    title: string;
    url: string | null;
    kind: string;
  },
  model?: string,
) {
  const sections: {
    id: string;
    category: string;
    quote: string;
    start: number;
    end: number;
  }[] = [];
  const groups: [string, RegExp][] = [
    ["注意事项", /警告|注意|禁止|切勿|不得|不可|warning|caution|do not/i],
    [
      "使用方法",
      /按下|开启|插入|放入|选择|连接|操作|步骤|press|turn on|connect|insert/i,
    ],
    ["养护", /洗涤|清洗|清洁|擦|保养|浇水|洗护|clean|wipe|wash/i],
    ["功能", /支持|可以|功能|配有|可调|supports|features/i],
    ["规格", /\d\s*(?:V\b|W\b|℃|厘米|cm\b|mm\b|kg\b|升|mAh\b)/i],
  ];
  for (const m of source.text.matchAll(/[^。！？\n]+[。！？]?/g)) {
    const quote = m[0].trim(),
      start = m.index! + m[0].indexOf(quote);
    if (quote.length < 5 || quote.length > 600) continue;
    const group = groups.find(([, pattern]) => pattern.test(quote));
    if (group)
      sections.push({
        id: createHash("sha256")
          .update(`${source.id}:${start}:${quote}`)
          .digest("hex")
          .slice(0, 16),
        category: group[0],
        quote,
        start,
        end: start + quote.length,
      });
    if (sections.length >= 30) break;
  }
  return {
    applicableModel: model || "型号未确认",
    modelInDocument:
      !!model && modelMentioned(source.text + " " + source.title, model),
    provenance:
      source.kind === "official-public"
        ? "已核对官方站点的公开摘录，未做实物或完整语义验证"
        : "本人提供，来源/适用性待核对",
    sections,
  };
}
