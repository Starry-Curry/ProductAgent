// Scan the exact staged blobs before publishing. Never emits suspected secret contents.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
const git = (...args) =>
  execFileSync("git", args, { maxBuffer: 40 * 1024 * 1024 });
const config = process.argv.find((a) => a.startsWith("--config="))?.slice(9);
if (config) {
  if (path.basename(config) !== ".env.local")
    throw Error("Only explicit application config supported");
  process.loadEnvFile(config);
}
const knownSecrets = [
  process.env.AI_API_KEY,
  process.env.WUJIAN_API_KEY,
  process.env.DASHSCOPE_API_KEY,
].filter((s) => s && s.length > 10);
const paths = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
  .toString()
  .split("\0")
  .filter(Boolean);
if (!paths.length) throw Error("Nothing staged");
const issues = [],
  files = [];
for (const file of paths) {
  const blob = git("show", ":" + file);
  files.push({
    path: file,
    bytes: blob.length,
    sha256: crypto.createHash("sha256").update(blob).digest("hex"),
  });
  if (
    /(^|\/)(?:node_modules|\.runtime|\.next[^/]*|\.npm|\.cache|data-life-v1|data|models|secrets)(\/|$)|(^|\/)api\.txt$|\.sqlite(?:[.-]|$)|\.db(?:[.-]|$)|\.(?:pem|pfx|p12|key)$|(^|\/)\.env(?!\.example$)/i.test(
      file,
    )
  )
    issues.push({ path: file, kind: "forbidden-path" });
  if (blob.length > 5 * 1024 * 1024)
    issues.push({ path: file, kind: "over-5-MiB" });
  const text = blob.toString("utf8");
  if (knownSecrets.some((s) => text.includes(s)))
    issues.push({ path: file, kind: "configured-secret-literal" });
  for (const [kind, pattern] of [
    ["api-key-pattern", /\bsk-[a-zA-Z0-9_-]{20,}\b/],
    [
      "github-token-pattern",
      /\b(?:gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{40,})\b/,
    ],
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["aws-key", /\bAKIA[A-Z0-9]{16}\b/],
    ["literal-bearer", /Bearer\s+[a-zA-Z0-9_-]{24,}/],
  ])
    if (pattern.test(text)) issues.push({ path: file, kind });
}
const out = path.resolve(".runtime/item-v1/publish-scan.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      passed: issues.length === 0,
      stagedFiles: files.length,
      totalBytes: files.reduce((s, r) => s + r.bytes, 0),
      configuredSecretComparison: knownSecrets.length > 0,
      issues,
      files,
      limitations: [
        "Pattern and known configured-key scan, not a guarantee against every possible secret format",
        "Normal synthetic evidence retained; no deletion based solely on public visibility",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    passed: issues.length === 0,
    files: files.length,
    bytes: files.reduce((s, r) => s + r.bytes, 0),
    issues,
  }),
);
if (issues.length) process.exit(1);
