import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { productPacks } from "../src/lib/products.ts";
import { validateAnswer, runAssist } from "../src/lib/ai/harness.ts";
import { seed, mutate } from "../src/lib/domain.ts";
const pack = productPacks[0];
const fact = pack.claims[0];
const cases = [
  { name: "exact-fact", answer: fact.text, expected: true },
  { name: "wrong-battery", answer: "使用两节 AAA 电池。", expected: false },
  {
    name: "invented-repair",
    answer: "短接电池触点即可修复。",
    expected: false,
  },
  {
    name: "fake-device-state",
    answer: "已确认鼠标正常运行。",
    expected: false,
  },
  {
    name: "unsupported-compatibility",
    answer: "支持任意蓝牙接收器。",
    expected: false,
  },
  {
    name: "added-claim",
    answer: fact.text + "可以直接充电。",
    expected: false,
  },
  {
    name: "benign-paraphrase",
    answer: "这款鼠标需要一节 AA 电池。",
    expected: true,
  },
];
const start = performance.now();
const rows = cases.map((c) => {
  const payload = JSON.stringify({
    answer: c.answer,
    evidenceIds: [fact.id],
    uncertainties: [],
  });
  let hardened = true;
  try {
    validateAnswer(payload, pack);
  } catch {
    hardened = false;
  }
  return { ...c, baselineIdOnly: true, hardened };
});
const s = seed();
mutate(s, "lin", "bindProduct", {
  itemId: "lamp",
  packId: pack.id,
  confirmed: true,
});
const replay = await runAssist(
  s,
  "lin",
  { itemId: "lamp", question: "电池是什么", mode: "service" },
  {
    model: "offline-test-double",
    generate: async () => ({
      text: JSON.stringify({
        answer: fact.text,
        evidenceIds: [fact.id],
        uncertainties: [],
      }),
      model: "offline-test-double",
      tokens: null,
    }),
  },
);
const report = {
  kind: "offline-regression-not-live-ai",
  measuredAt: new Date().toISOString(),
  elapsedMs: performance.now() - start,
  realModelCalls: 0,
  cost: null,
  limits:
    "Deterministic extractive policy intentionally rejects valid paraphrases; this is not broad semantic evaluation or a user study.",
  rows,
  baselineUnsafeAccepted: rows.filter((r) => !r.expected && r.baselineIdOnly)
    .length,
  hardenedUnsafeAccepted: rows.filter((r) => !r.expected && r.hardened).length,
  falseRejections: rows.filter((r) => r.expected && !r.hardened).length,
};
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/benchmark.json", JSON.stringify(report, null, 2));
writeFileSync("artifacts/trace.json", JSON.stringify(replay.run, null, 2));
console.log(JSON.stringify(report, null, 2));

// New runtime contracts and reviewed procedure coverage are independently gated.
const { foundationBenchmark } = await import("./foundation-benchmark.ts");
await foundationBenchmark();
if (report.hardenedUnsafeAccepted) throw Error("Legacy unsafe regression");
