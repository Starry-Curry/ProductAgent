import fs from "node:fs";
import path from "node:path";
const dir = "docs/engineering/product-foundation-2026-10-30/evidence";
const ledger = JSON.parse(fs.readFileSync("../product-foundation-evidence/model-calls.json", "utf8"));
if (ledger.attempts.length > 150) throw Error("task request cap exceeded");
const q = (values, p) => [...values].sort((a,b) => a-b)[Math.ceil(values.length * p)-1] ?? null;
const initial = JSON.parse(fs.readFileSync(`${dir}/qa-live-stream-fixed.json`, "utf8")).results.filter(r => r.source === "app-core");
const summary = {
  stage: "product-foundation-v1", calls: ledger.attempts.length,
  status: ledger.attempts.reduce((n,a) => (n[a.status] = (n[a.status] || 0) + 1, n), {}),
  inputTokens: ledger.attempts.reduce((n,a) => n + (a.tokens?.prompt_tokens || 0), 0),
  outputTokens: ledger.attempts.reduce((n,a) => n + (a.tokens?.completion_tokens || 0), 0),
  estimatedCny: ledger.attempts.reduce((n,a) => n + (a.estimatedCny ?? a.reservedCny), 0),
  uniqueLedgerQuestions: new Set(ledger.attempts.map(a => a.question)).size,
  thirtyCaseCandidateRound: { cases: initial.length,
    outcomes: initial.reduce((n,r) => (n[r.result?.reply.outcome || "error"] = (n[r.result?.reply.outcome || "error"] || 0)+1,n),{}),
    totalP50Ms: q(initial.map(r => r.totalMs), .5), totalP95Ms: q(initial.map(r => r.totalMs), .95),
    streamedCases: initial.filter(r=>r.firstContentMs).length,
    streamedFirstP50Ms: q(initial.filter(r=>r.firstContentMs).map(r=>r.firstContentMs), .5),
    streamedFirstP95Ms: q(initial.filter(r=>r.firstContentMs).map(r=>r.firstContentMs), .95),
    caveat: "Core/service timings, not browser end-to-end; first-token values cover streamed subset only. Answered is transport/application outcome, not correctness. Later selected retests are separate, not a new full 30-case pass."
  },
};
fs.writeFileSync(`${dir}/model-calls.json`, JSON.stringify(ledger, null, 2) + "\n");
fs.writeFileSync(`${dir}/model-summary.json`, JSON.stringify(summary, null, 2) + "\n");
for (const [from,to] of [[".runtime/rea-lamp-evidence.json","rea-server-only.json"],[".runtime/rea-lamp-client-evidence.json","rea-with-client.json"]]) fs.copyFileSync(from, `${dir}/${to}`);
const final = JSON.parse(fs.readFileSync(`${dir}/qa-live-retrieval-fixed.json`, "utf8")).results;
const samples = ["17","18","20","25","26","27"].map(id => final.find(r=>r.id===id));
const intro = "# 真实回答：成功与失败对照\n\n合成持有的真实型号，qwen-plus，真实百炼输出。非实物验证。以下为原始回答；状态 answered 不证明正确。由Codex对照官方原文审阅（未做真人评审）：17 的核心开机步骤有原文；18 的主要控制操作相符，但‘圆形’按键形状没有本文依据；20 末尾新增固件前提无依据；25 把资料缺失当不支持并补造外部证据；26 正确承认未知但又补写未经提供的标签建议；27 补造保修/维修政策，不能采用。\n\n";
fs.writeFileSync(path.join(dir,"../MODEL_SAMPLES.md"), intro + samples.map(r=>`## ${r.id}：${r.question}\n\n${r.result.reply.answer}\n\n${r.result.reply.steps.map(s=>s.text).join("\n\n")}\n`).join("\n").split("\n").map(l=>l.trimEnd()).join("\n"));
console.log(summary);
