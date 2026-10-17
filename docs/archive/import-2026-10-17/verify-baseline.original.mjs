import { createHash } from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const lines = fs.readFileSync("../SHA256SUMS.txt", "utf8").split(/\r?\n/);
let checked = 0;
const mismatches = [];
for (const line of lines) {
  const m = line.match(
    /^([a-f0-9]{64})\s+app\/(src\/.+|package\.json|package-lock\.json|tsconfig\.json|next\.config\.mjs|next-env\.d\.ts)$/,
  );
  if (!m) continue;
  const content = execFileSync("git", ["show", `118e295:${m[2]}`], {
    encoding: "buffer",
  });
  const actual = createHash("sha256").update(content).digest("hex");
  checked++;
  if (actual !== m[1]) mismatches.push(m[2]);
}
const nested = "../../Wujian-Windows-Demo-20261016.zip";
const nestedHash = createHash("sha256")
  .update(fs.readFileSync(nested))
  .digest("hex");
const expected = fs
  .readFileSync(nested + ".sha256", "utf8")
  .trim()
  .split(/\s+/)[0];
const report = {
  baselineCommit: "118e295",
  archiveKind: "Windows distribution ZIP, not upstream Git repository",
  sourceRepository: "unknown",
  checkedSourceFiles: checked,
  sourceMismatches: mismatches,
  nestedZipHash: nestedHash,
  nestedZipChecksumMatches: nestedHash === expected,
  outerZipSha256:
    "71C21521DE5F37AF5C5EDD8293E86D75D0B4EC91066563FCA4CDDF661C419C24",
};
fs.writeFileSync(
  "docs/engineering/baseline-provenance.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (mismatches.some((p) => p !== "next-env.d.ts") || nestedHash !== expected)
  process.exitCode = 1;
