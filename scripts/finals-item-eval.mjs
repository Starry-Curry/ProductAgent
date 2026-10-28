// Explicitly invoked paid experiment only. Normal npm test/CI never loads secrets or uses this script.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { validationFixture } from "./life-validation-fixture.ts";
import { cases, populate } from "./finals-item-cases.mjs";
import { mutate } from "../src/lib/domain.ts";
import { itemContext } from "../src/lib/context/items.ts";
import { respond } from "../src/lib/agent/service.ts";
import { createProvider, ProviderError } from "../src/lib/ai/provider.ts";

if (!process.argv.includes("--live-max=150-cny=30"))
  throw Error("Explicit task budget flag required");
const arg = (name) =>
  process.argv.find((x) => x.startsWith(name + "="))?.slice(name.length + 1);
const config = path.resolve(arg("--config") || "");
if (path.basename(config) !== ".env.local")
  throw Error("Explicit project .env.local required");
process.loadEnvFile(config); // Only application authentication. Never print, copy or serialize secrets.
const baseline = path.resolve(arg("--baseline") || "");
const baseSha = "ea32c3f4c9e18992ca267b6dd74e26e418c9e95a";
if (
  execFileSync("git", ["diff", baseSha, "--", "src"], {
    cwd: baseline,
    encoding: "utf8",
  }).trim()
)
  throw Error("Baseline product sources differ from audited main");
const baseService = await import(
  pathToFileURL(path.join(baseline, "src/lib/agent/service.ts")).href
);
const baseProvider = await import(
  pathToFileURL(path.join(baseline, "src/lib/ai/provider.ts")).href
);
const out = path.resolve(".runtime/item-v1/live");
fs.mkdirSync(out, { recursive: true });
const lock = fs.openSync(path.join(out, "run.lock"), "wx");
const key = process.env.AI_API_KEY;
const clean = (value) =>
  JSON.parse(
    JSON.stringify(value, (_k, v) =>
      typeof v === "string" && key ? v.split(key).join("[REDACTED]") : v,
    ),
  );
const save = (name, value) => {
  const file = path.join(out, name);
  fs.writeFileSync(file + ".tmp", JSON.stringify(clean(value), null, 2) + "\n");
  fs.renameSync(file + ".tmp", file);
};
const load = (name, fallback) =>
  fs.existsSync(path.join(out, name))
    ? JSON.parse(fs.readFileSync(path.join(out, name), "utf8"))
    : fallback;
const ledger = load("ledger.json", []),
  results = load("results.json", []);
const env = {
  ...process.env,
  AUTH_MODE: "local-demo",
  AI_ALLOW_PAID_CALLS: "true",
  WUJIAN_ALLOW_PAID_CALLS: "true",
  AI_ENABLE_THINKING: "false",
  AI_JSON_MODE: "true",
  AI_REQUEST_TIMEOUT_MS: "45000",
};
for (const [k, v] of Object.entries({
  AUTH_MODE: "local-demo",
  WUJIAN_ALLOW_PUBLIC_FETCH: "false",
  WUJIAN_ALLOW_SEARCH: "false",
  LANGSMITH_TRACING: "false",
  LANGCHAIN_TRACING_V2: "false",
}))
  process.env[k] = v;
if (
  !key?.trim() ||
  env.AI_MODEL !== "qwen-plus" ||
  env.AI_BASE_URL?.replace(/\/$/, "") !==
    "https://dashscope.aliyuncs.com/compatible-mode/v1"
)
  throw Error(
    "Missing existing Beijing qwen-plus configuration; no alternate account/model used",
  );
