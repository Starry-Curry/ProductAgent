import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { root, saveReport } from "./shared.mjs";
const output = path.resolve(
    "docs/engineering/intelligence-behavior-2026-10-29",
  ),
  evidence = path.join(output, "evidence");
fs.mkdirSync(evidence, { recursive: true });
const manifest = [];
function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const original = fs.readFileSync(from);
  // Git stores text with LF. Preserve original hashes as well as published ones.
  fs.writeFileSync(
    to,
    to.endsWith(".log")
      ? original
          .toString("utf8")
          .replaceAll("\r\n", "\n")
          .replace(/[ \t]+$/gm, "")
          .trimEnd() + "\n"
      : original,
  );
  manifest.push({
    path: path.relative(output, to).replaceAll("\\", "/"),
    bytes: fs.statSync(to).size,
    sha256: createHash("sha256").update(fs.readFileSync(to)).digest("hex"),
    originalSha256: createHash("sha256").update(original).digest("hex"),
  });
}
for (const file of fs.readdirSync(root).filter((f) => f.endsWith(".json")))
  copy(path.join(root, file), path.join(evidence, file));
for (const file of fs
  .readdirSync("artifacts/intelligence-behavior/live")
  .filter((f) => /\.(png|json)$/.test(f)))
  copy(
    path.join("artifacts/intelligence-behavior/live", file),
    path.join(evidence, "browser", file),
  );
for (const file of [
  "test-delivery.log",
  "typecheck-final.log",
  "build-delivery.log",
  "benchmark-release-final.log",
  "cloud-retest.log",
  "integration-release.log",
  "budget-unit.log",
  "browser-release.log",
  "browser-live.log",
  "browser-resume.log",
  "browser-resume2.log",
  "behavior-unit-final.log",
  "offline-first.log",
  "integration-final.log",
  "cloud-final.log",
  "bound-qa.log",
  "live-remaining.log",
])
  if (fs.existsSync(".runtime/" + file))
    copy(".runtime/" + file, path.join(evidence, "logs", file));
if (fs.existsSync(".runtime/browser-failure-before-feedback-fix.json"))
  copy(
    ".runtime/browser-failure-before-feedback-fix.json",
    path.join(evidence, "browser", "feedback-race-failure.json"),
  );
const ledger = JSON.parse(
  fs.readFileSync(path.join(root, "live-ledger.json"), "utf8"),
);
const summary = {
  measuredAt: new Date().toISOString(),
  base: "7c513170a28d5dd76fe7845e0debdc163c53ea19",
  branch: "codex/wujian-intelligence-behavior-v1",
  maxRequests: 60,
  maxEstimatedCny: 10,
  requests: ledger.attempts.length,
  returned: ledger.attempts.filter((a) => a.status === "returned").length,
  failed: ledger.attempts.filter((a) => a.status === "failed").length,
  inputTokens: ledger.attempts.reduce(
    (s, a) => s + (a.tokens?.prompt_tokens || 0),
    0,
  ),
  outputTokens: ledger.attempts.reduce(
    (s, a) => s + (a.tokens?.completion_tokens || 0),
    0,
  ),
  knownUsageCny: ledger.attempts
    .filter((a) => a.tokens)
    .reduce((s, a) => s + a.estimatedCny, 0),
  unknownUsageReservedCny: ledger.attempts
    .filter((a) => !a.tokens)
    .reduce((s, a) => s + a.estimatedCny, 0),
  capCountedCny: ledger.attempts.reduce((s, a) => s + a.estimatedCny, 0),
  physicalTests: 0,
  humanBlindReviewConducted: false,
};
assertBudget: {
  if (summary.requests > 60 || summary.capCountedCny > 10)
    throw Error("BUDGET EXCEEDED");
}
saveReport(path.join(evidence, "SUMMARY.json"), summary);
saveReport(path.join(evidence, "MANIFEST.json"), manifest);
const pilot = JSON.parse(
    fs.readFileSync(path.join(root, "comparison-pilot.json")),
  ),
  rest = JSON.parse(
    fs.readFileSync(path.join(root, "comparison-remaining.json")),
  ),
  bound = JSON.parse(
    fs.readFileSync(path.join(root, "comparison-bound-qa.json")),
  );
const rows = [
  ...pilot.rows,
  ...rest.rows.filter((r) => r.case !== "02"),
  ...bound.rows,
];
const caseMap = new Map(rest.cases.map((c) => [c.id, c]));
for (const id of ["01", "04", "11"])
  caseMap.set(
    id,
    pilot.cases.find((c) => c.id === id),
  );
caseMap.set(
  "02",
  bound.cases.find((c) => c.id === "02"),
);
const key = [],
  sample = [
    "# 匿名对照材料（尚未进行外部盲评）",
    "",
    "先按实际作用、机制、资源、偏好、自然完整度逐项评审；每项给通过/不通过/不确定及一句原因。请先不要查看 REVIEW_KEY.json。自动字段通过不代表原理成立。",
    "",
    "共同授权偏好：我住小房间，喜欢安静、能随手恢复原状的布置，不愿为了创意买新材料。当前明确要求优先于这些偏好。",
    "",
    "01—11每组含直接千问、Alpha、新版各一个结果。12只有直接模型，预算不足未完成三方，不纳入比较。资料绑定错误的02原记录仅保留在证据目录；这里用补测替代。采样期间修复了测试夹具和业务错误，所以这是探索性对照，不是固定版本统计实验。",
    "",
    "模型输出的风格仍可能暴露来源；并未宣称严格双盲。",
  ];
for (const [id, c] of [...caseMap].sort((a, b) => a[0].localeCompare(b[0]))) {
  sample.push(
    "",
    "## 案例 " + id,
    "",
    c.goal,
    "",
    "### 已提供事实",
    "",
    ...c.facts.map(
      (f) =>
        "- " +
        f.name +
        "：" +
        f.facts.map((x) => x.text).join("；") +
        "。未知：" +
        f.unknowns.join("；"),
    ),
  );
  const candidates = rows
    .filter((r) => r.case === id)
    .sort((a, b) =>
      createHash("sha256")
        .update(id + a.arm + "wujian")
        .digest("hex")
        .localeCompare(
          createHash("sha256")
            .update(id + b.arm + "wujian")
            .digest("hex"),
        ),
    );
  for (let n = 0; n < candidates.length; n++) {
    const r = candidates[n],
      label = String.fromCharCode(65 + n);
    key.push({
      case: id,
      label,
      arm: r.arm,
      model: r.model,
      requests: r.requests,
      elapsedMs: r.elapsedMs,
    });
    let text = r.error || r.result?.reply?.answer || r.result?.text;
    if (r.result?.ideas) {
      text = r.result.ideas.length
        ? r.result.ideas
            .map(
              (i) =>
                i.title +
                "\n\n" +
                (i.reasoning?.outcome || "") +
                "\n\n" +
                i.steps.map((s, n) => n + 1 + ". " + s).join("\n") +
                "\n\n原理：" +
                (i.rationale || "未提供") +
                "\n\n条件：" +
                [...(i.missing || []), ...i.limits].join("；"),
            )
            .join("\n\n")
        : r.result.failure?.message || "没有得到可发布方案";
    }
    if (text?.startsWith("{")) {
      try {
        text = JSON.parse(text).answer || text;
      } catch {}
    }
    sample.push("", "### 样本 " + label, "", String(text));
  }
}
fs.writeFileSync(
  path.join(output, "REVIEW_SAMPLES.md"),
  sample.join("\n") + "\n",
);
saveReport(path.join(output, "REVIEW_KEY.json"), key);
console.log(JSON.stringify(summary));
