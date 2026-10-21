// Offline export for maintainers. Never loads .env, credentials or user databases.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const git = (...args) => execFileSync("git", args, { maxBuffer: 150_000_000 });
const hash = (b) => createHash("sha256").update(b).digest("hex");
const out = path.resolve("docs/handoff");
const checkOnly = process.argv.includes("--check");
fs.mkdirSync(out, { recursive: true });
const tracked = git("ls-files", "-z").toString().split("\0").filter(Boolean);
const objects = new Map(),
  findings = [];
for (const line of git("rev-list", "--objects", "HEAD")
  .toString()
  .split("\n")) {
  const [sha, ...rest] = line.split(" "),
    name = rest.join(" ");
  if (!sha || !name) continue;
  if (
    (/(?:^|\/)\.env(?:\.[^/]*)?$/i.test(name) && !name.endsWith(".example")) ||
    /(?:^|\/)(?:api\.txt|node_modules|\.runtime|data-life-v1|private)(?:\/|$)|\.(?:sqlite(?:3)?|db|pem|pfx|key)(?:$|[.-])/i.test(
      name,
    )
  ) {
    findings.push({ sha, path: name, kind: "prohibited-history-path" });
    continue; // Never open a forbidden secret file, even if accidentally tracked.
  }
  objects.set(sha, name);
}
const batch = execFileSync("git", ["cat-file", "--batch"], {
  input: [...objects.keys()].join("\n") + "\n",
  maxBuffer: 150_000_000,
});
let offset = 0,
  scanned = 0,
  binary = 0;
while (offset < batch.length) {
  const end = batch.indexOf(10, offset);
  const [sha, type, sizeText] = batch
    .subarray(offset, end)
    .toString()
    .split(" ");
  const size = Number(sizeText);
  if (!Number.isFinite(size)) throw Error("Invalid Git object response");
  const body = batch.subarray(end + 1, end + 1 + size);
  offset = end + size + 2;
  if (type !== "blob") continue;
  if (body.includes(0)) {
    binary++;
    continue;
  }
  scanned++;
  const text = body.toString("utf8");
  for (const [kind, re] of [
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    [
      "github-token",
      /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{45,})\b/g,
    ],
    ["model-key", /\bsk-[A-Za-z0-9_-]{24,}\b/g],
    ["aws-access-key", /\bAKIA[A-Z0-9]{16}\b/g],
  ])
    for (const m of text.matchAll(re)) {
      if (
        /example|sentinel|not-a-real|synthetic|placeholder|test-key|fake-/i.test(
          m[0],
        )
      )
        continue;
      findings.push({
        kind,
        path: objects.get(sha),
        blob: sha,
        line: text.slice(0, m.index).split("\n").length,
        matchSha256: hash(m[0]),
      });
    }
}
const safety = {
  at: new Date().toISOString(),
  head: git("rev-parse", "HEAD").toString().trim(),
  remote: git("remote", "get-url", "origin").toString().trim(),
  trackedFiles: tracked.length,
  scope:
    "All blobs reachable from current HEAD, including historical versions; ignored credentials never read; no matched credential values printed.",
  textBlobsScanned: scanned,
  binaryBlobsSkipped: binary,
  findings,
  privateMaterialPathReview: tracked.filter((p) =>
    /访谈|逐字稿|会议纪要|interview|private/i.test(p),
  ),
  limitations: [
    "Pattern scanning cannot prove absence of all secrets or private prose; binary assets need separate provenance review.",
    "Staged new files receive a separate working-tree scan before commit; rerun this history scan after commit before push.",
  ],
};
if (!checkOnly)
  fs.writeFileSync(
    path.join(out, "HANDOFF_SAFETY.json"),
    JSON.stringify(safety, null, 2) + "\n",
  );
