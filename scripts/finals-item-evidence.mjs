// Publish normal synthetic evidence, preserve failures, never copy databases or runtime caches.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
const runtime = path.resolve(".runtime/item-v1"),
  out = path.resolve("docs/finals/item-understanding-v1/evidence");
fs.mkdirSync(out, { recursive: true });
const logManifest = [];
function copy(source, relative) {
  const dest = path.join(out, relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (relative.startsWith("logs/") && relative.endsWith(".txt")) {
    const raw = fs.readFileSync(source);
    const body = raw
      .toString("utf8")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n*$/, "");
    const normalized = body ? body + "\n" : "";
    fs.writeFileSync(dest, normalized);
    logManifest.push({
      path: relative,
      originalSha256: crypto.createHash("sha256").update(raw).digest("hex"),
      publishedSha256: crypto
        .createHash("sha256")
        .update(normalized)
        .digest("hex"),
      normalization:
        "LF, trim trailing spaces and final blank lines; no substantive lines removed",
    });
  } else fs.copyFileSync(source, dest);
}
for (const file of fs.readdirSync(path.join(runtime, "live")))
  if (file.endsWith(".json"))
    copy(path.join(runtime, "live", file), "live/" + file);
for (const file of fs.readdirSync(runtime))
  if (file.endsWith(".log"))
    copy(
      path.join(runtime, file),
      "logs/development-" + file.replace(/\.log$/, ".txt"),
    );
const checks = path.join(runtime, "final-checks");
for (const file of fs.readdirSync(checks))
  if (file.endsWith(".log"))
    copy(
      path.join(checks, file),
      "logs/final-" + file.replace(/\.log$/, ".txt"),
    );
copy(path.join(checks, "commands.json"), "commands.json");
copy(path.join(runtime, "pi/result.json"), "pi-result.json");
for (const [source, relative] of [
  ["artifacts/cloud/validation.json", "cloud-validation.json"],
  ["artifacts/foundation-benchmark.json", "foundation-benchmark.json"],
  ["artifacts/benchmark.json", "legacy-benchmark.json"],
  ["artifacts/cloud/stories-desktop.png", "screenshots/cloud-stories.png"],
  ["artifacts/desktop.png", "screenshots/desktop.png"],
  ["artifacts/mobile-discover.png", "screenshots/mobile-discover.png"],
  ["artifacts/home-companions-desktop.png", "screenshots/home-desktop.png"],
  ["artifacts/care/desktop.png", "screenshots/care-desktop.png"],
])
  if (fs.existsSync(source)) copy(source, relative);
const ledger = JSON.parse(fs.readFileSync(path.join(out, "live/ledger.json"))),
  results = JSON.parse(fs.readFileSync(path.join(out, "live/results.json")));
const answer = (row) =>
  [
    row.result.reply?.answer || row.result.text || "",
    ...(row.result.reply?.steps || []).map((s) => s.text),
    row.result.reply?.caveat || "",
  ]
    .filter(Boolean)
    .join("\n");
