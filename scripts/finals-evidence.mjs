// Publish only this audit's synthetic results and credential-free command logs.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const source = ".runtime/audit-20261029",
  target = "docs/finals/evidence";
fs.mkdirSync(target, { recursive: true });
fs.mkdirSync(target + "/screenshots", { recursive: true });
fs.mkdirSync(target + "/logs", { recursive: true });
const reports = [
  "paid-ledger.json",
  "live-results.json",
  "live-followup.json",
  "live-initial-fixture.json",
  "live-initial-followup-fixture.json",
  "offline-probes.json",
  "offline-diagnostics.json",
  "cloud-test-adaptation.json",
];
for (const name of reports) {
  const data = JSON.parse(fs.readFileSync(path.join(source, name), "utf8"));
  if (name.startsWith("live-initial")) {
    data.fixtureVersion = "initial-notes-v1";
    data.fixtureCaveat =
      "An ancillary certification note used an undeclared notes field. Retained as historical evidence; requests 11 onward rerun with supported care field.";
  } else if (name === "live-results.json" || name === "live-followup.json")
    data.fixtureVersion = "care-v2";
  fs.writeFileSync(
    path.join(target, name),
    JSON.stringify(data, null, 2) + "\n",
  );
}
const commandRows = [
  ["npm ci --cache .npm --no-audit --no-fund", "install.log", 0],
  ["npm test", "unit.log", 0],
  ["npm run typecheck", "typecheck.log", 0],
  ["npm run test:benchmark", "benchmark.log", 0],
  ["npm run build", "build.log", 0],
  ["npm run test:acceptance -- life", "browser-life.log", 0],
  ["npm run test:acceptance", "browser-legacy.log", 0],
  ["npm run test:task-planning (default browser path)", "browser-task.log", 1],
  ["npm run test:care (default browser path)", "browser-care.log", 1],
  [
    "EDGE_PATH=<installed Edge>; npm run test:task-planning",
    "browser-task-edge.log",
    0,
  ],
  ["EDGE_PATH=<installed Edge>; npm run test:care", "browser-care-edge.log", 0],
  ["node scripts/verify-local.mjs storybook", "browser-storybook.log", 0],
  ["npm run test:cloud", "cloud.log", 1],
  [
    "node scripts/finals-cloud-recheck.mjs (initial audit wrapper URL argument error)",
    "cloud-wrapper-initial.log",
    1,
  ],
  [
    "EDGE_PATH=<installed Edge>; node scripts/finals-cloud-recheck.mjs (locator adaptation)",
    "cloud-recheck.log",
    0,
  ],
  [
    "node --experimental-strip-types scripts/finals-offline-diagnostics.mjs",
    "offline-diagnostics.log",
    0,
  ],
  [
    "node --experimental-strip-types scripts/finals-audit.mjs (offline)",
    "offline-probes.log",
    0,
  ],
  [
    "node --experimental-strip-types scripts/finals-audit.mjs --live --authorize-paid-max=40 --config=<project .env.local> (initial fixture)",
    "live.log",
    0,
  ],
  [
    "node --experimental-strip-types scripts/finals-audit.mjs --live --followup --authorize-paid-max=40 --config=<project .env.local> (initial fixture)",
    "live-followup.log",
    0,
  ],
  [
    "node --experimental-strip-types scripts/finals-audit.mjs --live --authorize-paid-max=40 --config=<project .env.local>",
    "live-recheck.log",
    0,
  ],
  [
    "node --experimental-strip-types scripts/finals-audit.mjs --live --followup --authorize-paid-max=40 --config=<project .env.local>",
    "live-followup-recheck.log",
    0,
  ],
];
const commands = commandRows.map(([command, log, exitCode]) => {
  const raw = fs.readFileSync(path.join(source, log));
  const normalized = raw
    .toString("utf8")
    .replaceAll("\r\n", "\n")
    .replace(/[ \t]+$/gm, "");
  fs.writeFileSync(path.join(target, "logs", log), normalized);
  return {
    command,
    exitCode,
    log: "logs/" + log,
    rawSha256: createHash("sha256").update(raw).digest("hex"),
  };
});
for (const [from, to] of [
  ["artifacts/benchmark.json", "legacy-benchmark.json"],
  ["artifacts/foundation-benchmark.json", "foundation-benchmark.json"],
  ["artifacts/life/acceptance.json", "browser-life.json"],
  ["artifacts/life/formats.json", "browser-formats.json"],
  ["artifacts/care/validation.json", "browser-care.json"],
  ["artifacts/task-planning/validation.json", "browser-task.json"],
  ["artifacts/storybook-reading/checks.json", "browser-stories.json"],
  ["artifacts/cloud/validation.json", "cloud-adapted.json"],
]) {
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(target, to));
}
for (const [from, to] of [
  ["artifacts/life/home-desktop.png", "home-desktop.png"],
  ["artifacts/life/home-mobile.png", "home-mobile.png"],
  ["artifacts/task-planning/mobile.png", "preparation-mobile.png"],
  ["artifacts/care/desktop.png", "care-desktop.png"],
  ["artifacts/storybook-reading/desktop.png", "stories-desktop.png"],
  ["artifacts/storybook-reading/mobile.png", "stories-mobile.png"],
  [source + "/cloud-story.png", "cloud-story.png"],
])
  fs.copyFileSync(from, path.join(target, "screenshots", to));