const ledgerPath = path.resolve(".runtime/intelligence-20261021/ledger.json");
if (!checkOnly && fs.existsSync(ledgerPath)) {
  const bytes = fs.readFileSync(ledgerPath),
    l = JSON.parse(bytes);
  const requests = l.requests.map((r) => {
    const u = r.usage,
      rate =
        r.model === "qwen-plus"
          ? [0.8, 2]
          : r.model === "qwen3.7-plus"
            ? [2, 8]
            : null;
    return {
      id: r.id,
      case: r.case,
      at: r.at,
      model: r.model,
      status: r.status,
      elapsedMs: r.elapsedMs,
      usage: u,
      estimatedCny:
        rate && u
          ? (u.prompt_tokens * rate[0] + u.completion_tokens * rate[1]) / 1e6
          : null,
      inputSha256: hash(JSON.stringify(r.input)),
      outputSha256: r.output ? hash(JSON.stringify(r.output)) : null,
      errorType: r.errorType,
      errorCode: r.errorCode,
    };
  });
  const times = requests
    .map((r) => r.elapsedMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const cases = l.cases.map((c) => ({
    id: c.id,
    name: c.name,
    head: c.head,
    at: c.at,
    input: {
      question: c.input?.question,
      goal: c.input?.goal,
      inventory: c.input?.inventory,
      product: c.input?.brand
        ? {
            name: c.input.name,
            brand: c.input.brand,
            model: c.input.model,
            region: c.input.region,
            url: c.input.url,
          }
        : undefined,
      confirmedContext: c.input?.confirmedContext,
      revoked: c.input?.revoked,
    },
    elapsedMs: c.elapsedMs,
    requestIds: c.requestIds,
    finalVisibleReply: c.result?.reply,
    finalVisibleIdeas: c.result?.ideas,
    planning: c.result?.ideas
      ? {
          understanding: c.result.understanding,
          source: c.result.source,
          missing: c.result.missing,
          cloudRejected: c.result.cloudRejected,
          resources: c.result.resources,
          continuation: c.result.continuation,
        }
      : undefined,
    acquisition: c.name.endsWith("-source") ? c.result : undefined,
    trace: c.result?.trace,
    error: c.error,
    assessment:
      "Full independent per-result scoring unfinished at handoff. Selected failures and technical passes are documented in WUJIAN_PROJECT_HANDOFF.md; HTTP success is not a pass.",
  }));
  fs.writeFileSync(
    path.join(out, "INTELLIGENCE_RESULTS_20261021.json"),
    JSON.stringify(
      {
        version: "handoff-snapshot-1",
        stopped: true,
        stopReason:
          "User ordered immediate handoff; no further model requests scheduled.",
        baseline: l.baseline,
        sourceLedgerSha256: hash(bytes),
        syntheticOnly: true,
        rawLedgerLocalOnly:
          ".runtime/intelligence-20261021/ledger.json (ignored; never uploaded)",
        versionCaveat:
          "Development runs may include uncommitted changes at recorded HEAD. Final quote fix 6d385df has offline tests only. Holdout first runs 65–69 preceded subsequent repairs; retests are no longer unseen.",
        pricing: {
          url: "https://help.aliyun.com/zh/model-studio/model-pricing",
          date: "2026-10-21",
          basis:
            "CNY/million tokens: qwen-plus .8/2; qwen3.7-plus 2/8. Conservative list rates, no promotional/cache/free-credit discounts. Not an actual bill. Missing usage means unknown cost.",
        },
        summary: {
          requests: requests.length,
          http200: requests.filter((r) => r.status === 200).length,
          failures: requests.filter((r) => r.status !== 200).length,
          cases: cases.length,
          tokenInput: requests.reduce(
            (s, r) => s + (r.usage?.prompt_tokens || 0),
            0,
          ),
          tokenOutput: requests.reduce(
            (s, r) => s + (r.usage?.completion_tokens || 0),
            0,
          ),
          estimatedCnyKnownUsage: requests.reduce(
            (s, r) => s + (r.estimatedCny || 0),
            0,
          ),
          unknownCostRequests: requests.filter((r) => r.estimatedCny === null)
            .length,
          meanRequestMs: Math.round(
            times.reduce((a, b) => a + b, 0) / times.length,
          ),
          p95RequestMs: times[Math.ceil(times.length * 0.95) - 1],
        },
        requests,
        cases,
      },
      null,
      2,
    ) + "\n",
  );
}
console.log(
  JSON.stringify({
    safetyFindings: findings.length,
    textBlobs: scanned,
    binaryBlobs: binary,
    output: "docs/handoff",
    paidCalls: 0,
  }),
);
if (findings.length) process.exitCode = 2;
