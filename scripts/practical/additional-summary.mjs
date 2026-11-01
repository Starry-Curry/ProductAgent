import fs from "node:fs";
import { createHash } from "node:crypto";
import { ADDITIONAL_ROOT as root } from "./gateway.mjs";
const file = root + "/usage-summary.json";
if (fs.existsSync(file)) throw Error("preserve_existing_summary");
const auth = JSON.parse(fs.readFileSync(root + "/authorization.json")),
  ledger = JSON.parse(fs.readFileSync(root + "/model-calls.json")),
  old = fs.readFileSync(
    "docs/engineering/practical-agent-2026-10-31/evidence/model-calls.json",
  );
const sum = (f) => ledger.attempts.reduce((n, a) => n + f(a), 0),
  percentile = (rows, p) =>
    rows.slice().sort((a, b) => a - b)[
      Math.max(0, Math.ceil(rows.length * p) - 1)
    ] ?? null;
const groups = [
  "unknown-r10-v1",
  "cross-extra-v1",
  "cross-natural-v2",
  "r10-experience-v1",
  "r50-operation-v1",
];
const tasks = groups.flatMap((name) =>
  JSON.parse(fs.readFileSync(root + "/" + name + ".json")).responses.map(
    (r, n) => ({
      sample: name,
      turn: n + 1,
      requests: r.result.modelCalls,
      serverCompletionMs: JSON.parse(
        r.result.trace.find((t) => t.stage === "practical_completion")
          ?.detail || "{}",
      ).elapsedMs,
      fullVisibleMs: r.fullAnswerMs ?? null,
      outcome: r.result.reply.outcome,
      quality: "see_engineering_case_review_not_an_automatic_pass",
    }),
  ),
);
const summary = {
  roundId: ledger.task,
  limits: { requests: 20, cny: 10 },
  requests: ledger.attempts.length,
  remainingRequests: 20 - ledger.attempts.length,
  estimatedCny: sum((a) => a.estimatedCny ?? a.reservedCny),
  successfulHTTP: ledger.attempts.filter((a) => a.status === "returned").length,
  providerFailures: ledger.attempts.filter((a) => a.status !== "returned")
    .length,
  searchRequests: ledger.attempts.filter((a) => a.kind === "official_search")
    .length,
  searchesWithUsableSources: ledger.attempts.filter(
    (a) =>
      a.kind === "official_search" && a.searchSources?.search_results?.length,
  ).length,
  inputTokens: sum((a) => a.tokens?.prompt_tokens || 0),
  outputTokens: sum((a) => a.tokens?.completion_tokens || 0),
  costNotice:
    "估算，不是账单；搜索Qwen-Plus也沿用较高的12/36费率作为保守上界，加每次0.003搜索费。",
  models: [...new Set(ledger.attempts.map((a) => a.model))],
  tasks,
  latency: {
    serverCompletionP50: percentile(
      tasks.map((t) => t.serverCompletionMs),
      0.5,
    ),
    serverCompletionP95: percentile(
      tasks.map((t) => t.serverCompletionMs),
      0.95,
    ),
    notice: "完整文字生成耗时，不代表方案正确或物理任务已完成。",
  },
  oldRoundRequests: JSON.parse(old).attempts.length,
  oldRoundFileUnchanged:
    createHash("sha256").update(old).digest("hex") ===
    auth.previousRound.sha256,
  physicalTests: 0,
};
if (
  !summary.oldRoundFileUnchanged ||
  summary.requests > 20 ||
  summary.estimatedCny > 10
)
  throw Error("history_or_budget_violation");
fs.writeFileSync(file, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary));