const ledger = JSON.parse(
  fs.readFileSync(source + "/paid-ledger.json", "utf8"),
);
const tokens = ledger.reduce(
  (t, r) => ({
    input: t.input + (r.usage?.prompt_tokens || 0),
    output: t.output + (r.usage?.completion_tokens || 0),
  }),
  { input: 0, output: 0 },
);
const summary = {
  measuredAt: new Date().toISOString(),
  timezone: "Asia/Shanghai",
  baseline: "ea32c3f4c9e18992ca267b6dd74e26e418c9e95a",
  branch: execFileSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
  }).trim(),
  repository: "https://github.com/Starry-Curry/ProductAgent",
  auditPath: process.cwd(),
  node: process.version,
  logNormalization:
    "Published logs use LF and remove trailing spaces; raw runtime logs retained locally, with rawSha256 per command.",
  requests: ledger.length,
  http200: ledger.filter((r) => r.http === 200).length,
  transportErrors: ledger.filter((r) => r.status === "transport-error").length,
  tokens,
  unreportedUsageRequests: ledger.filter((r) => !r.usage).map((r) => r.number),
  knownUsageListPriceCny: (tokens.input * 0.8 + tokens.output * 2) / 1e6,
  actualBilledCostCny: null,
  costCaveat:
    "Known returned usage only. Beijing non-thinking <=128K list price input 0.8/output 2 CNY per million. Excludes unknown timeout usage; ignores cache/free quota/discounts. Not an invoice.",
  pricingSource: "https://help.aliyun.com/zh/model-studio/qwen-plus",
  commands,
  productChanges: false,
  piInstalled: false,
  paidLimit: 40,
};
fs.writeFileSync(
  target + "/summary.json",
  JSON.stringify(summary, null, 2) + "\n",
);
const marker =
  "<!-- Request table generated from the immutable audit ledger follows. -->";
const reportFile = "docs/finals/TEST_REPORT.md";
const table = [
  "",
  "## 逐请求记录（输入/输出Token、耗时）",
  "",
  "| # | 场景/路径 | HTTP/结果 | 输入 | 输出 | ms |",
  "| --- | --- | --- | --- | --- | --- |",
  ...ledger.map(
    (r) =>
      `| ${r.number} | ${r.label} | ${r.http ?? r.status} | ${r.usage?.prompt_tokens ?? "未知"} | ${r.usage?.completion_tokens ?? "未知"} | ${r.elapsedMs} |`,
  ),
  "",
].join("\n");
fs.writeFileSync(
  reportFile,
  fs.readFileSync(reportFile, "utf8").split(marker)[0] + marker + "\n" + table,
);
const manifest = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name !== "manifest.json") {
      const data = fs.readFileSync(file);
      manifest.push({
        file: path.relative(target, file).replaceAll("\\", "/"),
        bytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
      });
    }
  }
}
walk(target);
fs.writeFileSync(
  target + "/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      requests: summary.requests,
      http200: summary.http200,
      transportErrors: summary.transportErrors,
      tokens,
      costEstimate: summary.knownUsageListPriceCny,
      files: manifest.length,
    },
    null,
    2,
  ),
);
