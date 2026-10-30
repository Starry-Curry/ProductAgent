import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { gateway } from "./gateway.mjs";
import { cases } from "./cases.ts";
import { validationFixture } from "../life-validation-fixture.ts";
import { mutate } from "../../src/lib/domain.ts";
import { productPacks } from "../../src/lib/products.ts";
import { createProvider } from "../../src/lib/ai/provider.ts";
import { evidenceInventory } from "../../src/lib/life/affordances.ts";
import { exploreOpen } from "../../src/lib/life/open-exploration.ts";
import {
  generateMechanisms,
  renderActions,
} from "../../src/lib/life/creative-engine-v2.ts";
import { itemContext } from "../../src/lib/context/items.ts";
if (!process.argv.includes("--cloud"))
  throw Error("explicit_cloud_flag_required");
const base = "a2a9a23d5d05bc187300c57aaa01b400772d727e";
const out = "artifacts/creativity-v2",
  file = out + "/open-comparison.json";
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(".runtime", { recursive: true });
// Reconstruct ONLY the old creative entry module, preserving its validation.
// Other shared data/auth modules are unchanged except added optional fact data.
let oldCode = execFileSync("git", ["show", base + ":src/lib/life/ideas.ts"], {
  encoding: "utf8",
});
oldCode = oldCode
  .replaceAll('"../', '"../src/lib/')
  .replaceAll('"./', '"../src/lib/life/');
fs.writeFileSync(".runtime/creative-old-ideas.ts", oldCode);
const old = await import(
  pathToFileURL(path.resolve(".runtime/creative-old-ideas.ts")).href
);
const gate = await gateway(
  process.argv.find((a) => a.startsWith("--config="))?.slice(9),
);
const model =
  process.argv.find((a) => a.startsWith("--model="))?.slice(8) || gate.model;
const provider = createProvider(
  {
    AI_ALLOW_PAID_CALLS: "true",
    AI_BASE_URL: "https://fixture.invalid/v1",
    AI_API_KEY: "fixture-only",
    AI_MODEL: model,
    AI_CREATIVE_MODEL: model,
    AI_JSON_MODE: "true",
    AI_ENABLE_THINKING: "false",
    AI_TIMEOUT_MS: "60000",
  },
  (url, init) => fetch(gate.url + "/v1/" + String(url).split("/v1/")[1], init),
);
const data = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8"))
  : {
      base,
      model,
      method:
        "24 synthetic tasks; same facts/preferences; A free prose / B retrieved-principle prose / C hybrid prose. No required idea count, JSON or first-stage physical proof. Temperature .85, 4000-token transport budget all arms. No self-scoring. Superseded experimental outputs remain in comparison.json and count in same ledger.",
      records: [],
    };
const from = Number(
  process.argv.find((a) => a.startsWith("--from="))?.slice(7) || 1,
);
const to = Number(
  process.argv.find((a) => a.startsWith("--to="))?.slice(5) || 24,
);
const arms = process.argv
  .find((a) => a.startsWith("--arms="))
  ?.slice(7)
  .split(",") || ["free", "retrieval", "hybrid"];
const save = () => fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
async function runCase(test: (typeof cases)[number]) {
  const fixture = validationFixture(".runtime/creativity-cases/" + test.id);
  const ids = test.items.map((o, index) => {
    const pack = productPacks.find((p) => p.id === o.pack);
    const id = fixture.add(
      test.id + " " + o.name,
      "生活物品",
      o.brand || "",
      o.model || "",
      {
        attributes: {
          material: o.material,
          dimensions: o.dimensions,
          quantity: 1,
          physicalFacts: Object.entries(o.facts || {}).map(([key, value]) => ({
            id: crypto.randomUUID(),
            key,
            value,
            component: "本体",
            basis: "user_report",
          })),
        },
        ...(pack
          ? {
              productBinding: {
                packId: pack.id,
                version: pack.version,
                confirmedBy: "lin",
                confirmedAt: new Date().toISOString(),
                model: pack.model,
              },
            }
          : {}),
      },
    );
    return id;
  });
  const state = fixture.read(),
    items = state.items.filter((i) => ids.includes(i.id)),
    inventory = evidenceInventory(items);
  const preferences = [
    { id: "synthetic-preference-" + test.id, text: test.preference },
  ];
  const common = {
    goal: test.goal,
    inventory,
    preferences,
    physicalFacts: items.map(itemContext),
    synthetic: true,
  };
  for (const arm of arms) {
    if (data.records.some((r: any) => r.caseId === test.id && r.arm === arm))
      continue;
    const record: any = {
      caseId: test.id,
      arm,
      model,
      input: common,
      reviewTarget: test.review,
      startedAt: new Date().toISOString(),
    };
    data.records.push(record);
    save();
    let calls = 0;
    const counted = {
      ...provider,
      generate: async (...args: Parameters<typeof provider.generate>) => {
        calls++;
        return provider.generate(...args);
      },
    };
    try {
      if (arm === "direct") {
        record.result = await counted.generate(
          "帮助用户用已有物品创造真正有用的新用途。基于提供的资料，遵守限制，任选资源子集。解释作用原理、关键操作、未知条件，不虚构属性或额外物品。提出最多一个最好的方案，也可以明确缺少条件。所有持有与私人资料是合成测试设定，不代表真实用户。",
          common,
          {
            temperature: 0.75,
            json: false,
            maxTokens: 2200,
            purpose: "creative",
            timeoutMs: 60000,
          },
        );
      } else if (arm === "old") {
        record.result = await old.modelIdea(
          fixture.db,
          { ...state, items },
          "lin",
          test.goal + "。已确认本轮偏好：" + test.preference,
          counted,
          false,
          () => ({
            ...fixture.read(),
            items: fixture.read().items.filter((i) => ids.includes(i.id)),
          }),
          {
            strategy: "explore",
            candidates: 1,
            minutes: 20,
            validateOnly: true,
            itemIds: ids,
            planning: common,
          },
        );
      } else if (["free", "retrieval", "hybrid"].includes(arm)) {
        record.result = await exploreOpen(
          counted,
          items,
          test.goal,
          {
            strategy: arm as "free" | "retrieval" | "hybrid",
            preferences,
            feedback: [],
            context: { synthetic: true },
          },
          () => {},
        );
      } else {
        const g = await generateMechanisms(
          counted,
          items,
          test.goal,
          {
            strategy: arm as "goal" | "analogy",
            preferences,
            feedback: [],
            candidates: 1,
            context: { synthetic: true },
          },
          () => {},
        );
        record.result = {
          raw: g.result.text,
          question: g.question,
          candidates: g.candidates.map((c) => ({
            ...c,
            renderedActions: renderActions(
              c.proposal,
              c.assessment,
              g.inventory,
            ),
          })),
        };
      }
      record.status = "returned";
    } catch (e) {
      record.status = "failed";
      record.error = { name: (e as Error).name, message: (e as Error).message };
    }
    record.calls = calls;
    record.elapsedMs = Date.now() - Date.parse(record.startedAt);
    save();
    console.log(test.id, arm, record.status, calls, record.elapsedMs);
  }
  fixture.db.close();
}
try {
  const pending = cases.filter((c) => +c.id >= from && +c.id <= to);
  await Promise.all(
    [0, 1].map(async () => {
      while (pending.length) {
        const test = pending.shift();
        if (test) await runCase(test);
      }
    }),
  );
} finally {
  save();
  await gate.close();
}
