import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validationFixture } from "../life-validation-fixture.ts";
import { apartmentProducts } from "../../src/lib/catalog/virtual-apartment.ts";
import {
  installVirtualHome,
  refreshHomeKnowledge,
  homeKnowledgeStatus,
} from "../../src/lib/life/virtual-home.ts";
mkdirSync(".runtime", { recursive: true });
const t = validationFixture(path.resolve(".runtime/home-network-v2"));
try {
  installVirtualHome(t.db, t.read, "lin", false);
  const receipts = [];
  for (const p of apartmentProducts.filter(
    (p) =>
      !process.argv.some((a) => a.startsWith("--keys=")) ||
      process.argv
        .find((a) => a.startsWith("--keys="))!
        .slice(7)
        .split(",")
        .includes(p.key),
  )) {
    const start = performance.now();
    const r = await refreshHomeKnowledge(t.db, t.read, "lin", p.key);
    receipts.push({ ...r, elapsedMs: Math.round(performance.now() - start) });
    console.log(
      JSON.stringify({ key: p.key, status: r.status, attempts: r.attempts }),
    );
  }
  mkdirSync("artifacts/unified-home", { recursive: true });
  writeFileSync(
    "artifacts/unified-home/network.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        receipts,
        knowledge: homeKnowledgeStatus(t.db, t.read(), "lin"),
      },
      null,
      2,
    ),
  );
} finally {
  t.db.close();
}
