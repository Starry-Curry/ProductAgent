import { type Item, type Person, type State } from "../domain.ts";
import type { DatabaseSync } from "node:sqlite";
import { authorize } from "../foundation/policy.ts";
import { boundPack } from "../ai/harness.ts";
import { usable, syntheticItem } from "../life/availability.ts";

const known = (value?: string) =>
  value && !/^(未知|待确认|不详|无型号|未确认)$/.test(value.trim())
    ? value
    : null;
/** Model-facing business data only: no owner identity, location, notes, stories or media. */
export function itemContext(item: Item) {
  const pack = boundPack(item);
  const attributes = item.attributes || {};
  return {
    schemaVersion: "item-context-v1" as const,
    id: item.id,
    name: item.name,
    category: item.category,
    brand: known(item.brand),
    model: known(item.model),
    region: known(item.region),
    state: item.state,
    availability: item.availability || "unknown",
    usable: usable(item),
    synthetic: syntheticItem(item),
    properties: {
      material: known(attributes.material),
      dimensions: known(attributes.dimensions),
      power: known(attributes.power),
      care: known(attributes.care),
      quantity: attributes.quantity ?? null,
      unit: attributes.quantityUnit || null,
      capabilities: attributes.capabilities || [],
    },
    physicalFacts: attributes.physicalFacts || [],
    sources: {
      registration: { kind: "user_report" as const, verified: false },
      official: pack
        ? {
            id: pack.id,
            version: pack.version,
            title: pack.source.title,
            url: pack.source.url,
          }
        : null,
    },
    officialFacts: pack?.claims || [],
    productUnderstanding: pack?.understanding || null,
    limits: pack?.limits || [],
    unknowns: [
      ...(!known(item.brand) ? ["品牌"] : []),
      ...(!known(item.model) ? ["型号"] : []),
      ...(!known(attributes.material) ? ["材质"] : []),
      ...(!known(attributes.dimensions) ? ["尺寸"] : []),
      "未明确给出的几何结构、耐热范围、承重、食品接触适用性、设备专属功能均未确认；名称或类别不证明这些性质",
    ],
    evidencePolicy:
      "登记属性是用户报告；官方事实仅限列出的原文。未知不等于不支持，也不等于已确认可用。建议前先核对任务所需条件。",
  };
}
export type ItemContext = ReturnType<typeof itemContext>;

/** Cross-person reads require the live database policy. Pure projections are
 * owner-only: a legacy share flag cannot prove an explicit grant is current. */
export function accessibleItemContexts(
  state: State,
  actor: Person,
  demo = false,
  db?: DatabaseSync,
) {
  return state.items
    .filter((i) => (db ? authorize(db, state, actor, i.id).allowed : i.owner === actor) && (demo ? !!i.demo : !i.demo))
    .map(itemContext);
}
export function readItemContext(
  state: State,
  actor: Person,
  id: string,
  demo = false,
  db?: DatabaseSync,
) {
  return accessibleItemContexts(state, actor, demo, db).find((i) => i.id === id);
}
export function itemContextPage(
  state: State,
  actor: Person,
  demo = false,
  offset = 0,
  limit = 20,
  db?: DatabaseSync,
) {
  const all = accessibleItemContexts(state, actor, demo, db);
  const items = all.slice(offset, offset + limit);
  return {
    items,
    total: all.length,
    nextOffset:
      offset + items.length < all.length ? offset + items.length : null,
  };
}
