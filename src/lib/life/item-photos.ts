import type { Item, Person } from "../domain.ts";
import { syntheticItem } from "./availability.ts";

// Presentation-only assets: never write generated pictures into user inventory or evidence.
const illustrations: Record<string, readonly [string, string]> = {
  lamp: ["书桌上的台灯", "desk-lamp"],
  frame: ["木质相框", "wood-frame"],
  beads: ["彩色拼豆材料", "craft-beads"],
  filter: ["家里的净水器", "water-filter"],
  cup: ["随行保温杯", "travel-cup"],
  "life-sample-0": ["无线鼠标", "wireless-mouse"],
  "life-sample-1": ["随身音箱", "portable-speaker"],
  "life-sample-2": ["厨房小推车", "kitchen-cart"],
  "life-sample-3": ["电热水壶", "electric-kettle"],
  "life-sample-4": ["空气净化器", "air-purifier"],
  "life-sample-5": ["空气炸锅", "air-fryer"],
  "life-sample-6": ["无线吸尘器", "stick-vacuum"],
  "life-sample-7": ["小边桌", "side-table"],
  "life-sample-8": ["收纳搁架", "storage-shelf"],
  "life-sample-9": ["阅读书架", "reading-bookcase"],
  "life-sample-10": ["棉质衬衫", "cotton-shirt"],
  "life-sample-11": ["旧围巾", "old-scarf"],
  "life-sample-12": ["旅行背包", "travel-backpack"],
  "life-sample-13": ["散步相机", "walking-camera"],
  "life-sample-14": ["窗边绿植", "window-plant"],
  "life-sample-15": ["速写本与铅笔", "sketchbook"],
  "life-sample-16": ["密封餐盒", "lunch-box"],
  "life-sample-17": ["苹果", "apples"],
  "life-sample-18": ["全麦面包", "wholegrain-bread"],
  "life-sample-19": ["野餐垫", "picnic-mat"],
};

export function itemPhoto(item: Item, actor: Person) {
  // An uploaded/custom photo always wins, including for edited demonstration records.
  if (
    item.photo &&
    (!syntheticItem(item) || !item.photo.startsWith("/demo/life/"))
  )
    return {
      src: item.photo.startsWith("/api/life/media/")
        ? item.photo.replace(/actor=[^&]+/, `actor=${actor}`)
        : item.photo,
      label: syntheticItem(item) ? "演示物品 · 物品照片" : "我的物品",
      generated: false,
    };
  const match = illustrations[item.id];
  if (syntheticItem(item) && match?.[0] === item.name)
    return {
      src: `/demo/objects-v1/${match[1]}.webp`,
      label: "演示物品 · AI 示意图",
      generated: true,
    };
  // Unknown or renamed objects must not silently inherit an unrelated category image.
  return undefined;
}
