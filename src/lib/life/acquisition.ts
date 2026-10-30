import { isProductManual } from "./manuals.ts";
import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { canRead, type Item, type Person, type State } from "../domain.ts";
import { productPacks } from "../products.ts";
import { AgentError } from "../agent/contracts.ts";
import {
  brandEntry,
  officialDomain,
  modelMentioned,
  findOfficial,
  type PublicDocument,
} from "./knowledge.ts";
import { fetchPublicDocument, sourceURL, listSources } from "./sources.ts";
import type { Provider } from "../ai/provider.ts";
import { selectTaskEvidence } from "./knowledge-task.ts";

export type KnowledgeChunk = {
  id: string;
  text: string;
  start: number;
  end: number;
  category: string;
  url: string;
  title: string;
  documentId: string;
  model: string;
  region: string;
  warnings?: string[];
};
export type AcquiredDocument = {
  role?: "product" | "manual";
  applicability?: string;
  observations?: {
    kind: "fact" | "operation" | "limitation";
    topic: string;
    value: string;
    quote: string;
  }[];
  processorVersion?: string;
  id: string;
  url: string;
  title: string;
  text: string;
  hash: string;
  model: string;
  brand: string;
  region: string;
  chain: string[];
  fetchedAt: string;
  chunks: KnowledgeChunk[];
};
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export const knowledgeIdentity = (item: Item) =>
  JSON.stringify([
    item.brand || "",
    item.model,
    item.region || "",
    item.productBinding?.packId || "",
  ]);
export const operationQuestion = (q: string) =>
  /怎么用|如何使用|首次|第一次|操作|清洁|清洗|洗护|维护|保养|储存|保存|养护|安装|组装|装配|拼搭|图解|烹饪|充电|配对|故障|不行|失灵|失效|卡住/.test(
    q,
  );
function regionOf(url: string) {
  const u = new URL(url);
  if (/ikea\.cn$/.test(u.hostname)) return "cn";
  if (u.hostname === "helpguide.sony.net") return "unspecified";
  const first = u.pathname.split("/")[1];
  return [
    "cn",
    "uk",
    "us",
    "global",
    "my",
    "au",
    "sg",
    "tw",
    "hk",
    "de",
    "fr",
  ].includes(first)
    ? first
    : "unspecified";
}

