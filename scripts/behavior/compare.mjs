import path from "node:path";
import { gateway } from "./gateway.mjs";
import { root, saveReport } from "./shared.mjs";
import { behaviorFixture } from "./fixtures.ts";
import { createProvider } from "../../src/lib/ai/provider.ts";
import { planDiscovery } from "../../src/lib/life/planning.ts";
import { respond } from "../../src/lib/agent/service.ts";
import { creativeFacts } from "../../src/lib/life/creative-reasoning.ts";
import { sharedItemKnowledge } from "../../src/lib/context/knowledge.ts";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
const baseline = process.env.ALPHA_BASELINE_DIR || path.resolve("../alpha-app");
const baselineSha = execFileSync(
  "git",
  ["-c", "safe.directory=" + baseline, "-C", baseline, "rev-parse", "HEAD"],
  { encoding: "utf8", windowsHide: true },
).trim();
if (baselineSha !== "7c513170a28d5dd76fe7845e0debdc163c53ea19")
  throw Error("Alpha baseline commit mismatch");
const { planDiscovery: alphaPlan } = await import(
  pathToFileURL(path.join(baseline, "src/lib/life/planning.ts")).href
);
const { respond: alphaRespond } = await import(
  pathToFileURL(path.join(baseline, "src/lib/agent/service.ts")).href
);
if (!process.argv.includes("--live-max=60-cny=10"))
  throw Error("Task budget flag required");
const stage =
  process.argv.find((a) => a.startsWith("--stage="))?.slice(8) || "pilot";
const gate = await gateway({
  live: true,
  configPath: process.argv.find((a) => a.startsWith("--config="))?.slice(9),
});
const t = behaviorFixture(),
  rows = [];
const provider = (arm, model = "qwen-plus") =>
  createProvider(
    {
      AI_BASE_URL: "https://fixture.invalid/v1",
      AI_API_KEY: "fixture-only",
      AI_MODEL: model,
      AI_ALLOW_PAID_CALLS: "true",
      AI_JSON_MODE: "true",
    },
    (_u, init) => fetch(gate.url + "/" + arm + "/v1/chat/completions", init),
  );
async function run(c, arm, model = "qwen-plus") {
  const start = performance.now(),
    before = gate.ledger.attempts.length;
  try {
    const items = t.read().items.filter((i) => c.itemIds.includes(i.id));
    let result;
    if (arm.startsWith("direct"))
      result = await provider(arm, model).generate(
        "以用户目标为中心，完整回答。仅用所给事实和已授权偏好，未知要说未知。创意需有实际用途、原理及实施步骤，遵守限制，不暗用额外物品；资源池可以只选一部分。输出JSON {answer:string}，创意也可在answer中自然表达，不受其他格式限制。",
        {
          question: c.goal,
          creativeFacts: creativeFacts(items),
          itemKnowledge: sharedItemKnowledge(t.read(), "lin", c.itemIds).items,
          authorizedPreferences: [{ id: t.pref.id, text: t.pref.text }],
        },
        { maxTokens: 1500, json: true, temperature: 0.2 },
      );
    else if (c.kind === "creative")
      result = await (arm === "alpha" ? alphaPlan : planDiscovery)(
        t.db,
        t.read(),
        "lin",
        {
          goal: c.goal,
          itemIds: c.itemIds,
          includeSynthetic: true,
          model: true,
          review: false,
          publicEvidence: false,
          candidates: 1,
          minutes: 30,
        },
        provider(arm, model),
        t.read,
      );
    else
      result = await (arm === "alpha" ? alphaRespond : respond)(
        t.db,
        t.read,
        "lin",
        {
          question: c.goal,
          mode: "auto",
          itemId: c.itemIds[0],
          requestId: crypto.randomUUID(),
          memoryPolicy: "off",
          uiContext: { page: "assistant" },
        },
        provider(arm, model),
      );
    rows.push({
      case: c.id,
      arm,
      model,
      result,
      requests: gate.ledger.attempts.length - before,
      elapsedMs: Math.round(performance.now() - start),
    });
    console.log(
      c.id +
        " " +
        arm +
        " " +
        model +
        " returned " +
        (gate.ledger.attempts.length - before) +
        " " +
        Math.round(performance.now() - start) +
        "ms",
    );
  } catch (e) {
    rows.push({
      case: c.id,
      arm,
      model,
      error: e.message,
      requests: gate.ledger.attempts.length - before,
      elapsedMs: Math.round(performance.now() - start),
    });
    console.log(c.id + " " + arm + " FAILED " + e.message);
  }
  saveReport(path.join(root, "comparison-" + stage + ".json"), {
    base: "7c513170a28d5dd76fe7845e0debdc163c53ea19",
    cases: t.cases.map((c) => ({
      ...c,
      facts: creativeFacts(
        t.read().items.filter((i) => c.itemIds.includes(i.id)),
      ),
    })),
    rows,
    physicalTests: 0,
    humanBlindEvaluation: false,
  });
}
try {
  if (stage === "pilot")
    for (const c of t.cases.filter((c) => ["01", "04", "11"].includes(c.id)))
      for (const arm of ["direct", "alpha", "new"]) await run(c, arm);
  else if (stage === "remaining")
    for (const c of t.cases.filter((c) => !["01", "04", "11"].includes(c.id))) {
      for (const arm of ["direct", "alpha", "new"]) {
        if (gate.ledger.attempts.length > 54)
          throw Error("Reserve requests for browser acceptance");
        await run(c, arm);
      }
    }
  else if (stage === "bound-qa")
    for (const c of t.cases.filter((c) => c.id === "02"))
      for (const arm of ["direct", "alpha", "new"]) await run(c, arm);
  else if (stage === "strong")
    for (const c of t.cases.filter((c) => ["04", "11"].includes(c.id)))
      await run(c, "new-strong", "qwen3-max");
} finally {
  t.db.close();
  await gate.close();
}