const estimatedTotal = () => ledger.reduce((sum, r) => sum + r.costCny, 0);
let label = "";
async function meteredFetch(url, init) {
  const endpoint = new URL(url);
  if (
    endpoint.origin !== "https://dashscope.aliyuncs.com" ||
    endpoint.pathname !== "/compatible-mode/v1/chat/completions"
  )
    throw Error("Disallowed experiment endpoint");
  const body = JSON.parse(init.body);
  body.max_tokens = Math.min(1200, body.max_tokens);
  body.temperature = 0.3;
  body.enable_thinking = false;
  const bytes = Buffer.byteLength(JSON.stringify(body));
  if (bytes > 100000)
    throw new ProviderError(
      "experiment_context_limit",
      "Experiment context exceeds conservative pricing tier",
    );
  const reserve = (bytes * 0.8 + body.max_tokens * 2) / 1000000;
  if (ledger.length >= 150 || estimatedTotal() + reserve > 30)
    throw new ProviderError(
      "experiment_budget",
      "Task request or CNY budget exhausted",
    );
  const row = {
    number: ledger.length + 1,
    label,
    at: new Date().toISOString(),
    model: body.model,
    endpoint: endpoint.href,
    maxTokens: body.max_tokens,
    temperature: body.temperature,
    thinking: false,
    requestBytes: bytes,
    tools: body.tools?.map((t) => t.function.name) || [],
    messages: body.messages,
    status: "reserved-before-dispatch",
    costCny: reserve,
    costBasis: "conservative-reservation-without-usage",
  };
  ledger.push(row);
  save("ledger.json", ledger);
  const start = Date.now();
  try {
    const response = await fetch(url, { ...init, body: JSON.stringify(body) });
    const data = await response
      .clone()
      .json()
      .catch(() => null);
    row.http = response.status;
    row.usage = data?.usage || null;
    row.response = data?.choices?.[0] || null;
    row.errorCode = data?.error?.code || null;
    row.status = "returned";
    if (
      Number.isSafeInteger(row.usage?.prompt_tokens) &&
      Number.isSafeInteger(row.usage?.completion_tokens)
    ) {
      row.costCny =
        (row.usage.prompt_tokens * 0.8 + row.usage.completion_tokens * 2) /
        1000000;
      row.costBasis = "published-standard-rate-no-cache-discount-not-invoice";
    }
    return response;
  } catch (e) {
    row.status = "transport-error";
    row.error = { name: e.name, code: e.cause?.code || e.code || null };
    throw e;
  } finally {
    row.elapsedMs = Date.now() - start;
    save("ledger.json", ledger);
  }
}
try {
  const source = validationFixture(path.join(out, "source"));
  let ids, state;
  if (fs.existsSync(path.join(out, "fixture.json")))
    ({ ids, state } = load("fixture.json", null));
  else {
    ids = populate(source);
    state = mutate(source.read(), "lin", "bindProduct", {
      itemId: ids.mouse,
      packId: "logitech-m185-m-r0061",
      confirmed: true,
    });
    save("fixture.json", { ids, state });
  }
  source.db.close();
  const requestedArm = arg("--arm");
  if (
    requestedArm &&
    !["fixed-final", "fixed-targeted", "fixed-guard-recheck"].includes(
      requestedArm,
    )
  )
    throw Error("Unknown experiment arm");
  const finalOnly = !!requestedArm;
  save(requestedArm ? `protocol-${requestedArm}.json` : "protocol.json", {
    at: new Date().toISOString(),
    baseSha,
    baselineSource: baseline,
    model: env.AI_MODEL,
    maxRequests: 150,
    maxCny: 30,
    outputCap: 1200,
    temperature: 0.3,
    thinking: false,
    cases,
    pricing: "https://help.aliyun.com/zh/model-studio/qwen-plus",
    limitations: [
      "Same inventory/goal/model/output cap; product prompts/schema/tool policies intentionally differ",
      "Direct gets the complete normalized item facts; Agent has the same database, must retrieve authorized context",
      "One sample per arm/case, no model quality judge and no physical verification",
      "A refusal or unavailable outcome is recorded, never counted automatically as successful usefulness",
      "Failures without usage retain conservative byte-based input plus maximum-output reservation; estimates are not invoices",
      ...(finalOnly
        ? [
            "Final arm retest after inspecting phase-one failures; not an independent held-out quality benchmark",
          ]
        : []),
    ],
  });
  for (let index = 0; index < cases.length; index++) {
    const c = cases[index];
    if (arg("--cases") && !arg("--cases").split(",").includes(c.id)) continue;
    const arms = requestedArm
      ? [requestedArm]
      : ["direct", "baseline", "fixed"];
    for (const arm of [
      ...arms.slice(index % arms.length),
      ...arms.slice(0, index % arms.length),
    ]) {
      label = c.id + ":" + arm;
      if (results.some((r) => r.label === label)) continue;
      if (ledger.length >= 150 || estimatedTotal() >= 30) {
        save("blocked.json", {
          reason: "budget",
          requests: ledger.length,
          costCny: estimatedTotal(),
        });
        break;
      }
      const directory = fs.mkdtempSync(path.join(out, "case-"));
      const t = validationFixture(directory);
      t.write(structuredClone(state));
      process.env.PRODUCT_AGENT_DATA_DIR = directory;
      const begin = ledger.length,
        start = Date.now();
      let result;
      try {
        const provider = (
          arm === "baseline" ? baseProvider.createProvider : createProvider
        )(env, meteredFetch);
        provider.search = undefined;
        if (arm === "direct")
          result = await provider.generate(
            "你是物间的生活物品助手。只依据给出的用户登记和官方事实，帮助理解、利用或组合已有物品；未知性质不得编造为事实，遵守用户否定限制，解释必要前提。直接给有用的中文回答，简洁说明原理、未知和下一步。",
            {
              question: c.question,
              selectedItemId: c.item ? ids[c.item] : null,
              items: state.items.map(itemContext),
            },
            { maxTokens: 1200, timeoutMs: 45000 },
          );
        else
          result = await (arm === "baseline" ? baseService.respond : respond)(
            t.db,
            t.read,
            "lin",
            {
              requestId: crypto.randomUUID(),
              mode: "auto",
              memoryPolicy: "off",
              ...(c.item ? { itemId: ids[c.item] } : {}),
              question: c.question,
              uiContext: { page: "assistant" },
            },
            provider,
          );
      } catch (e) {
        result = {
          error: { name: e.name, code: e.code || null, message: e.message },
        };
      } finally {
        t.db.close();
      }
      const record = {
        label,
        case: c,
        arm,
        elapsedMs: Date.now() - start,
        requestNumbers: ledger.slice(begin).map((r) => r.number),
        costCny: ledger.slice(begin).reduce((s, r) => s + r.costCny, 0),
        result,
      };
      results.push(record);
      save("results.json", results);
      console.log(
        JSON.stringify({
          label,
          requests: record.requestNumbers.length,
          totalRequests: ledger.length,
          costCny: Number(estimatedTotal().toFixed(6)),
          outcome:
            result.reply?.outcome ||
            result.error?.code ||
            result.error?.name ||
            "provider-returned",
          source: result.reply?.dataSource || result.reply?.source,
        }),
      );
    }
  }
  save("summary.json", {
    at: new Date().toISOString(),
    requests: ledger.length,
    costCny: estimatedTotal(),
    records: results.length,
    http200: ledger.filter((r) => r.http === 200).length,
    transportErrors: ledger.filter((r) => r.status === "transport-error")
      .length,
    usage: ledger.reduce(
      (a, r) => ({
        input: a.input + (r.usage?.prompt_tokens || 0),
        output: a.output + (r.usage?.completion_tokens || 0),
      }),
      { input: 0, output: 0 },
    ),
    physicalTests: 0,
    modelJudges: 0,
  });
} finally {
  fs.closeSync(lock);
  fs.unlinkSync(path.join(out, "run.lock"));
}
