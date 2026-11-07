import type { Item } from "../api";

/** Presentation only: original uploads first, supplied demo/catalog imagery later. */
export function orderItemCards(items: Item[]): Item[] {
  function rank(item: Item): number {
    if (!item.photo_id) return 2;
    const origin = String(item.state.photo_origin || item.state.data_origin || "");
    return /generated|illustration|simulat|official|reference_not_user/i.test(origin) ? 1 : 0;
  }
  // The API retains creation order. Reverse only the upload group so newly
  // entered photos lead, keeping other groups stable and never mutating facts.
  return items.map((item, index) => ({ item, index, rank: rank(item) }))
    .sort((a, b) => a.rank - b.rank || (a.rank === 0 ? b.index - a.index : a.index - b.index))
    .map(({ item }) => item);
}