const groups = {};
for (const arm of [...new Set(results.map((r) => r.arm))]) {
  const rows = results.filter((r) => r.arm === arm);
  groups[arm] = {
    cases: rows.length,
    requests: rows.reduce((s, r) => s + r.requestNumbers.length, 0),
    http200: ledger.filter((r) => r.label.endsWith(":" + arm) && r.http === 200)
      .length,
    costCny: rows.reduce((s, r) => s + r.costCny, 0),
    outcomes: {},
    sources: {},
    zeroRequestCases: rows
      .filter((r) => !r.requestNumbers.length)
      .map((r) => r.case.id),
    errorCases: rows
      .filter((r) => r.result.error)
      .map((r) => ({ id: r.case.id, error: r.result.error })),
    toolResultReadAndAnswered: [],
  };
  for (const row of rows) {
    const outcome = row.result.error
      ? "error"
      : row.result.reply?.outcome || "direct-provider-text";
    groups[arm].outcomes[outcome] = (groups[arm].outcomes[outcome] || 0) + 1;
    const source = row.result.error
      ? "error-no-answer"
      : row.result.reply?.source || "direct-model";
    groups[arm].sources[source] = (groups[arm].sources[source] || 0) + 1;
    if (
      row.result.reply?.outcome === "answered" &&
      ledger.some(
        (r) =>
          r.label === row.label &&
          r.messages.some((m) => m.role === "tool") &&
          r.response?.finish_reason === "stop",
      )
    )
      groups[arm].toolResultReadAndAnswered.push(row.case.id);
  }
}
const latest = Array.from(new Set(results.map((r) => r.case.id))).map((id) =>
  results.findLast((r) => r.case.id === id && r.arm.startsWith("fixed")),
);
const latestSignals = latest.map((r) => ({
  id: r.case.id,
  arm: r.arm,
  outcome: r.result.error ? "error" : r.result.reply?.outcome,
  source: r.result.reply?.source,
  requests: r.requestNumbers.length,
  errorCode: r.result.error?.code || r.result.reply?.errorCode || null,
  answeredTextContainsDeclaredModel:
    r.case.id === "F01"
      ? /Logitech/.test(answer(r)) && /M-R0061/.test(answer(r))
      : null,
}));
const summary = {
  at: new Date().toISOString(),
  baseline: "ea32c3f4c9e18992ca267b6dd74e26e418c9e95a",
  audit: "bc03b76f53af8d6bf336e3f969c13014cea5c616",
  model: "qwen-plus",
  requests: ledger.length,
  http200: ledger.filter((r) => r.http === 200).length,
  transportErrors: ledger.filter((r) => r.status === "transport-error").length,
  missingUsage: ledger.filter((r) => !r.usage).length,
  finishReasons: Object.fromEntries(
    [...new Set(ledger.map((r) => r.response?.finish_reason || "none"))].map(
      (k) => [
        k,
        ledger.filter((r) => (r.response?.finish_reason || "none") === k)
          .length,
      ],
    ),
  ),
  estimatedCny: ledger.reduce((s, r) => s + r.costCny, 0),
  inputTokens: ledger.reduce((s, r) => s + (r.usage?.prompt_tokens || 0), 0),
  outputTokens: ledger.reduce(
    (s, r) => s + (r.usage?.completion_tokens || 0),
    0,
  ),
  modelScorers: 0,
  physicalVerification: 0,
  groups,
  latestSignals,
  limitations: [
    "Counts are transport/path diagnostics, not creativity or safety scores",
    "Full 24-case fixed retest followed by 10-case and 2-case targeted iterations; do not call all latest rows an independent full final-version benchmark",
    "Latest signals combine dated rounds; raw rows preserve each arm and failure",
    "F08 frozen live fixture used unsupported historical availability string 'unavailable'; unusable false handling is tested, not a valid new intake value; unit regression uses canonical 'broken' and future fixture generator corrected",
    "Case tuning was informed by observed failures, not a held-out evaluation",
    "Same 1200-token per-request cap disadvantages baseline three-candidate output; candidate policy is itself part of the product change",
    "Original console progress for code-less errors could say provider-returned; statistics here use result.error and do not count these as success",
    "Billing uses official standard rates, ignores cache discounts; not account invoice",
  ],
};
fs.writeFileSync(
  path.join(out, "analysis.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
const examples = ["F01", "F02", "F03", "F04", "C01", "C04", "C06", "T02", "T01"]
  .map((id) => {
    const rows = results.filter((r) => r.case.id === id);
    return (
      "## " +
      id +
      "\n\n输入：" +
      rows[0].case.question +
      "\n\n" +
      rows
        .map(
          (r) =>
            "### " +
            r.arm +
            "\n\n来源：" +
            (r.result.reply?.source || "direct/error") +
            "；状态：" +
            (r.result.error
              ? "error"
              : r.result.reply?.outcome || "provider-text") +
            "；请求：" +
            r.requestNumbers.length +
            "\n\n```json\n" +
            JSON.stringify(
              r.result.error || r.result.reply || r.result,
              null,
              2,
            ) +
            "\n```\n",
        )
        .join("\n")
    );
  })
  .join("\n");
fs.writeFileSync(
  path.join(out, "EXAMPLES.md"),
  "# 原始输入输出对照\n\n均为合成登记物品、真实模型；本地输出单独标源。旧的错误输出保留作证据，**不是建议照做**。这些样例没有经过物理验证或真人创新度盲评。完整数据见 results.json。\n\n" +
    examples,
);
const scopes = ["src", "tests", "scripts", "experiments"];
const sourcePaths = [
  ...new Set(
    [
      ...execFileSync("git", ["diff", "HEAD", "--name-only", "--", ...scopes], {
        encoding: "utf8",
      })
        .trim()
        .split(/\r?\n/),
      ...execFileSync(
        "git",
        ["ls-files", "--others", "--exclude-standard", "--", ...scopes],
        { encoding: "utf8" },
      )
        .trim()
        .split(/\r?\n/),
    ].filter(Boolean),
  ),
];
const sourceHashes = sourcePaths.map((file) => ({
  path: file,
  sha256: crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex"),
}));
fs.writeFileSync(
  path.join(out, "source-manifest.json"),
  JSON.stringify(sourceHashes, null, 2) + "\n",
);
fs.writeFileSync(
  path.join(out, "log-manifest.json"),
  JSON.stringify(logManifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    requests: summary.requests,
    estimatedCny: summary.estimatedCny,
    groups: summary.groups,
    latest: latestSignals,
  }),
);
