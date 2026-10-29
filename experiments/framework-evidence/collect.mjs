import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
const root = path.resolve(".runtime/framework-evidence");
const out = path.resolve(
  "docs/engineering/framework-evidence-2026-10-29/evidence",
);
fs.mkdirSync(out, { recursive: true });
const manifest = [];
function copy(source, target) {
  const original = fs.readFileSync(source);
  const bytes = target.endsWith(".txt")
    ? Buffer.from(
        original
          .toString("utf8")
          .replace(/^\uFEFF/, "")
          .replace(/\r\n?/g, "\n")
          .split("\n")
          .map((line) => line.replace(/[\t ]+$/g, ""))
          .join("\n")
          .replace(/\n*$/, "\n"),
      )
    : original;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  manifest.push({
    file: path.relative(path.dirname(out), target).replaceAll("\\", "/"),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...(target.endsWith(".txt")
      ? {
          originalSha256: createHash("sha256").update(original).digest("hex"),
          normalization:
            "UTF-8 without BOM, LF, no trailing horizontal whitespace, one final newline; no failed output removed",
        }
      : {}),
  });
}
for (const name of [
  "offline-initial.json",
  "offline-second.json",
  "offline-third.json",
  "offline.json",
  "offline-pi-durable-shared-store.json",
  "offline-pi-durable-recheck.json",
  "live-framework-and-main.json",
  "live-framework-recheck.json",
  "live-main-ui-baseline.json",
  "live-product-slice.json",
  "live-ledger.json",
  "route-before.json",
  "budget-check.json",
])
  if (fs.existsSync(path.join(root, name)))
    copy(path.join(root, name), path.join(out, name));
for (const name of [
  "app-install",
  "lab-install",
  "offline-initial",
  "offline-second",
  "offline-final",
  "offline-recovery-final",
  "offline-complete-final",
  "pi-targeted",
  "pi-isolated-run",
  "live-initial",
  "live-recheck",
  "live-main-ui",
  "live-product-slice",
  "ported-unit",
  "shared-targeted",
  "typecheck",
  "unit-final",
  "benchmark",
  "build",
  "cloud",
  "browser-life",
  "browser-shared-initial",
  "browser-shared",
  "budget-check",
  "format",
  "format-docs",
  "format-scripts",
])
  if (fs.existsSync(path.join(root, name + ".log")))
    copy(path.join(root, name + ".log"), path.join(out, "logs", name + ".txt"));
for (const name of [
  "result.json",
  "painting-cross-session.png",
  "box-offline-mobile.png",
])
  copy(
    path.resolve("artifacts/shared-knowledge", name),
    path.join(out, "browser", name),
  );
const storage = [];
for (const name of ["mastra-memory.sqlite", "mastra-workflow.sqlite"]) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) continue;
  const db = new DatabaseSync(file, { readOnly: true });
  storage.push({
    syntheticFile: name,
    mainFileBytes: fs.statSync(file).size,
    tables: db
      .prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'")
      .get().n,
    note: "PoC measurements include initialized framework domains; not required production size; WAL excluded",
  });
  db.close();
}
const ledger = JSON.parse(
  fs.readFileSync(path.join(root, "live-ledger.json"), "utf8"),
);
const frameworkArms = ["langgraph", "mastra", "pi-core", "pi-durable"];
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const fairness = {};
for (const arm of frameworkArms) {
  const payloads = ledger.attempts
    .filter((a) => a.arm === arm)
    .flatMap((a) =>
      a.input
        .filter((m) => m.role === "tool")
        .map((m) => {
          try {
            return JSON.parse(m.content);
          } catch {
            return null;
          }
        }),
    )
    .filter(Boolean);
  const painting = payloads.find((v) => v.id === "painting");
  const boxes = payloads.filter((v) => v.id === "box");
  fairness[arm] = Object.fromEntries(
    [
      ["initialPainting", painting],
      ["initialBoxAfterFailure", boxes[0]],
      ["correctedBox", boxes.at(-1)],
    ].map(([key, value]) => [
      key,
      {
        sha256: createHash("sha256")
          .update(JSON.stringify(canonical(value)))
          .digest("hex"),
        preferences: value.preferences.length,
        relationships: value.relationship.length,
      },
    ]),
  );
}
for (const group of [
  "initialPainting",
  "initialBoxAfterFailure",
  "correctedBox",
]) {
  if (
    new Set(frameworkArms.map((arm) => fairness[arm][group].sha256)).size !== 1
  )
    throw Error("Mismatched framework data: " + group);
}
fs.writeFileSync(
  path.join(out, "FAIRNESS.json"),
  JSON.stringify(
    {
      sameSuccessfulToolPayloadPerArm: true,
      groups: fairness,
      initialWrapperIssue:
        "Box relationship array also contained workflow-test preference records in initial run; corrected kind filtering and separated workflow data in final source. Painting gift fact unaffected; all four arms had identical initial data. Historical outputs retained; no semantic-quality ranking.",
    },
    null,
    2,
  ) + "\n",
);
const byArm = {};
for (const attempt of ledger.attempts) {
  const a = (byArm[attempt.arm] ??= {
    requests: 0,
    input: 0,
    output: 0,
    estimatedCny: 0,
    httpErrors: 0,
  });
  a.requests++;
  a.input += attempt.tokens?.prompt_tokens || 0;
  a.output += attempt.tokens?.completion_tokens || 0;
  a.estimatedCny += attempt.estimatedCny;
  if (attempt.status !== "returned") a.httpErrors++;
}
const lock = JSON.parse(
  fs.readFileSync("experiments/framework-evidence/package-lock.json", "utf8"),
);
const offline = JSON.parse(
  fs.readFileSync(path.join(root, "offline.json"), "utf8"),
);
const targeted = JSON.parse(
  fs.readFileSync(path.join(root, "offline-pi-durable-recheck.json"), "utf8"),
);
const unitLog = fs.readFileSync(path.join(root, "unit-final.log"), "utf8");
const unitPassed = Number(unitLog.match(/\bpass (\d+)/)?.[1]);
const unitFailed = Number(unitLog.match(/\bfail (\d+)/)?.[1]);
if (!Number.isSafeInteger(unitPassed) || !Number.isSafeInteger(unitFailed))
  throw Error("Missing actual unit test summary");
