// Scan only files proposed by this task, never local secrets or ignored data.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const repo = process.cwd(),
  base = "ea32c3f4c9e18992ca267b6dd74e26e418c9e95a";
const git = (...args) =>
  execFileSync(
    "git",
    ["-c", "safe.directory=" + repo.replaceAll("\\", "/"), ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
const allowed = new Set([
  "AGENTS.md",
  "CHANGELOG.md",
  "DEVELOPMENT_REPORT.md",
  "IMPLEMENTATION_STATUS.md",
  "REVIEW_HANDOFF.md",
  "docs/README.md",
  "scripts/test-cloud.mjs",
  "scripts/verify-local.mjs",
  ...[
    "agent/budget.ts",
    "agent/graph.ts",
    "agent/prompts.ts",
    "context/builder.ts",
    "context/item-advice.ts",
    "context/items.ts",
    "context/knowledge.ts",
    "home/router.ts",
    "life/ideas.ts",
    "life/planning-constraints.ts",
    "life/planning.ts",
    "life/task-planning.ts",
    "skills/registry.ts",
    "skills/memory-storytelling.ts",
  ].map((p) => "src/lib/" + p),
  ...[
    "cloud-provider-stub.mjs",
    "cloud-security.test.ts",
    "foundation.test.ts",
    "item-evidence-language.test.ts",
    "item-understanding-v1.test.ts",
    "shared-item-knowledge.test.ts",
    "shared-knowledge-integration.mjs",
  ].map((p) => "tests/" + p),
]);
const docs = "docs/engineering/framework-evidence-2026-10-29/";
const out = docs + "evidence/PUBLICATION_SCAN.json";
const files = [
  ...new Set(
    [
      ...git("diff", "--name-only", "-z", base, "--").split("\0"),
      ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"),
    ].filter(Boolean),
  ),
].sort();
const patterns = [
  ["provider-token", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  [
    "github-token",
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  ],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["aws-token", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  [
    "secret-literal",
    /(?:api[_-]?key|access[_-]?token|client[_-]?secret|authorization|cookie)["']?\s*[:=]\s*["'](?:Bearer\s+)?[A-Za-z0-9_+\/.=-]{24,}["']/i,
  ],
  ["credential-url", /https?:\/\/[^\s/:]+:[^\s/@]+@/],
];
const findings = [],
  reviewedSynthetic = [],
  manifest = [];
for (const file of files) {
  if (
    !allowed.has(file) &&
    !file.startsWith(docs) &&
    !file.startsWith("experiments/framework-evidence/")
  ) {
    findings.push({ file, reason: "outside-task-allowlist" });
    continue;
  }
  if (
    /(^|\/)(\.env[^/]*|api\.txt|node_modules|\.runtime|\.next|secrets)(\/|$)|\.(?:db|sqlite\w*|pem|key|pfx|zip)$/i.test(
      file,
    )
  ) {
    findings.push({ file, reason: "forbidden-data-or-cache" });
    continue;
  }
  if (file === out) continue;
  const bytes = fs.readFileSync(file);
  if (bytes.length > 5 * 1024 * 1024)
    findings.push({ file, reason: "larger-than-5MiB" });
  const binary = file.endsWith(".png");
  if (binary && !file.startsWith(docs + "evidence/browser/"))
    findings.push({ file, reason: "unexpected-binary" });
  if (!binary) {
    if (
      !/\.(?:md|json|ts|mjs)$/.test(file) &&
      !(file.startsWith(docs + "evidence/logs/") && file.endsWith(".txt"))
    )
      findings.push({ file, reason: "unexpected-file-type" });
    const body = bytes.toString("utf8");
    for (const [reason, regex] of patterns) {
      for (const m of body.matchAll(
        new RegExp(regex.source, regex.flags + "g"),
      )) {
        // Exact reviewed placeholder in the existing intercepted HTTP test, not
        // a blanket exception for test keys or fixtures. Never print its value.
        if (
          m &&
          file === "tests/foundation.test.ts" &&
          reason === "secret-literal" &&
          new Set([
            "753f79cc97cce2f073cbf4c6d3b4d7ddd090b3b01245af55cd5e585b301aee76",
            "cc2a38ac100e57e17bd38bba36c4ab28af2c32020b570deb73797659d824c146",
          ]).has(createHash("sha256").update(m[0]).digest("hex"))
        ) {
          reviewedSynthetic.push({
            file,
            line: body.slice(0, m.index).split("\n").length,
            reason:
              "Existing offline transport fixture with injected request; exact placeholder reviewed, no real credential",
          });
          continue;
        }
        if (m)
          findings.push({
            file,
            reason,
            line: body.slice(0, m.index).split("\n").length,
          });
      }
    }
    if (file.endsWith(".md"))
      for (const m of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = m[1].replace(/^<|>$/g, "").split("#")[0];
        if (!target || /^[a-z]+:/i.test(target)) continue;
        const p = path.resolve(path.dirname(file), decodeURIComponent(target));
        if (
          !p.startsWith(repo + path.sep) ||
          (!fs.existsSync(p) && p !== path.resolve(out))
        )
          findings.push({ file, reason: "broken-local-link", target });
      }
  }
  manifest.push({
    file,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
if (
  git(
    "diff",
    "--name-only",
    base,
    "--",
    "package.json",
    "package-lock.json",
  ).trim()
)
  findings.push({ reason: "root-dependencies-changed" });
const summary = JSON.parse(
  fs.readFileSync(docs + "evidence/SUMMARY.json", "utf8"),
);
if (summary.live.requests > 60 || summary.live.estimatedCny > 20)
  findings.push({ reason: "live-budget-violation" });
const report = {
  generatedAt: new Date().toISOString(),
  base,
  filesScanned: manifest.length,
  largestFileBytes: Math.max(...manifest.map((f) => f.bytes)),
  findings,
  reviewedSynthetic,
  scope:
    "Changed/untracked task allowlist; credential patterns, paths, size and local Markdown links; not full security audit",
  manifest,
  selfExcluded: out,
};
fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      filesScanned: report.filesScanned,
      largestFileBytes: report.largestFileBytes,
      findings,
    },
    null,
    2,
  ),
);
process.exitCode = findings.length ? 1 : 0;
