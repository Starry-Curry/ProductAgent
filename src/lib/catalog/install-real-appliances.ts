import type { DatabaseSync } from "node:sqlite";
import type { State } from "../domain.ts";
import { bindReferenceAppliance, realAppliances } from "./real-appliances.ts";
/** Explicit companion-only upgrade of known synthetic fixtures, once per DB.
 * Arbitrary user-created appliances must be selected explicitly, never inferred. */
export function upgradeReferenceFixtures(state: State) {
  for (const p of realAppliances)
    for (const id of p.itemIds) {
      const i = state.items.find((i) => i.id === id);
      if (
        i &&
        (i.synthetic || i.source === "示例数据" || i.demo) &&
        !i.referenceProductId &&
        (!i.photo || i.photo.startsWith("/demo/"))
      ) {
        bindReferenceAppliance(i, p.id);
      }
    }
  return state;
}
export function installReferenceFixtures(db: DatabaseSync) {
  if (process.env.WUJIAN_REAL_CATALOG !== "true") return;
  db.exec(
    "CREATE TABLE IF NOT EXISTS reference_catalog_installations(version TEXT PRIMARY KEY,at TEXT NOT NULL)",
  );
  if (
    db
      .prepare("SELECT 1 FROM reference_catalog_installations WHERE version=?")
      .get("real-appliances-v1")
  )
    return;
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT body FROM workspace WHERE id=1").get() as {
      body: string;
    };
    const s = upgradeReferenceFixtures(JSON.parse(row.body));
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(JSON.stringify(s));
    if (
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE name='companion_records'")
        .get()
    ) {
      for (const [name, key, img] of [
        ["床头阅读灯", "lamp", "desk-lamp"],
        ["便携蓝牙音箱", "speaker", "portable-speaker"],
      ]) {
        const product = realAppliances.find((p) => p.key === key)!;
        for (const row of db
          .prepare("SELECT id,body FROM companion_records WHERE kind='wish'")
          .all() as { id: string; body: string }[]) {
          const wish = JSON.parse(row.body);
          if (
            wish.name === name &&
            wish.photo === `/demo/objects-v1/${img}.webp` &&
            !wish.url
          ) {
            wish.photo = product.photo;
            wish.url = product.productUrl;
            wish.revision++;
            db.prepare(
              "UPDATE companion_records SET body=?,revision=? WHERE id=?",
            ).run(JSON.stringify(wish), wish.revision, row.id);
          }
        }
      }
    }
    db.prepare("INSERT INTO reference_catalog_installations VALUES(?,?)").run(
      "real-appliances-v1",
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
