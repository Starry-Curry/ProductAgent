import type { DatabaseSync } from "node:sqlite";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { canRead, type State, type Person } from "../domain.ts";
import { AgentError, type AssistantReply } from "../agent/contracts.ts";
import { searchProducts } from "../products.ts";
import { modelMentioned } from "./knowledge.ts";

export function publicAddress(address: string) {
  if (address.includes(":"))
    return (
      !/^(::|fc|fd|fe[89ab]|ff|2001:db8)/i.test(address) &&
      !address.toLowerCase().includes("::ffff:")
    );
  const p = address.split(".").map(Number);
  return (
    p.length === 4 &&
    ![0, 10, 127].includes(p[0]) &&
    !(p[0] === 169 && p[1] === 254) &&
    !(p[0] === 172 && p[1] >= 16 && p[1] <= 31) &&
    !(p[0] === 192 && (p[1] === 168 || p[1] === 0)) &&
    !(p[0] === 100 && p[1] >= 64 && p[1] <= 127) &&
    p[0] < 224
  );
}
export function sourceURL(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hostname.endsWith(".") ||
    url.hostname === "localhost" ||
    !url.hostname.includes(".") ||
    isIP(url.hostname.replace(/[\[\]]/g, ""))
  )
    throw new AgentError(
      "仅支持公开 HTTPS 资料链接，不支持本地、IP 地址或带账号的链接",
    );
  return url;
}
/** Explicit public document read. Re-check and pin DNS on every same-host canonical redirect. */
export async function fetchPublicDocument(
  value: string,
  redirects = 0,
): Promise<{
  title: string;
  text: string;
  url: string;
  links: { title: string; url: string }[];
  extracted?: { name?: string; brand?: string; model?: string };
}> {
  const url = sourceURL(value);
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new AgentError("不允许读取内网或保留地址");
  const chosen = addresses[0];
  const result = await new Promise<{
    bytes: Buffer;
    type: string;
    location?: string;
  }>((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        family: chosen.family,
        headers: {
          "User-Agent": "Wujian-UserRequestedDocument/1.0",
          Accept: "text/html,text/plain,application/pdf",
        },
        lookup: ((
          _host: unknown,
          _options: unknown,
          callback: (e: null, a: string, f: number) => void,
        ) => callback(null, chosen.address, chosen.family)) as never,
      },
      (res) => {
        if (
          [301, 302, 303, 307, 308].includes(res.statusCode || 0) &&
          res.headers.location
        ) {
          res.resume();
          resolve({
            bytes: Buffer.alloc(0),
            type: "",
            location: res.headers.location,
          });
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(
            new AgentError(
              "来源未公开返回正文；不绕过登录、限制或验证。可打开官方网页人工查找或上传资料。",
            ),
          );
          return;
        }
        const type = String(res.headers["content-type"] || "");
        if (!/text\/(html|plain)|application\/pdf/i.test(type)) {
          res.resume();
          reject(new AgentError("来源不是网页、文本或 PDF，可手动上传说明书"));
          return;
        }
        const limit = /pdf/i.test(type) ? 12_000_000 : 1_500_000;
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit) {
            res.destroy();
            reject(new AgentError("资料过大，请选择相关章节上传"));
          } else chunks.push(chunk);
        });
        res.on("end", () => resolve({ bytes: Buffer.concat(chunks), type }));
        res.on("error", reject);
      },
    );
    req.setTimeout(8000, () =>
      req.destroy(new AgentError("资料读取超时，请稍后重试或人工补充")),
    );
    req.on("error", () =>
      reject(
        new AgentError("公开资料网络读取失败，可手动打开官网或上传说明书"),
      ),
    );
    req.end();
  });
  if (result.location) {
    const next = sourceURL(new URL(result.location, url).href);
    if (
      redirects >= 2 ||
      next.hostname.replace(/^www\./, "") !== url.hostname.replace(/^www\./, "")
    )
      throw new AgentError(
        "来源跳转到其他站点或跳转过多；请核对最终链接后主动读取",
      );
    return fetchPublicDocument(next.href, redirects + 1);
  }
  if (/pdf/i.test(result.type)) {
    const { extractManual } = await import("./documents.ts");
    const d = await extractManual(
      result.bytes,
      "official-document.pdf",
      false,
      12_000_000,
    );
    return {
      title: decodeURIComponent(url.pathname.split("/").at(-1) || "公开 PDF"),
      text: d.text,
      url: url.href,
      links: [],
    };
  }
  return extractPublicHTML(result.bytes.toString("utf8"), url.href);
}
export async function extractPublicHTML(raw: string, address: string) {
  const url = sourceURL(address),
    { load } = await import("cheerio"),
    $ = load(raw);
  let extracted: { name?: string; brand?: string; model?: string } | undefined;
  function product(node: any): any {
    if (Array.isArray(node)) return node.map(product).find(Boolean);
    if (!node || typeof node !== "object") return;
    if ([node["@type"]].flat().includes("Product")) return node;
    return node["@graph"] ? product(node["@graph"]) : undefined;
  }
  $('script[type="application/ld+json"]').each((_n, el) => {
    try {
      const p = product(JSON.parse($(el).text()));
      if (p && !extracted)
        extracted = {
          name: typeof p.name === "string" ? p.name.slice(0, 80) : undefined,
          brand:
            typeof p.brand === "string"
              ? p.brand.slice(0, 80)
              : typeof p.brand?.name === "string"
                ? p.brand.name.slice(0, 80)
                : undefined,
          model:
            typeof p.model === "string"
              ? p.model.slice(0, 100)
              : typeof p.mpn === "string"
                ? p.mpn.slice(0, 100)
                : undefined,
        };
    } catch {
      /* Invalid structured metadata is not evidence. */
    }
  });
  const links: { title: string; url: string }[] = [];
  $("a[href]").each((_n, el) => {
    const title = $(el).text().trim().slice(0, 150),
      href = $(el).attr("href");
    if (
      !href ||
      !/manual|support|faq|\.pdf|说明|指南|手册|帮助|常见|组装/i.test(
        title + " " + href,
      )
    )
      return;
    try {
      const u = sourceURL(new URL(href, url).href);
      if (!links.some((l) => l.url === u.href))
        links.push({ title: title || "相关资料", url: u.href });
    } catch {
      /* No local/non-HTTPS links. */
    }
  });
  function catalog(node: unknown, depth = 0) {
    if (depth > 20 || !node) return;
    if (typeof node === "string" && /^[\[{]/.test(node.trim())) {
      try {
        catalog(JSON.parse(node), depth + 1);
      } catch {}
    } else if (Array.isArray(node))
      for (const child of node.slice(0, 2000)) catalog(child, depth + 1);
    else if (typeof node === "object") {
      const row = node as Record<string, unknown>;
      if (
        typeof row.link === "string" &&
        typeof row.text === "string" &&
        /\.pdf(?:$|[?#])/i.test(row.link)
      ) {
        try {
          const u = sourceURL(row.link);
          if (!links.some((l) => l.url === u.href))
            links.push({ title: row.text.slice(0, 150), url: u.href });
        } catch {}
      }
      for (const child of Object.values(row)) catalog(child, depth + 1);
    }
  }
  $("script").each((_n, el) => {
    const m = $(el)
      .text()
      .match(/window\.__PRELOADED_\w+__\s*=\s*([\s\S]+)/);
    if (m)
      try {
        catalog(JSON.parse(m[1].replace(/;\s*$/, "")));
      } catch {}
  });
  $("script,style,noscript,nav,footer,header,iframe,form").remove();
  $("p,li,h1,h2,h3,h4,br,tr,dt,dd").append("\n");
  const title =
    $("title").text().trim().slice(0, 150) ||
    $("h1").first().text().trim().slice(0, 150) ||
    url.hostname;
  const text = (
    $("main,article").first().text() ||
    $("body").text() ||
    $.root().text()
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 40000);
  if (text.length < 20)
    throw new AgentError(
      "没有可读取正文，页面可能依赖脚本；请人工查找或上传资料",
    );
  return {
    title,
    text,
    url: url.href,
    links: [
      ...links.filter((l) => /\.pdf(?:$|[?#])/i.test(l.url)).slice(0, 600),
      ...links.filter((l) => !/\.pdf(?:$|[?#])/i.test(l.url)).slice(0, 60),
    ],
    extracted,
  };
}
export const fetchPublicText = fetchPublicDocument;
export function parseCode(raw: string) {
  const text = raw.trim().slice(0, 3000);
  if (!text) throw new AgentError("没有识别到编码内容");
  const type = /^https:\/\//i.test(text)
    ? "url"
    : /^\d{8,14}$/.test(text)
      ? "barcode"
      : "text";
  const digits = type === "barcode" ? text : undefined;
  const validChecksum =
    digits && [8, 12, 13, 14].includes(digits.length)
      ? (10 -
          ([...digits.slice(0, -1)]
            .reverse()
            .reduce((n, c, i) => n + Number(c) * (i % 2 === 0 ? 3 : 1), 0) %
            10)) %
          10 ===
        Number(digits.at(-1))
      : undefined;
  let candidateText = text;
  if (type === "url") {
    try {
      const u = sourceURL(text);
      candidateText = decodeURIComponent(u.pathname);
    } catch {
      candidateText = "";
    }
  }
  return {
    type,
    text,
    validChecksum,
    candidates: type === "barcode" ? [] : searchProducts(candidateText),
    notice:
      type === "url"
        ? "二维码包含链接，不代表是说明书。可主动读取公开正文或手动补全。"
        : type === "barcode"
          ? validChecksum === false
            ? "编码校验位不匹配，请重新扫码或人工核对；未查询商品库。"
            : "已解析商品编码；当前没有获授权的通用条码商品库，请核对包装名称与型号。"
          : "已解码原始文字；以下仅是本地目录匹配候选，仍须核对实物。",
  };
}
export function saveSource(
  db: DatabaseSync,
  state: State,
  actor: Person,
  v: {
    itemId: string;
    title: string;
    text: string;
    url?: string;
    kind: string;
  },
) {
  if (!state.items.some((i) => i.id === v.itemId && i.owner === actor))
    throw new AgentError("仅所有者可添加物品资料", 403);
  if (v.url) sourceURL(v.url);
  const existing = db
    .prepare(
      "SELECT id FROM life_sources WHERE owner=? AND item_id=? AND title=? AND text=? AND coalesce(url,'')=? AND kind=?",
    )
    .get(
      actor,
      v.itemId,
      v.title.slice(0, 150),
      v.text.slice(0, 40000),
      v.url || "",
      v.kind,
    ) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO life_sources VALUES(?,?,?,?,?,?,?,?)").run(
    id,
    actor,
    v.itemId,
    v.title.slice(0, 150),
    v.url || null,
    v.text.slice(0, 40000),
    v.kind,
    new Date().toISOString(),
  );
  return id;
}
export function listSources(
  db: DatabaseSync,
  state: State,
  actor: Person,
  itemId: string,
) {
  if (!state.items.some((i) => i.id === itemId && canRead(i, actor)))
    throw new AgentError("物品未获授权", 403);
  // Sharing an item never automatically shares privately uploaded manuals/notes.
  return db
    .prepare(
      "SELECT id,title,url,text,kind,created_at FROM life_sources WHERE item_id=? AND owner=? ORDER BY created_at DESC LIMIT 20",
    )
    .all(itemId, actor) as {
    id: string;
    title: string;
    url: string | null;
    text: string;
    kind: string;
    created_at: string;
  }[];
}
export function sourceReply(
  db: DatabaseSync,
  state: State,
  actor: Person,
  itemId: string,
  question: string,
  fallback = true,
): AssistantReply | undefined {
  if (
    !db.prepare("SELECT 1 FROM sqlite_master WHERE name='life_sources'").get()
  )
    return;
  const terms = [
    ...new Set(question.match(/[\p{Script=Han}]{2}|[a-z0-9]{2,}/giu) || []),
  ].filter((t) => !/[怎么如何这个物品可以]/.test(t));
  const rows = listSources(db, state, actor, itemId);
  const operation =
    /怎么用|如何使用|操作|使用方法|使用步骤|开启|启动|连接|安装/.test(question);
  const facets = [
    {
      q: /怎么用|如何使用|操作|使用方法|使用步骤|开启|启动|连接|安装/,
      a: /按下|开启|插入|放入|选择|连接|操作步骤|press|turn on|insert|connect/i,
    },
    { q: /温度|几度|多少度/, a: /\d+(?:\.\d+)?\s*(?:°?C|℃|度)/i },
    {
      q: /多久|时长|多少分钟/,
      a: /\d+(?:\.\d+)?\s*(?:分钟|小时|秒|min|hour)/i,
    },
    { q: /电压|多少伏/, a: /\d+(?:\.\d+)?\s*(?:V\b|伏)/i },
    { q: /功率|多少瓦/, a: /\d+(?:\.\d+)?\s*(?:W\b|瓦)/i },
    { q: /承重|载荷/, a: /\d+(?:\.\d+)?\s*(?:kg|千克|公斤)/i },
    {
      q: /电池|续航|容量/,
      a: /\bAA\b|\bAAA\b|\d+(?:\.\d+)?\s*(?:mAh|Wh|毫安时|毫升|升|小时)/i,
    },
    { q: /尺寸|多大|多长/, a: /\d+(?:\.\d+)?\s*(?:mm|cm|毫米|厘米|米)/i },
    { q: /材质/, a: /材质.{0,12}(?:棉|麻|钢|木|塑料|玻璃|聚酯|纤维)/ },
    {
      q: /蓝牙|兼容/,
      a: /蓝牙.{0,8}\d|(?:支持|兼容|不支持|不兼容).{0,30}(?:蓝牙|USB|Windows|安卓|iOS)/i,
    },
    { q: /清洁|清洗|洗护|怎么洗/, a: /擦|洗涤|清洗|干洗|漂白|软布|不可水洗/ },
    { q: /浇水/, a: /浇水.{0,20}(?:\d|干|湿|少|适量|不)|(?:干|湿).{0,10}浇水/ },
  ].filter((f) => f.q.test(question));
  for (const r of rows) {
    const model = state.items.find((i) => i.id === itemId)?.model;
    if (
      r.kind === "official-public" &&
      (!model || !modelMentioned(r.title + " " + r.text, model))
    )
      continue;
    const sentences = r.text
      .split(/(?<=[。！？\n])/)
      .map((x) => x.trim())
      .filter((x) => x.length > 3 && x.length < 600);
    const scored = sentences
      .map((text) => ({
        text,
        score: terms.filter((t) => text.toLowerCase().includes(t.toLowerCase()))
          .length,
      }))
      .sort((a, b) => b.score - a.score);
    const direct = scored.find(
      (s) =>
        (s.score > 0 || operation) &&
        !/详见|请参阅|请查阅|请见|待确认|未提供|不详/.test(s.text) &&
        facets.length > 0 &&
        facets.every((f) => f.a.test(s.text)),
    );
    if (direct)
      return {
        outcome: "answered",
        answer:
          (r.kind === "official-public"
            ? "已保存的官方站点摘录中有以下原文：\n"
            : "你提供的资料中有这段原文：\n") +
          (operation
            ? sentences
                .filter(
                  (s) =>
                    s === direct.text ||
                    /警告|切勿|禁止/.test(s) ||
                    /按下|开启|插入|放入|选择|连接|press|turn on/i.test(s),
                )
                .slice(0, 5)
                .join("\n")
            : direct.text),
        steps: [],
        questions: [],
        evidenceIds: [r.id],
        citations: [
          { id: r.id, title: r.title, url: r.url || "", kind: "user_report" },
        ],
        memoryIds: [],
        source: "user-source",
        caveat:
          "用户提供的资料摘录，未经独立核验；请确认对应型号与适用条件。这不是模型生成或已验证的操作步骤。",
      };
  }
  if (
    fallback &&
    rows.length &&
    !/^(你好|谢谢|嗨|在吗)[！!。]?$/u.test(question)
  )
    return {
      outcome: "needs_info",
      answer:
        "资料已保存，但目前未找到能直接回答这个问题的原文。关键词出现不代表参数或操作已经确认；请补充对应型号的相关章节，或换一个更具体的问题。",
      steps: [],
      questions: ["能补充与问题直接相关的原文及型号吗？"],
      evidenceIds: [],
      citations: [],
      memoryIds: [],
      source: "user-source",
      caveat: "尚未确认答案，不推断官方参数。",
    };
}