function label(s: string) {
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/(\d+)[ .-](\d+)[ -]?(?:liter|litre|l)\b/g, "$1$2l")
    .replace(/[^a-z0-9]/g, "");
}
function brandFor(item: Item) {
  return (
    item.brand ||
    productPacks
      .find((p) => modelMentioned(p.model, item.model))
      ?.product.split(" ")[0] ||
    ""
  );
}
export function makeKnowledgeDocument(
  d: PublicDocument,
  item: Item,
  chain: string[],
  region = regionOf(d.url),
): AcquiredDocument {
  const hash = digest(d.text),
    id = digest(d.url + "\n" + hash).slice(0, 24),
    chunks: KnowledgeChunk[] = [];
  for (const m of d.text.matchAll(/[\s\S]{1,1000}(?:\s|$)/g)) {
    const window = d.text.slice(
      m.index!,
      Math.min(d.text.length, m.index! + m[0].length + 350),
    );
    const text = window.trim();
    if (text.length < 15) continue;
    const start = m.index! + window.indexOf(text);
    chunks.push({
      id: `${id}:${start}`,
      documentId: id,
      text,
      start,
      end: start + text.length,
      url: d.url,
      title: d.title,
      model: item.model,
      region,
      category: /warning|caution|safety|警告|禁止|切勿/i.test(text)
        ? "safety"
        : /clean|maintenance|清洗|清洁|洗护|养护/i.test(text)
          ? "care"
          : /first use|how to use|preparation|press|insert|connect|charging|turn on|使用|操作|按下|组装|安装/i.test(
                text,
              )
            ? "operation"
            : "facts",
    });
  }
  return {
    id,
    processorVersion: "extractive-3-overlap",
    url: d.url,
    title: d.title,
    text: d.text,
    hash,
    model: item.model,
    brand: brandFor(item),
    region,
    chain,
    fetchedAt: new Date().toISOString(),
    chunks,
  };
}
function tableExists(db: DatabaseSync) {
  return !!db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE name='life_knowledge_documents'",
    )
    .get();
}
export function readKnowledge(
  db: DatabaseSync,
  state: State,
  actor: Person,
  itemId: string,
) {
  const item = state.items.find((i) => i.id === itemId && canRead(i, actor));
  if (!item || !tableExists(db)) return [];
  return (
    db
      .prepare(
        "SELECT body FROM life_knowledge_documents WHERE owner IN (?,?) AND item_id=? AND identity=? AND status='active' ORDER BY created_at DESC LIMIT 8",
      )
      // Only server-verified public product documents travel with explicitly
      // authorized item access. Private life_sources, stories and chats do not.
      .all(actor, item.sharedWith?.includes(actor) ? item.owner : actor, itemId, knowledgeIdentity(item)) as { body: string }[]
  ).map((r) => {
    const d = JSON.parse(r.body) as AcquiredDocument;
    return d.processorVersion === "extractive-3-overlap"
      ? d
      : {
          ...makeKnowledgeDocument(
            { url: d.url, title: d.title, text: d.text, links: [] },
            item,
            d.chain,
            d.region,
          ),
          fetchedAt: d.fetchedAt,
        };
  });
}
export function retrieveKnowledge(
  db: DatabaseSync,
  state: State,
  actor: Person,
  itemId: string,
  question: string,
) {
  const documents = readKnowledge(db, state, actor, itemId);
  const conflicts = knowledgeConflicts(documents);
  const intent = /首次|第一次|怎么用|如何使用/.test(question)
    ? "first"
    : /清洁|清洗|洗护|维护|养护|保养/.test(question)
      ? "care"
      : /安装|组装/.test(question)
        ? "install"
        : /充电/.test(question)
          ? "charge"
          : "other";
  const terms =
    intent === "first"
      ? [
          "before first use",
          "preparation",
          "how to use",
          "starting a cooking",
          "turning on",
          "首次",
          "第一次",
          "使用方法",
        ]
      : intent === "care"
        ? ["clean", "maintenance", "清洁", "洗涤", "养护", "保养"]
        : intent === "install"
          ? ["assembly", "install", "组装", "安装"]
          : intent === "charge"
            ? ["charging", "charge the", "充电"]
            : question.match(/[\p{Script=Han}]{2}|[a-z0-9]{3,}/giu) || [];
  const eligible = documents
    .flatMap((d) =>
      d.chunks
        .filter((c) => !conflicts.some((f) => f.pattern.test(c.text)))
        .map((c) => ({ ...c, warnings: conflicts.map((f) => f.message) })),
    )
    .filter(
      (c) =>
        ["cn", "tw", "hk", "unspecified"].includes(c.region) ||
        (c.text.match(/[\u4e00-\u9fff]/g) || []).length / c.text.length < 0.12,
    );
  const ranked = eligible
    .map((c) => ({
      c,
      score:
        terms.reduce(
          (n, t) =>
            n + (c.text.toLowerCase().includes(t.toLowerCase()) ? 5 : 0),
          0,
        ) +
        (c.category === "operation" && intent === "first" ? 2 : 0) +
        (c.category === "care" && intent === "care" ? 2 : 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => x.c);
  return selectTaskEvidence(
    eligible,
    question + " " + (state.items.find((i) => i.id === itemId)?.name || ""),
    ranked.length
      ? ranked
      // A Chinese question may have no literal match in an English manual.
      // Operation/safety paragraphs still contain facts; do not silently lose them.
      : eligible.slice(0, 8),
  );
}
/** Conservative exact-field conflict detection only; never silently pick a value across sources. */
export function knowledgeConflicts(documents: AcquiredDocument[]) {
  const fields: [string, RegExp, RegExp][] = [
    [
      "额定功率",
      /(?:rated\s+power|额定功率)\s*[:：]?\s*(\d+(?:\.\d+)?(?:\s*[-–~]\s*\d+(?:\.\d+)?)?)\s*(?:W\b|瓦)/gi,
      /rated\s+power|额定功率/i,
    ],
    [
      "额定电压",
      /(?:rated\s+voltage|额定电压)\s*[:：]?\s*(\d+(?:\.\d+)?(?:\s*[-–~]\s*\d+(?:\.\d+)?)?)\s*(?:V\b|伏)/gi,
      /rated\s+voltage|额定电压/i,
    ],
  ];
  return fields.flatMap(([field, extract, pattern]) => {
    const values = documents.flatMap((d) => {
      const matches = [
        ...new Set(
          [...d.text.matchAll(extract)].map((m) =>
            m[1].replace(/\s/g, "").replace(/[–~]/g, "-"),
          ),
        ),
      ];
      return matches.length === 1 ? [{ value: matches[0], url: d.url }] : [];
    });
    return new Set(values.map((v) => v.value)).size > 1
      ? [
          {
            field,
            values,
            pattern,
            message: `多个官方来源的${field}不一致，已排除相关原文段落；请核对地区/版本后再使用。`,
          },
        ]
      : [];
  });
}
export function storeOfficialDocument(
  db: DatabaseSync,
  actor: Person,
  item: Item,
  d: AcquiredDocument,
) {
  const identity = knowledgeIdentity(item),
    same = db
      .prepare(
        "SELECT id FROM life_knowledge_documents WHERE owner=? AND item_id=? AND identity=? AND url=? AND hash=?",
      )
      .get(actor, item.id, identity, d.url, d.hash) as
      { id: string } | undefined;
  db.prepare(
    "UPDATE life_knowledge_documents SET status='superseded' WHERE owner=? AND item_id=? AND identity=? AND url=?",
  ).run(actor, item.id, identity, d.url);
  if (same) {
    db.prepare(
      "UPDATE life_knowledge_documents SET status='active',body=?,created_at=? WHERE id=?",
    ).run(JSON.stringify(d), d.fetchedAt, same.id);
    return;
  }
  db.prepare(
    "INSERT INTO life_knowledge_documents VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(
    crypto.randomUUID(),
    actor,
    item.id,
    identity,
    d.url,
    d.hash,
    JSON.stringify(d),
    "active",
    d.fetchedAt,
  );
}
/** Only server-verified official-public imports may enter the official cache. Ordinary user text keeps its own provenance. */
export function indexOfficialSource(
  db: DatabaseSync,
  state: State,
  actor: Person,
  itemId: string,
  sourceId: string,
) {
  const item = state.items.find((i) => i.id === itemId && canRead(i, actor));
  const source = listSources(db, state, actor, itemId).find(
    (s) => s.id === sourceId && s.kind === "official-public",
  );
  if (
    !item ||
    !source?.url ||
    !officialDomain(source.url, item.brand || brandFor(item)) ||
    !modelMentioned(source.title + " " + source.text, item.model)
  )
    throw new AgentError("资料未通过官方来源与完整型号核对");
  const region = regionOf(source.url);
  if (item.region && item.region !== region)
    throw new AgentError("资料地区与档案不一致；保留原摘录但不用于型号操作");
  const document = makeKnowledgeDocument(
    { ...source, url: source.url, links: [] },
    item,
    [source.url],
    region,
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    storeOfficialDocument(db, actor, item, document);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return document;
}
/** Bounded official discovery. No model URL guesses, paid search, cookies, login or community crawling. */
export async function acquireKnowledge(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  itemId: string,
  options: {
    force?: boolean;
    persist?: boolean;
    fetchDocument?: typeof fetchPublicDocument;
    search?: Provider["search"];
  } = {},
) {
  const foundItem = read().items.find(
    (i) => i.id === itemId && canRead(i, actor),
  );
  if (!foundItem) throw new AgentError("物品未获授权", 403);
  const item: Item = foundItem;
  if (!item.model || item.model === "待确认")
    return {
      documents: [],
      issues: ["具体型号尚未确认，不能获取专属操作。"],
      cached: false,
    };
  const cached = readKnowledge(db, read(), actor, itemId),
    identity = knowledgeIdentity(item);
  const last = tableExists(db)
    ? (db
        .prepare(
          "SELECT identity,at,result FROM life_knowledge_fetches WHERE owner=? AND item_id=?",
        )
        .get(actor, itemId) as
        { identity: string; at: string; result: string } | undefined)
    : undefined;
  const previousResult = last ? JSON.parse(last.result) : undefined;
  const previousIssues = Array.isArray(previousResult)
    ? previousResult
    : previousResult?.issues || [];
  const previousSucceeded = Array.isArray(previousResult)
    ? cached.length > 0
    : previousResult?.successful;
  if (
    !options.force &&
    last?.identity === identity &&
    Date.now() - Date.parse(last.at) <
      (previousSucceeded ? 7 * 86400000 : 600000)
  )
    return {
      documents: cached,
      issues: previousIssues as string[],
      cached: true,
      acquisition: previousResult?.acquisition || {
        cached: true,
        searchAttempted: false,
        searchURLs: [],
        readURLs: [],
        verifiedURLs: cached.map((d) => d.url),
      },
    };
  const fetcher = options.fetchDocument || fetchPublicDocument,
    brand = brandFor(item),
    entry = brandEntry(brand),
    issues: string[] = [],
    documents: AcquiredDocument[] = [];
  const acquisition = {
    searchAttempted: false,
    searchCompleted: false,
    searchURLs: [] as string[],
    readURLs: [] as string[],
    verifiedURLs: [] as string[],
  };
  let requests = 0;
  const get = async (url: string) => {
    if (++requests > 6) throw new AgentError("本轮官方资料读取达到6份上限");
    const page = await fetcher(url);
    acquisition.readURLs.push(page.url);
    return page;
  };
  const packs = productPacks.filter(
    (p) =>
      modelMentioned(p.model, item.model) &&
      officialDomain(p.source.url, brand),
  );
  const region =
    item.region ||
    (packs[0]
      ? regionOf(packs[0].source.url)
      : entry?.domains[0] === "ikea.cn"
        ? "cn"
        : "uk");
  const titles = [item.name, ...packs.map((p) => p.product)]
    .map(label)
    .filter((x) => x.length > 8);
  async function accept(url: string, chain: string[], sourceRegion: string) {
    const d = await get(url);
    if (!modelMentioned(d.title + " " + d.text, item.model)) {
      issues.push("官方文档未包含完整型号，未采用：" + new URL(url).hostname);
      return;
    }
    if (item.region && sourceRegion !== item.region) {
      issues.push("资料地区与档案不一致，未采用");
      return;
    }
    documents.push(
      makeKnowledgeDocument(d, { ...item, brand }, chain, sourceRegion),
    );
  }
  try {
    if (item.supportUrl && officialDomain(item.supportUrl, brand)) {
      await accept(
        item.supportUrl,
        [item.supportUrl],
        regionOf(item.supportUrl),
      );
    } else if (
      entry?.domains[0] === "sony.com" &&
      /^[a-z0-9-]+$/i.test(item.model)
    ) {
      const support = `https://www.sony.com/electronics/support/product/${item.model.toLowerCase()}/manuals`;
      const d = await get(support);
      if (modelMentioned(d.title + " " + d.text, item.model) && !item.region) {
        documents.push(
          makeKnowledgeDocument(d, item, [support], "unspecified"),
        );
        const manual = d.links.find(
          (l) => /helpguide\.sony\.net/.test(l.url) && /\.pdf/.test(l.url),
        );
        if (manual)
          await accept(manual.url, [support, manual.url], "unspecified");
      } else
        issues.push(
          "官方页面未确认完整型号或地区版本；可提供匹配版本的官方链接。",
        );
    } else if (entry?.domains[0] === "mi.com") {
      const catalogURL = `https://www.mi.com/${region}/support/user-guide/`,
        catalog = await get(catalogURL);
      const matches = catalog.links.filter(
        (l) =>
          /\.pdf(?:$|[?#])/i.test(l.url) &&
          label(l.title).length > 8 &&
          titles.some(
            (t) => label(l.title) === t || t.endsWith(label(l.title)),
          ),
      );
      const selected = matches.slice(0, 2);
      for (const l of selected) {
        const host = sourceURL(l.url).hostname;
        if (
          !["mi.com", "mi-img.com", "mi-fds.com", "xiaomi.com"].some(
            (h) => host === h || host.endsWith("." + h),
          )
        )
          continue;
        await accept(l.url, [catalogURL, l.url], region);
      }
      if (!selected.length)
        issues.push(
          "官方说明书目录未匹配产品全称；型号已知但缺少可定位的产品名称/资料链接。",
        );
    } else {
      const found = await findOfficial({ brand, model: item.model }, get);
      issues.push(...found.issues);
      for (const d of found.documents) {
        const sourceRegion = regionOf(d.url);
        if (item.region && sourceRegion !== item.region) {
          issues.push("官方来源地区不一致，未采用");
          continue;
        }
        documents.push(
          makeKnowledgeDocument(d, { ...item, brand }, [d.url], sourceRegion),
        );
        for (const link of d.links
          .filter((l) => /\.pdf(?:$|[?#])/i.test(l.url) && isProductManual(l))
          .slice(0, 1)) {
          const h = new URL(link.url).hostname;
          if (
            officialDomain(link.url, brand) ||
            (entry?.domains[0] === "ikea.cn" &&
              /^(resources|www)\.ikea\.cn$/.test(h))
          ) {
            // A manual on the exact-model official page may identify an IKEA article using dotted digits.
            try {
              await accept(link.url, [d.url, link.url], sourceRegion);
            } catch {
              issues.push("相关说明书未能读取，保留已取得的官方页面");
            }
          }
        }
      }
      if (!found.documents.length) issues.push(found.notice);
    }
  } catch (e) {
    issues.push(
      e instanceof AgentError
        ? e.message
        : "官方资料网络读取失败；可稍后刷新或上传对应说明书",
    );
  }
  if (!documents.length && options.search && entry) {
    try {
      acquisition.searchAttempted = true;
      const result = await options.search(
        `${brand} ${item.model} 官方 说明书 使用方法 ${item.region || ""}`,
        [...entry.domains],
      );
      acquisition.searchCompleted = true;
      acquisition.searchURLs = result.hits.slice(0, 4).map((h) => h.url);
      for (const hit of result.hits.slice(0, 4)) {
        if (requests >= 6) break;
        if (!officialDomain(hit.url, brand)) continue;
        try {
          const d = await get(hit.url),
            sourceRegion = regionOf(d.url);
          if (
            !officialDomain(d.url, brand) ||
            !modelMentioned(d.title + " " + d.text, item.model)
          ) {
            issues.push("搜索命中未通过最终域名/完整型号核对，未采用");
            continue;
          }
          if (item.region && item.region !== sourceRegion) {
            issues.push("搜索来源地区不一致或未明，未采用");
            continue;
          }
          if (!documents.some((s) => s.url === d.url))
            documents.push(
              makeKnowledgeDocument(
                d,
                { ...item, brand },
                ["bailian-search:turbo", d.url],
                sourceRegion,
              ),
            );
        } catch {
          issues.push("搜索命中公开页面无法读取，未采用模型摘要替代原文");
        }
      }
      if (!result.hits.length)
        issues.push("搜索未返回结构化来源，不使用模型正文引用。");
    } catch {
      issues.push("联网搜索未完成或未获授权，本轮不重试。");
    }
  }
  const current = read().items.find(
    (i) => i.id === itemId && canRead(i, actor),
  );
  if (!current || knowledgeIdentity(current) !== identity)
    throw new AgentError("读取期间物品权限或型号已变化", 409);
  if (!documents.length && cached.length)
    issues.push(
      "本次刷新未取得新资料；沿用带原取得时间的缓存，请核对原文是否仍适用。",
    );
  acquisition.verifiedURLs = documents.map((d) => d.url);
  if (options.persist !== false && tableExists(db)) {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const d of documents) storeOfficialDocument(db, actor, item, d);
      db.prepare(
        "INSERT INTO life_knowledge_fetches VALUES(?,?,?,?,?) ON CONFLICT(owner,item_id) DO UPDATE SET identity=excluded.identity,at=excluded.at,result=excluded.result",
      ).run(
        actor,
        itemId,
        identity,
        new Date().toISOString(),
        JSON.stringify({
          issues,
          successful: documents.length > 0,
          acquisition,
        }),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return {
    documents: documents.length ? documents : cached,
    issues: [...new Set(issues)],
    acquisition,
    cached: false,
  };
}

export function documentCapabilities(documents: AcquiredDocument[]) {
  const patterns: [string, RegExp][] = [
    ["收纳", /shelf|storage|搁板|收纳/i],
    ["照明", /lighting|illumination|照明/i],
    ["声音播放", /playback|listen to music|播放音乐/i],
    ["图像记录", /take photos|拍摄|摄影/i],
    ["常温容纳", /cup|容器|杯子/i],
    ["烹饪", /cooking|烹煮|烹饪/i],
  ];
  return patterns.flatMap(([label, pattern]) => {
    for (const d of documents) {
      const c = d.chunks.find((c) => pattern.test(c.text));
      if (c)
        return [
          {
            id: `${c.id}:cap:${label}`,
            label,
            text: c.text.slice(0, 1000),
            url: d.url,
            model: d.model,
            basis: "官方文档词项支持的能力候选；未实测组合适用性",
          },
        ];
    }
    return [];
  });
}
