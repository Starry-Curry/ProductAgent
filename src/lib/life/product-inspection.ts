import { z } from "zod";
import { fetchPublicDocument } from "./sources.ts";
import { officialDomain, modelMentioned } from "./knowledge.ts";
import { isProductManual } from "./manuals.ts";

/** No catalog requirement: this also accepts a SKU never seen during development. */
export async function inspectProduct(raw: unknown, get = fetchPublicDocument) {
  const v = z
    .object({
      url: z.string().max(2000),
      brand: z.string().max(80),
      model: z.string().max(100),
    })
    .strict()
    .parse(raw);
  const d = await get(v.url);
  const official =
    !!v.brand.trim() &&
    !!v.model.trim() &&
    v.model !== "待确认" &&
    officialDomain(d.url, v.brand) &&
    modelMentioned(d.title + " " + d.text, v.model);
  return {
    ...d,
    official,
    kind: "user-link",
    retrievedAt: new Date().toISOString(),
    manuals: d.links.filter(isProductManual),
    notice: official
      ? "已联网取得官方站点、匹配完整型号的资料草稿。确认实物及地区版本后录入；保存时服务器重新核对来源，不把公开资料当作你的实物状态。"
      : "已读取公开资料，尚未通过官方域名和完整型号核对。只作为本人提供的资料；请补全或纠正品牌型号，不冒充厂家事实。",
  };
}
