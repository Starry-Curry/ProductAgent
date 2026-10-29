import { isProductManual } from "./manuals.ts";
import { z } from "zod";
import { productPacks } from "../products.ts";
import { AgentError } from "../agent/contracts.ts";
import { fetchPublicDocument, sourceURL } from "./sources.ts";
import { modelMentioned } from "./knowledge.ts";

export const arrivalProducts = () =>
  productPacks.filter(
    (p) =>
      ["194.408.48", "103.926.01", "GO 4"].includes(p.model) ||
      /jbl.*go.?4/i.test(p.id),
  );

/** Deliberately small reviewed catalogue. A fetched page never silently becomes verified knowledge. */
export async function recognizeProduct(
  input: unknown,
  fetcher = fetchPublicDocument,
) {
  const { query, refresh } = z
    .object({
      query: z.string().trim().min(1).max(2000),
      refresh: z.boolean().default(false),
    })
    .strict()
    .parse(input);
  const products = arrivalProducts();
  let matches = products.filter((p) =>
    [p.product, p.model, p.id].some(
      (s) =>
        s.toLowerCase().includes(query.toLowerCase()) ||
        query.toLowerCase().includes(s.toLowerCase()),
    ),
  );
  if (/^https?:/i.test(query)) {
    const u = sourceURL(query);
    matches = products.filter((p) => {
      const official = new URL(p.source.url);
      return (
        u.hostname === official.hostname &&
        u.pathname.replace(/\/$/, "") === official.pathname.replace(/\/$/, "")
      );
    });
    if (!matches.length)
      return {
        products: [],
        message: /(^|\.)tmall\.com$/.test(u.hostname)
          ? "尚未接通天猫接口。此链接不能可靠核实型号；请提供商品型号或对应品牌官网链接，无需登录或提供 Cookie。"
          : "此链接尚无经核对的型号资料。可先手动录入，资料保持待核实；目前支持下方三个型号的官方商品链接。",
      };
  }
  if (!matches.length)
    return {
      products: [],
      message:
        "还未找到经核对的型号。可使用 SAMLA、KNAGGLIG、JBL GO 4，或手动认识其他物品。",
    };
  const results = [];
  for (const pack of matches.slice(0, 3)) {
    let retrieval = {
      status: "reviewed-cache",
      checkedAt: pack.source.checkedAt,
      message: "使用已核对的型号资料；未重新读取网页。",
      manuals: [] as { title: string; url: string }[],
    };
    if (refresh) {
      try {
        const doc = await fetcher(pack.source.url);
        if (!modelMentioned(doc.text, pack.model))
          throw new AgentError("网页未能核实相同型号");
        retrieval = {
          status: "official-page-read",
          checkedAt: new Date().toISOString(),
          message:
            "已读取官方页面并核对型号；下方仍为经审核的事实，网页变化不会自动覆盖事实。",
          manuals: doc.links.filter(isProductManual).slice(0, 4),
        };
      } catch {
        retrieval.message =
          "官方页面暂时无法完整读取或未能核实型号，保留已核对资料及原核对日期；不代表刚刚验证成功。";
      }
    }
    results.push({ pack, retrieval });
  }
  return {
    products: results,
    message: "型号资料不是你的持有证明；确认实物与型号相符后，再建立私人记录。",
  };
}
