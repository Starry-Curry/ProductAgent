import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
test("本轮付费网关在60次、10元或输入超界时拒绝，零真实外呼且不重置台账", async () => {
  const dir = fs.mkdtempSync(path.resolve(".runtime/behavior-budget-unit-"));
  const previous = process.env.BEHAVIOR_EVIDENCE_DIR;
  process.env.BEHAVIOR_EVIDENCE_DIR = dir;
  const { gateway } = await import("../scripts/behavior/gateway.mjs");
  const config = path.join(dir, ".env.local");
  fs.writeFileSync(
    config,
    "AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1\nAI_API_KEY=fixture-only\nAI_MODEL=qwen-plus\n",
  );
  const original = globalThis.fetch;
  let outbound = 0;
  globalThis.fetch = async (u, init) => {
    if (String(u).startsWith("https://dashscope.aliyuncs.com")) {
      outbound++;
      throw Error("OUTBOUND FORBIDDEN IN UNIT");
    }
    return original(u, init);
  };
  try {
    for (const scenario of ["requests", "money", "bytes"]) {
      const attempts =
        scenario === "requests"
          ? Array.from({ length: 60 }, (_, i) => ({
              number: i + 1,
              estimatedCny: 0,
              status: "synthetic",
            }))
          : scenario === "money"
            ? [{ estimatedCny: 9.999, status: "synthetic" }]
            : [];
      const file = path.join(dir, "live-ledger.json");
      fs.writeFileSync(
        file,
        JSON.stringify({ maxRequests: 60, maxEstimatedCny: 10, attempts }),
      );
      const gate = await gateway({ live: true, configPath: config });
      try {
        const r = await fetch(
          gate.url + "/offline-budget-test/v1/chat/completions",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "qwen-plus",
              messages: [
                {
                  role: "user",
                  content:
                    scenario === "bytes"
                      ? "x".repeat(125000)
                      : "synthetic only",
                },
              ],
            }),
          },
        );
        assert.equal(r.status, 503);
        assert.equal(
          JSON.parse(fs.readFileSync(file, "utf8")).attempts.length,
          attempts.length,
        );
      } finally {
        await gate.close();
      }
    }
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.BEHAVIOR_EVIDENCE_DIR;
    else process.env.BEHAVIOR_EVIDENCE_DIR = previous;
  }
  assert.equal(outbound, 0);
});
