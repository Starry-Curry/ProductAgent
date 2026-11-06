import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { seed, mutate } from "../src/lib/domain.ts";
import { runAssist } from "../src/lib/ai/harness.ts";
import { createProvider } from "../src/lib/ai/provider.ts";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());
if (
  process.env.LIVE_SMOKE_APPROVED !== "3-public-cases" ||
  process.env.AI_ALLOW_PAID_CALLS !== "true"
)
  throw Error(
    "未获得限定测试授权：不会发送请求。确认后在本地设置 LIVE_SMOKE_APPROVED=3-public-cases 和 AI_ALLOW_PAID_CALLS=true。",
  );
for (const key of ["AI_BASE_URL", "AI_API_KEY", "AI_MODEL"])
  if (!process.env[key]) throw Error(`${key} 未配置：不会发送请求。`);
const cases = [
  ["logitech-m185-m-r0061", "电池规格是什么？"],
  ["jbl-go4", "蓝牙版本是什么？"],
  ["ikea-raskog-30629711", "承重限制是什么？"],
];
const runs = [];
for (const [packId, question] of cases) {
  const s = seed();
  mutate(s, "lin", "bindProduct", { itemId: "lamp", packId, confirmed: true });
  const result = await runAssist(
    s,
    "lin",
    { itemId: "lamp", question, mode: "service" },
    createProvider(),
  );
  runs.push(result.run);
  console.log(
    JSON.stringify({
      packId,
      status: result.run.status,
      latencyMs: result.run.latencyMs,
      tokens: result.run.tokens,
      error: result.run.errorCode,
    }),
  );
}
mkdirSync("artifacts", { recursive: true });
writeFileSync(
  "artifacts/live-smoke.json",
  JSON.stringify(
    {
      kind: "live-api",
      runs,
      cost: null,
      note: "费用待按账户与模型账单核对；没有实物操作测试。",
    },
    null,
    2,
  ),
);
if (runs.some((r) => r.status !== "succeeded")) process.exitCode = 1;
