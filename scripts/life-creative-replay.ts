/** Revalidate synthetic recorded outputs only. Never loads credentials or invokes a provider. */
import fs from "node:fs";
import path from "node:path";
import { validationFixture } from "./life-validation-fixture.ts";
import { modelIdea } from "../src/lib/life/ideas.ts";
import { listCreativeEvidence } from "../src/lib/life/creative-evidence.ts";

const source = path.join(
  process.cwd(),
  ".runtime",
  "knowledge-creative-20261020",
);
const ledger = JSON.parse(
  fs.readFileSync(path.join(source, "ledger.json"), "utf8"),
);
const directory = fs.mkdtempSync(
  path.join(process.cwd(), ".runtime", "creative-replay-"),
);
fs.copyFileSync(
  path.join(source, "test.sqlite"),
  path.join(directory, "test.sqlite"),
);
const t = validationFixture(directory);
const provider = {
  ready: true,
  model: "recorded-qwen-plus",
  generate: async () => {
    throw Error("Offline replay must not invoke a model");
  },
};
const results: object[] = [];
try {
  const items = t
    .read()
    .items.filter((i) => ["LIGHT", "CUP", "PAPER"].includes(i.model || ""));
  for (const r of ledger.requests.filter(
    (r: any) => r.number >= 25 && r.output?.content,
  )) {
    const body = JSON.parse(r.output.content);
    for (const packet of body.ideas || [body]) {
      try {
        await modelIdea(
          t.db,
          t.read(),
          "lin",
          "只用登记的手电筒、透明杯和纸笔做活动",
          provider,
          false,
          t.read,
          {
            itemIds: items.map((i) => i.id),
            minutes: 30,
            creativeEvidence: listCreativeEvidence(t.db, "lin"),
            precomputed: {
              model: provider.model,
              tokens: null,
              text: JSON.stringify(packet),
            },
          },
        );
        results.push({
          request: r.number,
          title: packet.title,
          accepted: true,
          caveat: "通过有限规则不等于现实可行，仍需人工评价",
        });
      } catch (e) {
        results.push({
          request: r.number,
          title: packet.title,
          accepted: false,
          reason: (e as Error).message,
        });
      }
    }
  }
} finally {
  t.db.close();
}
const output = { modelCalls: 0, syntheticOnly: true, results };
fs.writeFileSync(
  path.join(source, "offline-replay.json"),
  JSON.stringify(output, null, 2),
);
console.log(JSON.stringify(output, null, 2));
