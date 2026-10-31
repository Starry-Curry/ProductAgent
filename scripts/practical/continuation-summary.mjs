import fs from "node:fs";
import { createHash } from "node:crypto";
const dir = "docs/engineering/practical-continuation-2026-11-01/evidence",
  file = dir + "/usage-summary.json";
if (fs.existsSync(file)) throw Error("preserve_existing_summary");
const initial = JSON.parse(fs.readFileSync(dir + "/start.json")),
  ledger = JSON.parse(
    fs.readFileSync(
      "docs/engineering/practical-agent-2026-10-31/evidence/model-calls.json",
    ),
  ),
  newAttempts = ledger.attempts.slice(initial.previousRequests);
const cost = (a) => a.estimatedCny ?? a.reservedCny;
const quantile = (a, p) =>
  a.slice().sort((a, b) => a - b)[Math.max(0, Math.ceil(a.length * p) - 1)] ??
  null;
const timings = ["cross-loop-v2", "cross-plan-v4"].flatMap((name) =>
  JSON.parse(fs.readFileSync(dir + "/" + name + ".json")).responses.map(
    (r) => ({
      sample: name,
      ms: r.fullAnswerMs,
      requests: r.result.modelCalls,
      quality: "not_fully_acceptable_see_quality_review",
    }),
  ),
);
const summary = {
  roundId: ledger.task,
  authorized: { requests: 60, cny: 15 },
  previousRequests: initial.previousRequests,
  requests: newAttempts.length,
  roundRequests: ledger.attempts.length,
  remainingRequests: 60 - ledger.attempts.length,
  previousAttemptsUnchanged:
    createHash("sha256")
      .update(
        JSON.stringify(ledger.attempts.slice(0, initial.previousRequests)),
      )
      .digest("hex") === initial.previousAttemptsHash,
  returned: newAttempts.filter((a) => a.status === "returned").length,
  failed: newAttempts.filter((a) => a.status === "failed").length,
  estimatedAdditionalCny: newAttempts.reduce((s, a) => s + cost(a), 0),
  estimatedRoundCny: ledger.attempts.reduce((s, a) => s + cost(a), 0),
  unknownFailedCharges: newAttempts
    .filter((a) => a.status !== "returned")
    .map((a) => ({
      number: a.number,
      reservedCny: a.reservedCny,
      error: a.error,
    })),
  inputTokens: newAttempts.reduce(
    (s, a) => s + (a.tokens?.prompt_tokens || 0),
    0,
  ),
  outputTokens: newAttempts.reduce(
    (s, a) => s + (a.tokens?.completion_tokens || 0),
    0,
  ),
  upstreamReturnedLatencyMs: {
    p50: quantile(
      newAttempts
        .filter((a) => a.status === "returned")
        .map((a) => a.elapsedMs),
      0.5,
    ),
    p95: quantile(
      newAttempts
        .filter((a) => a.status === "returned")
        .map((a) => a.elapsedMs),
      0.95,
    ),
  },
  completeTextDisplayed: timings,
  completeTextLatencyMs: {
    p50: quantile(
      timings.map((t) => t.ms),
      0.5,
    ),
    p95: quantile(
      timings.map((t) => t.ms),
      0.95,
    ),
    notice: "仅完整文字显示时间，不是可靠任务完成耗时；全部仍有语义问题。",
  },
  model: "qwen3.8-max-0902",
  physicalTests: 0,
  newProtocolLiveRetest: "blocked_request_cap",
  newPaidCallsAllowed: false,
};
if (
  !summary.previousAttemptsUnchanged ||
  summary.roundRequests > 60 ||
  summary.estimatedRoundCny > 15
)
  throw Error("historical_budget_integrity_failed");
fs.writeFileSync(file, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary));
