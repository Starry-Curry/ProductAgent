import {discoverPublishers,publisherOwns,type PublisherProof} from './publisher.ts';
import { isProductManual,notProductEvidence } from "./manuals.ts";
import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { type Item, type Person, type State } from "../domain.ts";
import { authorize } from "../foundation/policy.ts";
import { productPacks } from "../products.ts";
import { AgentError } from "../agent/contracts.ts";
import {
  brandEntry,
  officialDomain,
  modelMentioned,
  findOfficial,
  type PublicDocument,
} from "./knowledge.ts";
import { fetchPublicDocument, sourceURL, listSources,type SourceReading,type OriginalPublicPayload } from "./sources.ts";
import type { Provider } from "../ai/provider.ts";
import { selectTaskEvidence } from "./knowledge-task.ts";
import { multilingualAnchors } from "./retrieval-topics.ts";
import type {KnowledgeReference} from '../context/source-reference.ts';

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
  publisherProof?:PublisherProof;
  sourceSelections?: {version:1;entries:{reference:KnowledgeReference;kind:'fact'|'operation'|'condition';selectedBy:string}[]};
  role?: "product" | "manual";
  applicability?: string;
  observations?: {
    kind: "fact" | "operation" | "limitation";
    topic: string;
    value: string;
    quote: string;
  }[];
  processorVersion?: string;
  productModels?:string[];
  originalPayload?:OriginalPublicPayload;
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
  reading?: SourceReading;
  sections?: {title:string;url:string}[];
};
/** Exact URL grant from a manufacturer's exact-model page, never a blanket CDN allowlist. */
export function exactProductSubject(doc:AcquiredDocument,model:string){return doc.productModels?.length ? doc.productModels.some(m=>modelMentioned(m,model)) : modelMentioned(doc.title,model);}
export function trustedOfficialDocument(doc:AcquiredDocument,item:Item,documents:AcquiredDocument[]){
 if(officialDomain(doc.url,item.brand||doc.brand||'')||publisherOwns(doc.url,item.brand||doc.brand||'',doc.publisherProof))return true;
 return doc.applicability==='manufacturer_linked_manual'&&documents.some(parent=>(officialDomain(parent.url,item.brand||'')||publisherOwns(parent.url,item.brand||'',parent.publisherProof))&&exactProductSubject(parent,item.model)&&doc.chain.includes(parent.url)&&parent.sections?.some(l=>l.url===doc.url&&isProductManual(l)));
}
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
  const regions = [
    "cn",
    "uk",
    "us",
    "global",
    "my",
    "au",
    "sg",
    "tw",
    "hk",
    "jp",
    "de",
    "fr",
  ];
  // A language prefix is not a region. Match only explicit country segments.
  for(const part of u.pathname.split('/').filter(Boolean).slice(0,2)){
    const token=part.toLowerCase().replace(/^([a-z]{2})-/, '');
    if(token==='gb')return 'uk';if(regions.includes(token))return token;
  }
  return "unspecified";
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
    productModels:'productModels' in d?d.productModels:undefined,
    originalPayload:'originalPayload' in d?d.originalPayload:undefined,
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
    reading: 'reading' in d ? d.reading : undefined,
    sections: d.links.filter(l=>officialDomain(l.url,item.brand||'')||isProductManual(l)).slice(0,300),
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
  const item = state.items.find((i) => i.id === itemId && authorize(db, state, actor, i.id).allowed);
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
    multilingualAnchors(question,eligible).length
      ? [...multilingualAnchors(question,eligible),...ranked].filter((c,i,all)=>all.findIndex(x=>x.id===c.id)===i).slice(0,14)
      : ranked.length ? ranked
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
  const item = state.items.find((i) => i.id === itemId && authorize(db, state, actor, i.id).allowed);
  if (!item) throw new AgentError("物品不存在或未获授权", 403);
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
    query?: string;
    purpose?:'general'|'specifications'|'operation'|'care'|'policy';
    force?: boolean;
    persist?: boolean;
    fetchDocument?: typeof fetchPublicDocument;
    search?: Provider["search"];
    seedURLs?: string[];
    preferManual?: boolean;
    publisherDependencies?:Parameters<typeof discoverPublishers>[2];
  } = {},
) {
  const purpose=options.purpose||(options.preferManual?'operation':'general');
  const publicPurposes={general:'official product information',specifications:'official product specifications dimensions features',operation:'official user manual operating instructions',care:'official care maintenance cleaning instructions',policy:'official warranty service policy'} as const;
  if(!Object.hasOwn(publicPurposes,purpose))throw new AgentError('资料查找目的无效');
  const initialState = read();
  const foundItem = initialState.items.find(
    (i) => i.id === itemId && authorize(db, initialState, actor, i.id).allowed,
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
    (previousSucceeded||(previousResult?.acquisition?.discoveryPurpose||'general')===purpose)&&
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
  let publisherProofs:PublisherProof[]=[];
  const isOfficial=(url:string,_brand=brand)=>officialDomain(url,_brand)||publisherProofs.some(p=>publisherOwns(url,_brand,p));
  function documentFor(d:PublicDocument,chain:string[],sourceRegion:string){
   const doc=makeKnowledgeDocument(d,{...item,brand},chain,sourceRegion);
   doc.publisherProof=publisherProofs.find(p=>publisherOwns(d.url,brand,p));
   doc.sections=d.links.filter(l=>isOfficial(l.url)||isProductManual(l)).slice(0,300);return doc;
  }
  const acquisition = {
    discoveryPurpose:purpose,
    seedURLs: options.seedURLs || [],
    searchAttempted: false,
    searchCompleted: false,
    searchURLs: [] as string[],
    readURLs: [] as string[],
    verifiedURLs: [] as string[],
    attemptedURLs: [] as string[],
    searchFailure: undefined as {type:string;code?:string;detail?:string}|undefined,
  };
  const attempted=new Map<string,Promise<PublicDocument>>();
  let requests = 0;
  const get = async (url: string) => {
    if(attempted.has(url))return attempted.get(url)!;
    if (++requests > 8) throw new AgentError("本轮官方资料读取达到8份上限");
    acquisition.attemptedURLs.push(url);
    const pending=fetcher(url).then(page=>{acquisition.readURLs.push(page.url);return page;});attempted.set(url,pending);return pending;
  };
  const packs = productPacks.filter(
    (p) =>
      modelMentioned(p.model, item.model) &&
      isOfficial(p.source.url, brand),
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
  async function accept(url: string, chain: string[], sourceRegion: string,parent?:AcquiredDocument) {
    const d = await get(url);
    const inherited=!!parent&&isOfficial(parent.url,brand)&&exactProductSubject(parent,item.model)&&parent.sections?.some(l=>l.url===url&&isProductManual(l))&&d.url===url;
    if(!isOfficial(d.url,brand)&&!inherited){issues.push('最终站点未通过厂家范围核对，未采用');return;}
    if ((d.extracted?.model&&!modelMentioned(d.extracted.model,item.model))||(!modelMentioned(d.title + " " + d.text, item.model)&&!inherited)) {
      issues.push("官方文档未包含完整型号，未采用：" + new URL(url).hostname);
      return;
    }
    if (item.region && item.region !== 'unspecified' && sourceRegion !== item.region) {
      issues.push("资料地区与档案不一致，未采用");
      return;
    }
    const document=documentFor(d,chain,sourceRegion);if(inherited)document.applicability='manufacturer_linked_manual';documents.push(document);
  }
  if (!documents.length && options.search) {
    try {
      acquisition.searchAttempted = true;
      // The model may have seen private stories or may already be guessing an
      // unverified component number. Neither belongs in public discovery. Find
      // the registered commercial identity first; question-specific selection
      // happens over the acquired originals inside the authorized provider.
      const country=/^(?:[a-z]{2}|global)$/i.test(item.region||'')?item.region:'';
      const discoveryQuery=`${brand} ${item.model} ${publicPurposes[purpose]} ${country||''}`;
      let result = await options.search(
        discoveryQuery,
        entry?[...entry.domains]:[],
      );
      acquisition.searchCompleted = true;
      if(!entry){const identity=await discoverPublishers(brand,result.hits.map(h=>h.url),options.publisherDependencies);publisherProofs=identity.proofs;issues.push(...identity.issues);}
      // Search and publisher identity are separate. An independent company
      // record can identify a valid regional site missing from the first hit
      // list. Search that verified scope once, rather than certifying an
      // unverified first hit or asking the user to supply the official URL.
      if(!entry&&publisherProofs.length&&!result.hits.some(h=>isOfficial(h.url,brand))){
       const sites=[...new Set(publisherProofs.map(p=>new URL(p.redirectChain.at(-1)!).hostname))].slice(0,3);
       const scoped=await options.search(discoveryQuery,sites);
       result={...scoped,hits:[...scoped.hits,...result.hits].filter((h,n,a)=>a.findIndex(x=>x.url===h.url)===n)};
      }
      // A model may return many valid sources. Keep an exact-model identity
      // anchor: module-number PDFs often omit the commercial SKU and need an
      // actual manufacturer's link before they are applicable. A PDF suffix is
      // not sufficient reason to spend all bounded reads before that anchor.
      // Keep the provider's source candidates until AFTER ranking. A download
      // index often contains the model in its URL while the actual manual uses
      // opaque document IDs. Prefer readable chapters over such landing pages;
      // exact subject/model/region must still be checked on the fetched body.
      const rankedHits=result.hits.filter(h=>isOfficial(h.url,brand)&&!notProductEvidence(h)).map((h,n)=>{
        let decoded=h.url;try{decoded=decodeURI(decoded);}catch{}
        const path=new URL(h.url).pathname;
        const chapter=/\/(?:contents?|chapters?|manual|guides?)\/.+\.(?:html?|pdf)$|\/(?:helpguide|user[-_]?manual)\//i.test(decoded);
        const index=/\/(?:manuals|downloads|support|faqs)\/?$|\/(?:index|default)\.html?$/i.test(path);
        const exact=modelMentioned(h.title+' '+decoded,item.model),spec=/specification|dimension|features|规格|仕様|尺寸/i.test(h.title+' '+decoded);
        const score=purpose==='specifications'?Number(exact)*16+Number(spec)*4+Number(!isProductManual(h))*2-Number(index)*3:Number(chapter)*12+Number(isProductManual(h))*6+Number(/\.pdf$/i.test(path))*3+Number(exact)*4-Number(index)*3;
        return {h,n,identityAnchor:!index&&!/\.pdf$/i.test(path)&&exact,score};
      }).sort((a,b)=>b.score-a.score||a.n-b.n);
      const candidates=[...rankedHits.filter(h=>h.identityAnchor).slice(0,2),...rankedHits].filter((x,n,a)=>a.findIndex(y=>y.h.url===x.h.url)===n).slice(0,4);
      acquisition.searchURLs = result.hits.slice(0,48).map(h=>h.url);
      for (const {h:hit} of candidates) {
        if (requests >= 8) break;
        if (!isOfficial(hit.url, brand)) continue;
        try {
          const d = await get(hit.url),
            sourceRegion = regionOf(d.url);
          if (
            !isOfficial(d.url, brand) ||
            (d.extracted?.model&&!modelMentioned(d.extracted.model,item.model))||!modelMentioned(d.title + " " + d.text, item.model)
          ) {
            issues.push("搜索命中未通过最终域名/完整型号核对，未采用");
            continue;
          }
          if (item.region && item.region !== 'unspecified' && item.region !== sourceRegion) {
            issues.push("搜索来源地区不一致或未明，未采用");
            continue;
          }
          if (!documents.some((s) => s.url === d.url))
            documents.push(
              documentFor(d,["bailian-responses:structured-search",d.url],sourceRegion),
            );
        } catch {
          issues.push("搜索命中公开页面无法读取，未采用模型摘要替代原文");
        }
      }
      if (!result.hits.length)
        issues.push("搜索未返回结构化来源，不使用模型正文引用。");
    } catch (error) {
      const e=error as {name?:string;code?:string;message?:string};
      acquisition.searchFailure={type:e.name||'Error',code:typeof e.code==='string'&&/^[a-z0-9_-]{1,80}$/i.test(e.code)?e.code:undefined,detail:typeof e.message==='string'&&/^[a-z0-9_ .:;-]{1,160}$/i.test(e.message)?e.message:undefined};
      issues.push("联网搜索未完成或未获授权，本轮不重试。");
    }
  }
  if(options.preferManual&&entry?.domains[0]==='canon.com.cn'){
    const found=await findOfficial({brand,model:item.model},get);issues.push(...found.issues);
    for(const d of found.documents)if((!item.region||item.region==='unspecified'||regionOf(d.url)===item.region||regionOf(d.url)==='unspecified')&&/\/manual\//.test(new URL(d.url).pathname))documents.push(makeKnowledgeDocument(d,{...item,brand},found.discoveryChains[d.url]||[d.url],regionOf(d.url)));
  }
  for(const url of (documents.length?[]:[...new Set([item.supportUrl,...(options.seedURLs||[])].filter((u):u is string=>!!u))].slice(0,3))){
    try{if(!isOfficial(url,brand))continue;await accept(url,[url],regionOf(url));}catch{issues.push('种子资料未取得可用正文；继续官方发现，不把种子存在当获取成功');}
  }
  try {
    if (!documents.length &&
      entry?.domains[0] === "sony.com" &&
      /^[a-z0-9-]+$/i.test(item.model)
    ) {
      const support = `https://www.sony.com/electronics/support/product/${item.model.toLowerCase()}/manuals`;
      const d = await get(support);
      if (modelMentioned(d.title + " " + d.text, item.model) && (!item.region || item.region==='unspecified')) {
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
    } else if (!documents.length && entry?.domains[0] === "mi.com") {
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
    } else if (!documents.length) {
      const found = await findOfficial({ brand, model: item.model }, get);
      issues.push(...found.issues);
      for (const d of found.documents) {
        const sourceRegion = regionOf(d.url);
        if (item.region && item.region !== 'unspecified' && sourceRegion !== item.region) {
          issues.push("官方来源地区不一致，未采用");
          continue;
        }
        documents.push(
          makeKnowledgeDocument(d, { ...item, brand }, found.discoveryChains?.[d.url]||[d.url], sourceRegion),
        );
        for (const link of d.links
          .filter((l) => /\.pdf(?:$|[?#])/i.test(l.url) && isProductManual(l))
          .slice(0, 1)) {
          const h = new URL(link.url).hostname;
          if (
            isOfficial(link.url, brand) ||
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
  // A search may land on a category listing. Follow only actual exact-model
  // product/support links, at most two navigation levels, never guess a URL.
  let frontier=[...documents];
  for(let depth=0;depth<2&&requests<8;depth++){
    const discovered:AcquiredDocument[]=[];
    for(const parent of frontier)for(const link of (parent.sections||[]).filter(l=>{
      try{const u=new URL(l.url);return !u.hash&&!/\.pdf(?:[?#]|$)/i.test(l.url)&&isOfficial(l.url,brand)&&modelMentioned(l.title+' '+decodeURI(l.url),item.model);}catch{return false;}
    }).slice(0,2)){
      if(requests>=8||attempted.has(link.url))continue;
      const before=documents.length;try{await accept(link.url,[...parent.chain,link.url],regionOf(link.url));discovered.push(...documents.slice(before));}catch{issues.push('型号相关的真实导航链接未取得正文，未猜测替代地址');}
    }
    frontier=discovered;
  }
  // Follow only actual manual links on already exact-model official pages.
  for(const parent of [...documents]){
    for(const link of (parent.sections||[]).filter(l=>isProductManual(l)).slice(0,2)){
      if(requests>=8)break;
      if(documents.some(d=>d.url===link.url))continue;
      try{await accept(link.url,[...parent.chain,link.url],regionOf(link.url),parent);}catch{issues.push('已发现的说明书正文未取得；保留真实来源与失败，不采用模型摘要替代原文');}
    }
  }
  const currentState = read();
  const current = currentState.items.find(
    (i) => i.id === itemId && authorize(db, currentState, actor, i.id).allowed,
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

export function documentEvidence(documents: AcquiredDocument[]) {
  return documents.flatMap(d=>(d.observations||[]).flatMap((o,index)=>
    o.quote&&d.text.includes(o.quote)?[{id:d.id+'/observation/'+index,label:o.topic,text:o.quote,url:d.url,model:d.model,basis:'quoted_source_candidate_not_capability',candidateInterpretation:o.value}]:[]));
}