const summary = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  repository: "Starry-Curry/ProductAgent",
  main: "ea32c3f4c9e18992ca267b6dd74e26e418c9e95a",
  rfc: "69eb7c8791ca0fa85a8b105827705b5e75df5230",
  portedV1: "8eca3d72fc93fce9d4cdb27b1ccd6bd70973a52e",
  branch: "codex/wujian-framework-evidence-v1",
  frameworkResearchStartedAt: "2026-10-29T04:35:48Z",
  frameworkExperimentClosedAt: fs
    .statSync(path.join(root, "offline.json"))
    .mtime.toISOString(),
  productTests: {
    passed: unitPassed,
    failed: unitFailed,
    newThisRound: 9,
    portedV1New: 65,
    mainHistorical: 191,
    typecheck: true,
    build: true,
    benchmarkRegressions: 0,
    cloudStubChecks: 8,
    browserJourneys: [
      "life-integration",
      "life-formats",
      "shared-knowledge-integration",
    ],
    realHardware: 0,
    humanCreativeBlindReview: false,
    creativePaperCasePassed: false,
  },
  frameworkOffline: {
    full: { passed: offline.passed, failed: offline.failed },
    lastPiTargeted: { passed: targeted.passed, failed: targeted.failed },
    note: "Historical failed attempts preserved; do not sum repeats as unique tests",
  },
  live: {
    requests: ledger.attempts.length,
    limits: { requests: 60, estimatedCny: 20 },
    inputTokens: ledger.attempts.reduce(
      (s, a) => s + (a.tokens?.prompt_tokens || 0),
      0,
    ),
    outputTokens: ledger.attempts.reduce(
      (s, a) => s + (a.tokens?.completion_tokens || 0),
      0,
    ),
    estimatedCny: Number(
      ledger.attempts.reduce((s, a) => s + a.estimatedCny, 0).toFixed(8),
    ),
    http200: ledger.attempts.filter((a) => a.httpStatus === 200).length,
    failedAttempts: ledger.attempts.filter((a) => a.status !== "returned")
      .length,
    finishReasons: Object.fromEntries(
      [...new Set(ledger.attempts.map((a) => a.finishReason))].map((reason) => [
        reason,
        ledger.attempts.filter((a) => a.finishReason === reason).length,
      ]),
    ),
    byArm,
    price:
      "Beijing qwen-plus non-thinking <=128k: input 0.8/output 2 CNY per million; no cache discount; estimate, not invoice",
    priceSource: "https://help.aliyun.com/zh/model-studio/qwen-plus",
    transport:
      "Guarded loopback gateway: real Bailian non-streaming; local SSE adaptation for SDKs; native upstream SSE not tested",
  },
  dependencies: {
    productPackageLockChanged: false,
    experimentalPackageCount: Object.keys(lock.packages).length - 1,
    experimentalVersions: lock.packages[""].dependencies,
  },
  storage,
  manifest,
};
if (summary.live.requests > 60 || summary.live.estimatedCny > 20)
  throw Error("budget violation");
fs.writeFileSync(
  path.join(out, "SUMMARY.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      framework: summary.frameworkOffline,
      live: summary.live,
      storage,
      files: manifest.length,
    },
    null,
    2,
  ),
);
