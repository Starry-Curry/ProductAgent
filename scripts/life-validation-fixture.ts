import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { seed, mutate, type State } from "../src/lib/domain.ts";
import { migrate } from "../src/lib/migrations.ts";
import { migrateLife } from "../src/lib/life/schema.ts";
export function validationFixture(directory: string) {
  const full = path.resolve(directory),
    root = path.resolve(process.cwd(), ".runtime");
  if (!full.startsWith(root + path.sep))
    throw Error("Validation requires an isolated .runtime directory");
  mkdirSync(full, { recursive: true });
  const file = path.join(full, "test.sqlite"),
    db = new DatabaseSync(file);
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY,body TEXT NOT NULL)",
  );
  db.prepare("INSERT OR IGNORE INTO workspace VALUES(1,?)").run(
    JSON.stringify(seed()),
  );
  migrate(db, file);
  migrateLife(db, file);
  const read = () =>
    JSON.parse(
      (db.prepare("SELECT body FROM workspace").get() as { body: string }).body,
    ) as State;
  const write = (s: State) =>
    db.prepare("UPDATE workspace SET body=?").run(JSON.stringify(s));
  const add = (
    name: string,
    category: string,
    brand: string,
    model: string,
    extra: Record<string, unknown> = {},
  ) => {
    const old = read().items.find((i) => i.name === name && i.owner === "lin");
    if (old) return old.id;
    let s = mutate(read(), "lin", "createItem", {
      name,
      category,
      brand,
      model,
      region: extra.region,
    });
    const id = s.items.at(-1)!.id;
    s = mutate(s, "lin", "updateItem", {
      itemId: id,
      availability: "available",
      ...extra,
    });
    write(s);
    return id;
  };
  return { db, read, write, add };
}
