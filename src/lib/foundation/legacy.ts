import { createHash } from "node:crypto";
import type { Item, State } from "../domain.ts";
export const fingerprint = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function productModel(item: Item) {
  if (!item.model?.trim()) return undefined;
  const identity = { brand:(item.brand || "").trim().toUpperCase(), model:item.model.trim().toUpperCase(), region:item.region || "unknown", firmware:"unknown" };
  return { version:"product-model/1" as const, modelKey:"pm_"+fingerprint(identity).slice(0,32), ...identity };
}
export function itemInstance(item: Item) {
  return { version:"item-instance/1" as const, itemInstanceId:item.id, modelKey:productModel(item)?.modelKey,
    owner:item.owner, state:item.state, availability:item.availability || "unknown", location:item.location,
    personalFacts:{basis:"user_report" as const, attributes:item.attributes || {}}, synthetic:!!item.synthetic,
    revision:fingerprint(item) };
}
export function legacyRelations(state: State, itemId: string) {
  const item=state.items.find(i=>i.id===itemId); if(!item) return [];
  return [{relationId:`owns:${item.id}`,subjectId:item.owner,objectId:item.id,type:"owns",source:"confirmed_action"},
    ...(item.transferredFrom ? [{relationId:`gift:${item.id}`,subjectId:item.transferredFrom.itemId,objectId:item.id,type:"gifted_to",source:"confirmed_action"}] : [])];
}
