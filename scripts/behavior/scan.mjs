import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", windowsHide: true });
const files = [
  ...new Set(
    [
      ...git("diff", "--name-only", "HEAD").trim().split("\n"),
      ...git("ls-files", "--others", "--exclude-standard").trim().split("\n"),
    ].filter(Boolean),
  ),
];
const reportRoot = "docs/engineering/intelligence-behavior-2026-10-29";
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(dir, e.name))
        : [path.join(dir, e.name).replaceAll("\\", "/")],
    );
}
for (const f of walk(reportRoot)) if (!files.includes(f)) files.push(f);
const failures = [],
  hashes = [];
const signatures = [
  /\bsk-[A-Za-z0-9]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /Bearer\s+[A-Za-z0-9._-]{32,}/,
];
for (const f of files) {
  if (f.endsWith("/PUBLISH_SCAN.json") || !fs.existsSync(f)) continue;
  if (
    /(?:^|\/)(?:\.env(?:\..*)?|api\.txt|node_modules|\.next|\.runtime|data|data-life-v1)(?:\/|$)|\.(?:sqlite|db|pem|p12|key)(?:$|-)/i.test(
      f,
    )
  ) {
    failures.push({ file: f, reason: "forbidden path" });
    continue;
  }
  const b = fs.readFileSync(f);
  if (b.length > 5 * 1024 * 1024)
    failures.push({ file: f, reason: "over 5MiB" });
  if (!/\.png$/.test(f)) {
    const s = b.toString("utf8");
    if (signatures.some((r) => r.test(s)))
      failures.push({
        file: f,
        reason: "suspected credential pattern (value suppressed)",
      });
    if (f.endsWith(".md"))
      for (const m of s.matchAll(/\]\(([^)]+)\)/g)) {
        const link = m[1].replace(/#.*$/, "");
        if (!link || /^[a-z]+:|^\//i.test(link)) continue;
        if (!fs.existsSync(path.resolve(path.dirname(f), decodeURI(link))))
          failures.push({ file: f, reason: "missing local link " + link });
      }
  }
  hashes.push({
    file: f,
    bytes: b.length,
    sha256: createHash("sha256").update(b).digest("hex"),
  });
}
const root = "docs/engineering/intelligence-behavior-2026-10-29";
const report = {
  at: new Date().toISOString(),
  scope:
    "all proposed changed/untracked non-ignored files; patterns, forbidden paths, sizes and Markdown links; not a universal secret detector",
  files: hashes.length,
  totalBytes: hashes.reduce((s, x) => s + x.bytes, 0),
  failures,
  hashes,
};
fs.writeFileSync(
  root + "/PUBLISH_SCAN.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({ files: report.files, bytes: report.totalBytes, failures }),
);
if (failures.length) process.exitCode = 1;
