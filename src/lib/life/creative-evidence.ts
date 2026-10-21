import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Person, Item } from "../domain.ts";
import type { Provider } from "../ai/provider.ts";
import { AgentError } from "../agent/contracts.ts";
import { fetchPublicDocument, sourceURL } from "./sources.ts";
export type CreativeEvidence = {
  id: string;
  kind: "third-party" | "open-knowledge" | "user-provided";
  title: string;
  url?: string;
  excerpt: string;
  conditions: string[];
  license: string;
  licenseURL?: string;
  attribution: string;
  fetchedAt: string;
  revision?: string;
  verified: "public-page-read" | "user-asserted-rights";
};
const short = (s: string) =>
  s.trim().split(/\s+/).slice(0, 25).join(" ").slice(0, 180);
export function saveCreativeEvidence(
  db: DatabaseSync,
  actor: Person,
  value: Omit<CreativeEvidence, "id">,
) {
  const signature = createHash("sha256")
    .update(
      JSON.stringify([
        value.kind,
        value.url,
        value.title,
        value.excerpt,
        value.revision,
      ]),
    )
    .digest("hex");
  const previous = db
    .prepare(
      "SELECT id FROM life_creative_evidence WHERE owner=? AND signature=?",
    )
    .get(actor, signature) as { id: string } | undefined;
  if (previous) return { ...value, id: previous.id };
  const evidence = { ...value, id: crypto.randomUUID() };
  db.prepare("INSERT INTO life_creative_evidence VALUES(?,?,?,?,?)").run(
    evidence.id,
    actor,
    signature,
    JSON.stringify(evidence),
    value.fetchedAt,
  );
  return evidence;
}
export function listCreativeEvidence(db: DatabaseSync, actor: Person) {
  return (
    db
      .prepare(
        "SELECT body FROM life_creative_evidence WHERE owner=? ORDER BY created_at DESC LIMIT 80",
      )
      .all(actor) as { body: string }[]
  ).map((r) => JSON.parse(r.body) as CreativeEvidence);
}
export async function importCreativeEvidence(
  db: DatabaseSync,
  actor: Person,
  input: unknown,
  fetchDocument = fetchPublicDocument,
) {
  const v = z
    .object({
      url: z.string().max(2000).optional(),
      title: z.string().max(150).optional(),
      text: z.string().max(2500).optional(),
      confirmed: z.boolean().default(false),
    })
    .strict()
    .parse(input);
  if (v.text) {
    if (!v.confirmed)
      throw new AgentError("粘贴内容需确认有权使用；不读取账号私有资料");
    return saveCreativeEvidence(db, actor, {
      kind: "user-provided",
      title: v.title || "用户提供的经验",
      url: v.url ? sourceURL(v.url).href : undefined,
      excerpt: v.text.slice(0, 1200),
      conditions: ["用户提供的经验，适用条件与实物结果尚未验证"],
      license: "用户声明有权提供；未授予对外再分发权限",
      attribution: "用户提供",
      fetchedAt: new Date().toISOString(),
      verified: "user-asserted-rights",
    });
  }
  if (!v.url) throw new AgentError("请提供公开链接或获准内容");
  const url = sourceURL(v.url);
  if (
    /(^|\.)(xiaohongshu\.com|xhslink\.com|bilibili\.com|b23\.tv)$/.test(
      url.hostname,
    )
  )
    throw new AgentError(
      "该平台不进行自动抓取。可手动提供获准文字或使用现有本机OCR提取截图；不绕过登录或平台限制。",
    );
  const d = await fetchDocument(url.href);
  const handlingExcerpt = d.text
    .split(/\n+|(?<=[.!?。])\s+/)
    .find((t) => /avoid touching the image area/i.test(t));
  const passages = d.text
    .split(/\n+/)
    .filter((t) => t.length > 35)
    .sort(
      (a, b) =>
        (
          b.match(
            /shine|play|draw|hold|make|place|turn|build|cut|handle|handling|touching|步骤|放|画|照/gi,
          ) || []
        ).length -
        (
          a.match(
            /shine|play|draw|hold|make|place|turn|build|cut|handle|handling|touching|步骤|放|画|照/gi,
          ) || []
        ).length,
    );
  return saveCreativeEvidence(db, actor, {
    kind: "third-party",
    title: d.title.slice(0, 150),
    url: d.url,
    excerpt: short(handlingExcerpt || passages[0] || d.text),
    conditions: ["仅短摘录作为灵感，未核验整套玩法或适用型号"],
    license: "许可未核定；仅保存链接、元信息与短摘录，不保留整篇内容",
    attribution: d.title + " · " + new URL(d.url).hostname,
    fetchedAt: new Date().toISOString(),
    verified: "public-page-read",
  });
}
/** Public Wikimedia API, version/rights/author links retained. No login or paid provider required. */
export async function searchWikibooks(
  db: DatabaseSync,
  actor: Person,
  query: string,
  fetchDocument = fetchPublicDocument,
) {
  const url = new URL("https://en.wikibooks.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query.slice(0, 100),
    gsrlimit: "2",
    prop: "extracts|info|revisions",
    explaintext: "1",
    exintro: "1",
    exchars: "1000",
    inprop: "url",
    rvprop: "ids|timestamp",
    meta: "siteinfo",
    siprop: "rightsinfo",
  }).toString();
  const data = JSON.parse((await fetchDocument(url.href)).text),
    rights = data.query?.rightsinfo;
  if (
    !rights?.url ||
    !/^https:\/\/creativecommons.org\/licenses\/by-sa\//.test(rights.url)
  )
    throw new AgentError("Wikibooks未返回可核对的许可，未缓存正文");
  return Object.values(data.query.pages || {}).flatMap((p: any) => {
    if (!p.extract || !p.fullurl) return [];
    return [
      saveCreativeEvidence(db, actor, {
        kind: "open-knowledge",
        title: p.title,
        url: p.fullurl,
        excerpt: p.extract.slice(0, 1000),
        conditions: ["开放知识条目，不是某型号官方用途；需核对材料与安全条件"],
        license: rights.text,
        licenseURL: rights.url,
        attribution:
          p.title +
          " contributors；作者/历史：" +
          p.fullurl +
          "?action=history",
        revision: String(p.revisions?.[0]?.revid || ""),
        fetchedAt: new Date().toISOString(),
        verified: "public-page-read",
      }),
    ];
  });
}
export async function findCreativeEvidence(
  db: DatabaseSync,
  actor: Person,
  goal: string,
  items: Item[],
  provider: Provider,
) {
  const issues: string[] = [],
    hits: CreativeEvidence[] = [];
  // Only broad task/capability terms leave the app, never names, memories or the full personal goal.
  const topic = /整理|收纳|桌面/.test(goal)
    ? "desk organization storage"
    : /娱乐|游戏|有趣/.test(goal)
      ? "paper drawing games flashlight"
      : /食物|食谱|烹饪/.test(goal)
        ? "Cookbook simple food preparation"
        : "creative paper activities";
  const cached = listCreativeEvidence(db, actor).filter(
    (e) =>
      Date.now() - Date.parse(e.fetchedAt) < 7 * 86400000 &&
      e.conditions.includes("检索主题：" + topic),
  );
  if (cached.length)
    return { evidence: cached.slice(0, 4), issues, cached: true };
  try {
    hits.push(...(await searchWikibooks(db, actor, topic)));
  } catch {
    issues.push("Wikibooks公开API未能读取或许可未确认，未伪造条目");
  }
  if (provider.search && process.env.WUJIAN_ALLOW_SEARCH === "true")
    try {
      const result = await provider.search(topic + " household reuse ideas", [
        "exploratorium.edu",
        "instructables.com",
        "en.wikibooks.org",
      ]);
      for (const h of result.hits.slice(0, 2))
        try {
          hits.push(await importCreativeEvidence(db, actor, { url: h.url }));
        } catch {
          issues.push("公开经验命中未能实际读取，仅搜索摘要不作来源");
        }
    } catch {
      issues.push(
        "创意联网搜索未完成/未获授权；继续AI创意，不声称已有公开经验",
      );
    }
  for (const e of hits) {
    e.conditions.push("检索主题：" + topic);
    db.prepare(
      "UPDATE life_creative_evidence SET body=? WHERE owner=? AND id=?",
    ).run(JSON.stringify(e), actor, e.id);
  }
  return { evidence: hits.slice(0, 4), issues, cached: false };
}
