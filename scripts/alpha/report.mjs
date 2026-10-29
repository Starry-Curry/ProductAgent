import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { root, saveReport } from "./shared.mjs";
const destination = path.resolve(
  "docs/engineering/intelligence-alpha-2026-10-29/evidence",
);
const hash = (b) => createHash("sha256").update(b).digest("hex");
fs.mkdirSync(destination, { recursive: true });
const artifacts = [];
function copy(from, to) {
  if (!fs.existsSync(from)) return;
  const raw = fs.readFileSync(from);
  const published = /\.txt$/.test(from)
    ? Buffer.from(
        raw
          .toString("utf8")
          .replace(/^\ufeff/, "")
          .replaceAll("\r\n", "\n")
          .replace(/[ \t]+$/gm, "")
          .trimEnd() + "\n",
      )
    : raw;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, published);
  artifacts.push({
    file: path.relative(path.dirname(destination), to).replaceAll("\\", "/"),
    originalSha256: hash(raw),
    publishedSha256: hash(published),
    bytes: published.length,
  });
}
for (const f of fs.readdirSync(root).filter((f) => f.endsWith(".json")))
  copy(path.join(root, f), path.join(destination, f));
for (const f of fs
  .readdirSync(".runtime/alpha")
  .filter((f) => f.endsWith(".txt")))
  copy(path.resolve(".runtime/alpha", f), path.join(destination, "logs", f));
for (const kind of ["offline", "live"])
  for (const f of fs
    .readdirSync("artifacts/intelligence-alpha/" + kind)
    .filter((f) => /\.(json|png)$/.test(f)))
    copy(
      path.resolve("artifacts/intelligence-alpha", kind, f),
      path.join(destination, "browser", kind, f),
    );
const ledger = JSON.parse(
  fs.readFileSync(path.join(root, "live-ledger.json"), "utf8"),
);
if (
  ledger.attempts.length > 100 ||
  ledger.attempts.some((a) => a.status === "reserved")
)
  throw Error("Unsettled/excess paid requests");
const returned = ledger.attempts.filter((a) => a.status === "returned"),
  failed = ledger.attempts.filter((a) => a.status === "failed");
const spent = ledger.attempts.reduce((s, a) => s + a.estimatedCny, 0);
if (spent > 20) throw Error("Cost cap exceeded");
const summary = {
  createdAt: new Date().toISOString(),
  baseline: "1cb97646cb8ea058af86515eb79d03d2b899f7b9",
  formalMain: "ea32c3f4c9e18992ca267b6dd74e26e418c9e95a",
  branch: "codex/wujian-intelligence-alpha",
  paid: {
    capRequests: 100,
    capEstimatedCny: 20,
    attempts: ledger.attempts.length,
    httpReturned: returned.length,
    transportFailed: failed.length,
    inputTokens: returned.reduce(
      (s, a) => s + (a.tokens?.prompt_tokens || 0),
      0,
    ),
    outputTokens: returned.reduce(
      (s, a) => s + (a.tokens?.completion_tokens || 0),
      0,
    ),
    returnedUsageEstimatedCny: returned.reduce((s, a) => s + a.estimatedCny, 0),
    unknownUsageReservedCny: failed.reduce((s, a) => s + a.estimatedCny, 0),
    conservativeBudgetTotalCny: spent,
    pricing:
      "Beijing qwen-plus non-thinking <=128K input: CNY 0.8/M input, 2/M output; cached discounts ignored; not an invoice",
    failureAccounting:
      "Earlier nine fetch failures retain CNY 1 each. Later aborted attempts retain bounded input-byte/output-token reserves. Unknown usage is never counted as free.",
  },
  offline: {
    baselineTests: 265,
    newTests: 24,
    total: 289,
    pass: 289,
    source: "logs/offline-delivery.txt",
  },
  checks: {
    typecheck: true,
    productionBuild: true,
    benchmarkRegressions: 0,
    offlineBrowser: true,
    liveBrowserTechnical: true,
    liveBrowserCreativePublished: false,
    cloudPrivacyAndToolRoundtrip: true,
  },
  humanBlindRaters: 0,
  physicalDeviceTests: 0,
  privateUserDatabaseTouched: false,
  creativeProductAcceptance: false,
  artifacts,
};
saveReport(path.join(destination, "SUMMARY.json"), summary);
console.log(
  JSON.stringify({
    artifacts: artifacts.length,
    requests: summary.paid.attempts,
    creativeProductAcceptance: false,
  }),
);
