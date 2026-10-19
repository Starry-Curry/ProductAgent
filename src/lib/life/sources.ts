import type { DatabaseSync } from "node:sqlite";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { canRead, type State, type Person } from "../domain.ts";
import { AgentError, type AssistantReply } from "../agent/contracts.ts";
import { searchProducts } from "../products.ts";

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
/** One user-requested public page, no crawling/cookies/login. Pin DNS to block rebinding. */
export async function fetchPublicText(
  value: string,
): Promise<{ title: string; text: string; url: string }> {
  const url = sourceURL(value);
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new AgentError("不允许读取内网或保留地址");
  const chosen = addresses[0];
  const raw = await new Promise<string>((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        family: chosen.family,
        headers: {
          "User-Agent": "Wujian-UserRequestedDocument/1.0",
          Accept: "text/html,text/plain",
        },
        lookup: ((
          _host: unknown,
          _options: unknown,
          callback: (e: null, a: string, f: number) => void,
        ) => callback(null, chosen.address, chosen.family)) as never,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(
            new AgentError(
              "来源未直接公开返回正文；不绕过登录、限制或自动跟随跳转",
            ),
          );
          return;
        }
        if (
          !/text\/(html|plain)/i.test(String(res.headers["content-type"] || ""))
        ) {
          res.resume();
          reject(new AgentError("此链接不是可读取网页；PDF 请下载后主动上传"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 750000) {
            res.destroy();
            reject(new AgentError("网页过大，请粘贴必要片段或上传说明书"));
          } else chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      },
    );
    req.setTimeout(8000, () => req.destroy(new Error("资料读取超时")));
    req.on("error", reject);
    req.end();
  });
  const { load } = await import("cheerio");
  const $ = load(raw);
  $("script,style,noscript,nav,footer,header,iframe,form").remove();
  const title = $("title").text().trim().slice(0, 150) || url.hostname;
  const text = ($("main,article").first().text() || $("body").text())
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40000);
  if (text.length < 20)
    throw new AgentError("没有可读取正文，可手工粘贴已获准使用的内容");
  return { title, text, url: url.href };
}
export function parseCode(raw: string) {
  const text = raw.trim().slice(0, 3000);
  if (!text) throw new AgentError("没有识别到编码内容");
  const type = /^https:\/\//i.test(text)
    ? "url"
    : /^\d{8,14}$/.test(text)
      ? "barcode"
      : "text";
  return {
    type,
    text,
    candidates: type === "text" ? searchProducts(text) : [],
    notice:
      type === "url"
        ? "二维码包含链接，不代表是说明书。可主动读取公开正文或手动补全。"
        : type === "barcode"
          ? "已解析商品编码；当前没有获授权的通用条码商品库，请核对包装名称与型号。"
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
): AssistantReply | undefined {
  if (
    !db.prepare("SELECT 1 FROM sqlite_master WHERE name='life_sources'").get()
  )
    return;
  const terms = [
    ...new Set(question.match(/[\p{Script=Han}]{2}|[a-z0-9]{2,}/giu) || []),
  ].filter((t) => !/[怎么如何这个物品可以]/.test(t));
  const rows = listSources(db, state, actor, itemId);
  const facets = [
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
        s.score > 0 &&
        !/详见|请参阅|请查阅|请见|待确认|未提供|不详/.test(s.text) &&
        facets.length > 0 &&
        facets.every((f) => f.a.test(s.text)),
    );
    if (direct)
      return {
        outcome: "answered",
        answer: "你提供的资料中有这段原文：\n" + direct.text,
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
  if (rows.length && !/^(你好|谢谢|嗨|在吗)[！!。]?$/u.test(question))
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
