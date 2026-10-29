import type { DatabaseSync } from "node:sqlite";
import type { State, Person, Item } from "../domain.ts";
import { alphaProductPacks } from "../catalog/alpha-products.ts";
/** Explicit user action only. Private, synthetic records; never claim real possession. */
export function installAlphaSamples(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = read();
    const ids: string[] = [];
    for (const pack of alphaProductPacks) {
      const id = "alpha-test-" + actor + "-" + pack.id;
      ids.push(id);
      if (state.items.some((i) => i.id === id)) continue;
      const item: Item = {
        id,
        name: "测试商品 · " + pack.product,
        brand: "IKEA",
        model: pack.model,
        region: "cn",
        category: "收纳用品",
        owner: actor,
        shared: false,
        synthetic: true,
        source: "智能核心合成测试商品",
        state: "闲置",
        availability: "available",
        location: "隔离测试设定",
        icon: "home",
        note: "真实型号资料，合成持有与状态；不代表本人拥有或实物验证。",
        lifecycle: "长期耐用",
        attributes: { quantity: 1, quantityUnit: "件" },
        productBinding: {
          packId: pack.id,
          version: pack.version,
          confirmedBy: actor,
          confirmedAt: new Date().toISOString(),
        },
      };
      state.items.push(item);
    }
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(state),
    );
    db.exec("COMMIT");
    return { itemIds: ids };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
