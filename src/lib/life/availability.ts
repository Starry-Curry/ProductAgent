import type { Item } from "../domain.ts";
export function syntheticItem(item: Item) {
  return !!item.synthetic || !!item.demo || item.source === "示例数据";
}
export function usable(item: Item, now = Date.now()) {
  if (item.availability && item.availability !== "available") return false;
  if (!["在用", "闲置"].includes(item.state)) return false;
  if (
    item.attributes?.quantity !== undefined &&
    (!Number.isFinite(Number(item.attributes.quantity)) ||
      Number(item.attributes.quantity) <= 0)
  )
    return false;
  if (
    item.attributes?.expiresOn &&
    Date.parse(item.attributes.expiresOn + "T23:59:59+08:00") < now
  )
    return false;
  return true;
}
