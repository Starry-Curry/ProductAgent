// Small, same-information ablations. Uses the SAME persistent 150/CNY50 ledger.
import fs from "node:fs";
import { gateway } from "./gateway.mjs";
import { createProvider } from "../../src/lib/ai/provider.ts";
const source = JSON.parse(
  fs.readFileSync("artifacts/creativity-v2/open-comparison.json", "utf8"),
);
const config = process.argv.find((a) => a.startsWith("--config="))?.slice(9);
if (!process.argv.includes("--cloud"))
  throw Error("explicit_cloud_flag_required");
const gate = await gateway(config),
  file = "artifacts/creativity-v2/model-variants.json";
const records = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8")).records
  : [];
const save = () =>
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        method:
          "Same question, item facts, preference. Minimal prose vs thinking, model and lightweight JSON. No self-scoring; only final answers retained, not reasoning traces.",
        records,
      },
      null,
      2,
    ) + "\n",
  );
const unavailable = new Set<string>();
async function runCase(caseId: string) {
  const common = source.records.find(
    (r: any) => r.caseId === caseId && r.arm === "free",
  )?.input;
  if (!common) throw Error("missing_pair");
  for (const variant of [
    { id: "plus-minimal", model: gate.model, thinking: false, json: false },
    { id: "plus-thinking", model: gate.model, thinking: true, json: false },
    { id: "plus-json", model: gate.model, thinking: false, json: true },
    ...(gate.available.includes("qwen3.7-plus")
      ? [
          {
            id: "3.7-minimal",
            model: "qwen3.7-plus",
            thinking: false,
            json: false,
          },
          {
            id: "3.7-thinking",
            model: "qwen3.7-plus",
            thinking: true,
            json: false,
          },
        ]
      : []),
  ]) {
    if (
      unavailable.has(variant.model) ||
      unavailable.has(variant.model + ":" + variant.id) ||
      records.some((r: any) => r.caseId === caseId && r.variant === variant.id)
    )
      continue;
    const record: any = {
      caseId,
      variant: variant.id,
      model: variant.model,
      thinking: variant.thinking,
      input: common,
      startedAt: new Date().toISOString(),
    };
    records.push(record);
    save();
    const p = createProvider(
      {
        AI_ALLOW_PAID_CALLS: "true",
        AI_BASE_URL: "https://fixture.invalid/v1",
        AI_API_KEY: "fixture-only",
        AI_MODEL: variant.model,
        AI_JSON_MODE: "false",
        AI_TIMEOUT_MS: "90000",
        AI_REQUEST_TIMEOUT_MS: "90000",
      },
      (url, init) => {
        const body = JSON.parse(String(init?.body));
        body.enable_thinking = variant.thinking;
        return fetch(gate.url + "/v1/" + String(url).split("/v1/")[1], {
          ...init,
          body: JSON.stringify(body),
        });
      },
    );
    try {
      record.result = await p.generate(
        "请探索这些已有物品可以产生的不同新用途。结合用户偏好，自然具体地说明做什么、借用了什么特性、有什么价值。遵守用户限制，未知属性只作为假设，不编造。" +
          (variant.json
            ? "输出JSON {ideas:[{title,idea}]}。"
            : "自由表达，不要求固定数量或格式。"),
        {
          goal: common.goal,
          items: common.physicalFacts,
          preferences: common.preferences,
        },
        {
          temperature: 0.85,
          json: variant.json,
          maxTokens: 4000,
          timeoutMs: 90000,
        },
      );
      record.status = "returned";
    } catch (e) {
      record.status = "failed";
      record.error = (e as Error).message;
      if (
        (e as any).upstreamStatus === 404 ||
        (e as any).upstreamStatus === 403
      )
        unavailable.add(variant.model);
      if ((e as any).upstreamStatus === 400)
        unavailable.add(variant.model + ":" + variant.id);
    }
    record.elapsedMs = Date.now() - Date.parse(record.startedAt);
    save();
    console.log(caseId, variant.id, record.status, record.elapsedMs);
  }
}
try {
  const pending = ["09", "12", "16", "23"];
  await Promise.all(
    [0, 1].map(async () => {
      while (pending.length) {
        const id = pending.shift();
        if (id) await runCase(id);
      }
    }),
  );
} finally {
  save();
  await gate.close();
}
