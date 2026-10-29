import { recognizeProduct } from "../../src/lib/life/product-arrival.ts";
import { mkdirSync, writeFileSync } from "node:fs";
const rows = [];
for (const query of ["SAMLA", "KNAGGLIG", "GO 4"]) {
  const started = performance.now();
  const result = await recognizeProduct({ query, refresh: true });
  rows.push({
    query,
    elapsedMs: Math.round(performance.now() - started),
    result,
  });
  console.log(
    JSON.stringify({ query, status: result.products[0]?.retrieval.status }),
  );
}
mkdirSync("artifacts/personal-objects", { recursive: true });
writeFileSync(
  "artifacts/personal-objects/official-sources.json",
  JSON.stringify(
    { at: new Date().toISOString(), paidModelCalls: 0, rows },
    null,
    2,
  ),
);
