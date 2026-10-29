import type { DatabaseSync } from "node:sqlite";
import {
  APARTMENT_ID,
  apartmentProducts,
  homeItemId,
} from "../catalog/virtual-apartment.ts";
import { type Item, type Person, type State, canRead } from "../domain.ts";
import { boundPack } from "../ai/harness.ts";
import { productPacks } from "../products.ts";
import { AgentError } from "../agent/contracts.ts";
import { saveMemory, savePersona, clearOwnerContext } from "../memory/store.ts";
import { saveFragment } from "./stories.ts";
import { fetchPublicDocument } from "./sources.ts";
import { modelMentioned, officialDomain } from "./knowledge.ts";
import {
  makeKnowledgeDocument,
  readKnowledge,
  storeOfficialDocument,
  knowledgeIdentity,
} from "./acquisition.ts";
import { isProductManual } from "./manuals.ts";

export function virtualHomeItems(state: State, actor: Person) {
  return state.items.filter(
    (i) =>
      i.synthetic === true &&
      i.owner === actor &&
      canRead(i, actor) &&
      [...apartmentProducts.map((p) => p.key), "painting"].some(
        (key) => i.id === homeItemId(actor, key),
      ),
  );
}
export function installVirtualHome(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  consentCloud: boolean,
) {
  const version = APARTMENT_ID + ":" + actor;
  if (
    db.prepare("SELECT 1 FROM life_installations WHERE version=?").get(version)
  )
    return {
      installed: true,
      replayed: true,
      itemIds: virtualHomeItems(read(), actor).map((i) => i.id),
    };
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = read();
    for (const p of apartmentProducts) {
      const id = homeItemId(actor, p.key);
      if (state.items.some((i) => i.id === id)) continue;
      const pack = productPacks.find((x) => x.model === p.model);
      state.items.push({
        id,
        name: p.name,
        brand: p.brand,
        model: p.model,
        category: p.category,
        location: p.location,
        note: p.note,
        owner: actor,
        shared: false,
        synthetic: true,
        source: "虚拟年轻人公寓 · 模拟持有",
        state: "在用",
        availability: "available",
        icon: "box",
        lifecycle: "长期耐用",
        supportUrl: p.url,
        ...(pack
          ? {
              productBinding: {
                packId: pack.id,
                version: pack.version,
                confirmedBy: actor,
                confirmedAt: new Date().toISOString(),
              },
            }
          : {}),
      });
    }
    const paintingId = homeItemId(actor, "painting");
    if (!state.items.some((i) => i.id === paintingId))
      state.items.push({
        id: paintingId,
        name: "远山 · 朋友送的画",
        brand: "无品牌原创",
        model: "无商品型号",
        category: "画作",
        location: "书桌旁，尚未安排支撑（模拟）",
        note: "原创画作、尺寸、照片及私人经历均为模拟；玻璃、背部支架、挂件与重量未知。",
        source: "虚拟年轻人公寓 · 模拟持有",
        owner: actor,
        shared: false,
        synthetic: true,
        state: "在用",
        availability: "available",
        icon: "picture",
        photo: "/virtual-home/painting.svg",
        attributes: {
          dimensions: "40×30厘米（模拟用户报告）",
          material: "纸本与木框（模拟用户报告），其他结构未知",
        },
      });
    state.virtualHomes = {
      ...state.virtualHomes,
      [actor]: {
        id: APARTMENT_ID,
        allowCloud: consentCloud,
        installedAt: new Date().toISOString(),
      },
    };
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(state),
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  // Reuse domain operations and receipts. Loading again never restores forgotten/corrected memories.
  saveMemory(
    db,
    read,
    actor,
    {
      kind: "preference",
      text: "模拟家庭设定：我喜欢安静，用右手写旅行手账，优先用现有物品，不想再买东西。",
      itemId: homeItemId(actor, "desk"),
      allowCloud: consentCloud,
    },
    undefined,
    version + ":preference",
  );
  const fragment = saveFragment(db, read, actor, {
    text: "模拟私人经历：这幅《远山》是朋友小夏送给我的；搬进这间公寓时，我把它带来了。赠送日期与更多情感细节没有记录。",
    itemIds: [homeItemId(actor, "painting")],
    allowRecall: false,
    allowCloud: false,
    origin: "user-record",
  });
  saveMemory(
    db,
    read,
    actor,
    {
      kind: "relationship",
      text: fragment.text,
      itemId: homeItemId(actor, "painting"),
      allowCloud: consentCloud,
    },
    undefined,
    version + ":relationship",
    { id: fragment.id, revision: fragment.revision },
  );
  savePersona(db, read(), actor, {
    enabled: false,
    nickname: "山山",
    avatar: "frame",
    style: "warm",
    memoryUse: "relevant",
    itemId: homeItemId(actor, "painting"),
  });
  db.prepare("INSERT OR IGNORE INTO life_installations VALUES(?)").run(version);
  return {
    installed: true,
    replayed: false,
    itemIds: virtualHomeItems(read(), actor).map((i) => i.id),
  };
}
export function setVirtualHomeCloud(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  allowCloud: boolean,
) {
  if (virtualHomeItems(read(), actor).length !== 8)
    throw new AgentError("请先完整加载模拟家庭", 409);
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = read();
    state.virtualHomes = {
      ...state.virtualHomes,
      [actor]: {
        id: APARTMENT_ID,
        installedAt:
          state.virtualHomes?.[actor]?.installedAt || new Date().toISOString(),
        allowCloud,
      },
    };
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(state),
    );
    clearOwnerContext(db, actor, false);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return {
    allowCloud,
    notice: "只更改模拟家庭任务授权，单条私人记忆仍保留自己的云端许可。",
  };
}
export function homeKnowledgeStatus(
  db: DatabaseSync,
  state: State,
  actor: Person,
) {
  return virtualHomeItems(state, actor).map((i) => {
    const row = db
      .prepare(
        "SELECT at,result FROM life_knowledge_fetches WHERE owner=? AND item_id=?",
      )
      .get(actor, i.id) as { at: string; result: string } | undefined;
    return {
      itemId: i.id,
      model: i.model,
      reviewedPack: boundPack(i)
        ? { source: boundPack(i)!.source, facts: boundPack(i)!.claims }
        : undefined,
      ...(row
        ? { at: row.at, ...JSON.parse(row.result) }
        : {
            status: "not-fetched",
            issues: ["尚未联网获取，不把型号名称当成已知规格"],
          }),
      documents: readKnowledge(db, state, actor, i.id).map((d) => ({
        id: d.id,
        url: d.url,
        title: d.title,
        fetchedAt: d.fetchedAt,
        role: d.role,
        applicability: d.applicability,
        observations: d.observations || [],
        excerpt: d.text.slice(0, 480),
      })),
    };
  });
}
export async function refreshHomeKnowledge(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  key: string,
  fetcher = fetchPublicDocument,
) {
  const p = apartmentProducts.find((p) => p.key === key);
  if (!p) throw new AgentError("商品不在固定家庭范围", 400);
  const item = virtualHomeItems(read(), actor).find(
    (i) => i.id === homeItemId(actor, key),
  );
  if (!item) throw new AgentError("请先加载自己的虚拟家庭", 403);
  const snapshot = knowledgeIdentity(item),
    documents = [],
    attempts: {
      url: string;
      status: string;
      reason?: string;
      hash?: string;
    }[] = [],
    issues: string[] = [];
  const get = async (
    url: string,
    kind: "product" | "manual",
    chain: string[],
    region: string,
    applicability?: string,
    verifiedProductLink = false,
  ) => {
    try {
      const d = await fetcher(url,0,kind==="manual"&&p.brand==="JBL"?16_000_000:12_000_000);
      if (!officialDomain(d.url, p.brand)) throw Error("非对应品牌官方来源");
      const byExactProductLink =
        kind === "manual" &&
        verifiedProductLink &&
        chain.length > 1 &&
        chain[0] === p.url &&
        isProductManual({ url, title: d.title });
      if (
        !modelMentioned(d.title + " " + d.text, p.model) &&
        !byExactProductLink
      )
        throw Error("正文缺少完整型号或已核对的商品页说明书关联");
      if (
        !virtualHomeItems(read(), actor).some(
          (i) => i.id === item.id && knowledgeIdentity(i) === snapshot,
        )
      )
        throw new AgentError("物品资料已变化，请重新获取", 409);
      const doc = {
        ...makeKnowledgeDocument(d, item, chain, region),
        role: kind,
        applicability:
          applicability || "对应官方页面的型号资料；不证明私人实物当前状态",
      };
      storeOfficialDocument(db, actor, item, doc);
      documents.push(doc);
      attempts.push({ url: d.url, status: "live-read", hash: doc.hash });
      return d;
    } catch (e) {
      const reason = e instanceof Error ? e.message : "获取失败";
      attempts.push({ url, status: "failed", reason });
      issues.push(reason);
      return undefined;
    }
  };
  const main = await get(
    p.url,
    "product",
    [p.url],
    p.brand === "IKEA" ? "cn" : "unspecified",
  );
  const pages = main ? [main] : [];
  if (!main && "alternatives" in p)
    for (const url of p.alternatives) {
      const page = await get(url, "product", [p.url, url], "unspecified");
      if (page) pages.push(page);
    }
  const manuals = pages
    .flatMap((page) => page.links)
    .filter(isProductManual)
    .filter((l) => officialDomain(l.url, p.brand))
    .slice(0, 2);
  for (const link of manuals)
    await get(
      link.url,
      "manual",
      [p.url, link.url],
      p.brand === "IKEA" ? "cn" : "unspecified",
      undefined,
      true,
    );
  if ("manuals" in p)
    for (const m of p.manuals)
      if (!attempts.some((a) => a.url === m.url))
        await get(m.url, "manual", [p.url, m.url], m.region, m.note);
  const status = documents.length
    ? "live-read"
    : readKnowledge(db, read(), actor, item.id).length
      ? "cached-fallback"
      : "unavailable";
  db.prepare(
    "INSERT INTO life_knowledge_fetches(owner,item_id,identity,at,result) VALUES(?,?,?,?,?) ON CONFLICT(owner,item_id) DO UPDATE SET identity=excluded.identity,at=excluded.at,result=excluded.result",
  ).run(
    actor,
    item.id,
    snapshot,
    new Date().toISOString(),
    JSON.stringify({
      status,
      attempts,
      issues,
      successful: documents.length > 0,
    }),
  );
  return { itemId: item.id, status, attempts, issues };
}
