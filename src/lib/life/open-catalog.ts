import { z } from "zod";
import { AgentError } from "../agent/contracts.ts";
import { fetchPublicDocument } from "./sources.ts";
export type CatalogCandidate = {
  name: string;
  brand: string;
  model: string;
  category: string;
  lifecycle: "消耗型" | "长期耐用";
  source: { title: string; url: string; text: string; kind: "user-link" };
  license: string;
  fetchedAt: string;
  trust: "community-metadata";
  version: string;
};
const cache = new Map<string, { until: number; value: CatalogCandidate[] }>();
const nextRequest = new Map<string, number>();
const checksum = (code: string) =>
  (10 -
    ([...code.slice(0, -1)]
      .reverse()
      .reduce((s, c, i) => s + Number(c) * (i % 2 === 0 ? 3 : 1), 0) %
      10)) %
    10 ===
  Number(code.at(-1));
export async function lookupOpenCatalog(
  raw: unknown,
  readDocument = fetchPublicDocument,
) {
  const code = z
    .string()
    .trim()
    .max(32)
    .parse(raw)
    .replace(/[ -]/g, "")
    .toUpperCase();
  const isbn10 =
    /^\d{9}[\dX]$/.test(code) &&
    [...code].reduce(
      (s, c, i) => s + (c === "X" ? 10 : Number(c)) * (10 - i),
      0,
    ) %
      11 ===
      0;
  const gtin = /^\d{8}$|^\d{12,14}$/.test(code) && checksum(code);
  if (!isbn10 && !gtin)
    throw new AgentError("编码格式或校验位无效，请核对包装/ISBN；不会猜商品");
  const book = isbn10 || /^97[89]\d{10}$/.test(code),
    key = (book ? "isbn:" : "food:") + code;
  const old = cache.get(key);
  if (old && old.until > Date.now())
    return {
      candidates: old.value,
      cached: true,
      notice: "公共数据库候选，请核对版本和实物包装，不代表已经持有。",
    };
  const provider = book ? "library" : "food";
  if ((nextRequest.get(provider) || 0) > Date.now())
    throw new AgentError("公开资料查询过于频繁，请稍候再试；未自动重试", 429);
  nextRequest.set(provider, Date.now() + (book ? 1100 : 4100));
  const now = new Date().toISOString();
  let candidates: CatalogCandidate[] = [];
  try {
    if (book) {
      const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${code}&jscmd=data&format=json`;
      let b: any;
      try {
        b = JSON.parse((await readDocument(url)).text)["ISBN:" + code];
      } catch {
        const edition = JSON.parse(
          (await readDocument(`https://openlibrary.org/isbn/${code}.json`))
            .text,
        );
        b = {
          ...edition,
          authors: [],
          publishers: (edition.publishers || []).map((name: string) => ({
            name,
          })),
          authorReferences: edition.authors || [],
        };
      }
      if (b?.title) {
        const authors = (b.authors || [])
          .map((a: any) => a.name)
          .filter((a: unknown) => typeof a === "string")
          .slice(0, 8);
        candidates = [
          {
            name: String(b.title).slice(0, 80),
            brand: authors.join("、").slice(0, 80),
            model: code,
            category: "图书",
            lifecycle: "长期耐用",
            license:
              "Open Library开放书目/CC0贡献；封面与正文权利独立，未下载封面或书籍内容",
            version: String(b.publish_date || "未提供出版日期"),
            fetchedAt: now,
            trust: "community-metadata",
            source: {
              title: "Open Library书目候选（需核对版本）",
              url: `https://openlibrary.org/isbn/${code}`,
              kind: "user-link",
              text: JSON.stringify(
                {
                  source: "Open Library",
                  isbn: code,
                  title: b.title,
                  authors,
                  publishDate: b.publish_date,
                  authorReferences: b.authorReferences,
                  publishers: (b.publishers || []).map((p: any) => p.name),
                  pages: b.number_of_pages,
                  fetchedAt: now,
                  license: "开放书目/CC0贡献；非图书内容或官方使用知识",
                },
                null,
                2,
              ),
            },
          },
        ];
      }
    } else {
      const fields =
        "code,product_name,brands,quantity,ingredients_text,allergens_tags,last_modified_t";
      const response = await readDocument(
          `https://world.openfoodfacts.org/api/v3/product/${code}?fields=${fields}`,
        ),
        data = JSON.parse(response.text),
        p = data.product;
      if (p?.product_name)
        candidates = [
          {
            name: String(p.product_name).slice(0, 80),
            brand: String(p.brands || "").slice(0, 80),
            model: code,
            category: "食品",
            lifecycle: "消耗型",
            license: "Open Food Facts · ODbL数据库 / DbCL单项内容；不导入图片",
            version: String(p.last_modified_t || "未提供版本"),
            trust: "community-metadata",
            fetchedAt: now,
            source: {
              title: "Open Food Facts食品候选（包装优先）",
              url: `https://world.openfoodfacts.org/product/${code}`,
              kind: "user-link",
              text: JSON.stringify(
                {
                  source: "Open Food Facts",
                  code,
                  name: p.product_name,
                  brand: p.brands,
                  packageQuantity: p.quantity,
                  ingredients: p.ingredients_text,
                  allergenTags: p.allergens_tags,
                  fetchedAt: now,
                  version: p.last_modified_t,
                  license: "ODbL / DbCL",
                  warning:
                    "众包可能错误、过期或不同地区；以当前实物标签为准。不能据此判定个人过敏安全、保质期或开封状态。",
                },
                null,
                2,
              ),
            },
          },
        ];
    }
  } catch {
    throw new AgentError(
      "公开数据库暂不可用或未返回可解析资料；请人工填写名称/型号。没有自动重试或编造匹配。",
      502,
    );
  }
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  cache.set(key, {
    until: Date.now() + (candidates.length ? 86400000 : 300000),
    value: candidates,
  });
  return {
    candidates,
    cached: false,
    notice: candidates.length
      ? "仅为公共数据库元信息，需核对地区/版本和实物；不代表官方说明或真实持有。"
      : "当前公开数据库未命中；可继续人工录入，没有全品类条码查询能力。",
  };
}
