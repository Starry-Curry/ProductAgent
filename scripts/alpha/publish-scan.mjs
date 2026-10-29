import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
const files = [
  ...new Set(
    (
      git(["diff", "--name-only"]) +
      "\n" +
        git(["diff", "--cached", "--name-only"]) +
        "\n" +
      git(["ls-files", "--others", "--exclude-standard"])
    )
      .split(/\r?\n/)
      .filter(Boolean),
  ),
];
const problems = [];
let total = 0;
const patterns = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /(?:AI_API_KEY|DASHSCOPE_API_KEY|access_token|refresh_token)\s*[=:]\s*["'][A-Za-z0-9_\-/.+]{20,}["']/g,
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/g,
];
for (const f of files) {
  if (
    !/^(src\/|tests\/|scripts\/alpha\/|scripts\/verify-local\.mjs$|docs\/|README\.md$|CHANGELOG\.md$|DEVELOPMENT_REPORT\.md$|IMPLEMENTATION_STATUS\.md$|REVIEW_HANDOFF\.md$)/.test(
      f,
    )
  )
    problems.push({ file: f, reason: "outside reviewed scope" });
  if (
    /(?:^|\/)(?:\.env(?:\..*)?|api\.txt|node_modules|\.next|\.runtime|data|private)(?:\/|$)|\.(?:sqlite(?:-wal|-shm)?|db|pem|pfx|zip)$/i.test(
      f,
    )
  )
    problems.push({
      file: f,
      reason: "forbidden credential/database/cache path",
    });
  const b = fs.readFileSync(f);
  total += b.length;
  if (b.length > 5 * 1024 * 1024)
    problems.push({ file: f, reason: "large file" });
  if (/\.(?:png|jpe?g|webp)$/.test(f)) continue;
  const text = b.toString("utf8");
  for (const pattern of patterns)
    for (const m of text.matchAll(pattern))
      problems.push({
        file: f,
        reason: "suspected secret",
        fingerprint: createHash("sha256")
          .update(m[0])
          .digest("hex")
          .slice(0, 12),
      });
  if (f.endsWith(".md"))
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      let link = match[1].replace(/^<|>$/g, "");
      if (/^(?:https?:|#|mailto:|codex:)/.test(link)) continue;
      link = link.split("#")[0];
      if (link && !fs.existsSync(path.resolve(path.dirname(f), link)))
        problems.push({ file: f, reason: "missing local link", target: link });
    }
}
const ledger = JSON.parse(
  fs.readFileSync(".runtime/intelligence-alpha/live-ledger.json", "utf8"),
);
if (
  ledger.attempts.length > 100 ||
  ledger.attempts.reduce((s, a) => s + a.estimatedCny, 0) > 20 ||
  ledger.attempts.some((a) => a.status === "reserved")
)
  problems.push({ reason: "paid budget invalid" });
if (git(["diff", "--name-only", "--", "package.json", "package-lock.json"]))
  problems.push({ reason: "unexpected runtime dependency change" });
const report = {
  passed: !problems.length,
  files: files.length,
  bytes: total,
  scope:
    "uncommitted task files only; generic secret patterns, path/size/link checks; not a third-party security audit",
  problems,
};
fs.writeFileSync(
  ".runtime/alpha/publish-scan.json",
  JSON.stringify(report, null, 2) + "\n",
);
fs.writeFileSync("docs/engineering/intelligence-alpha-2026-10-29/evidence/PUBLISH_SCAN.json",JSON.stringify(report,null,2)+"\n");
if (problems.length) {
  console.log(JSON.stringify(report));
  process.exit(1);
}
fs.writeFileSync(
  ".runtime/alpha/stage-files.json",
  JSON.stringify(files, null, 2),
);
console.log(JSON.stringify(report));
