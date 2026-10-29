// Explicitly authorized guarded live comparison. Credentials stay in gateway memory.
import path from "node:path";
import { arms, agentAnswer } from "./agents.mjs";
import { gateway } from "./gateway.mjs";
import { fixture, toolsFor, root, questions, saveReport } from "./shared.mjs";
import { createProvider } from "../../src/lib/ai/provider.ts";
import { respond } from "../../src/lib/agent/service.ts";

if (!process.argv.includes("--live-max=60-cny=20"))
  throw Error("Explicit task cap flag required");
const configPath = process.argv
  .find((a) => a.startsWith("--config="))
  ?.slice(9);
const stage =
  process.argv.find((a) => a.startsWith("--stage="))?.slice(8) ||
  "framework-and-main";
const responder =
  stage === "main-ui-baseline"
    ? (await import("../../.runtime/main-source/src/lib/agent/service.ts"))
        .respond
    : respond;
const t = fixture();
let server;
try {
  server = await gateway({ live: true, configPath });
} catch (error) {
  saveReport(path.join(root, "live-blocker.json"), {
    stage,
    error: error.message,
    requestsSent: 0,
  });
  console.error("真实模型阻塞：" + error.message);
  t.db.close();
  process.exit(2);
}
const rows = [];
try {
  if (stage === "framework-and-main" || stage === "framework-recheck") {
    for (const arm of arms)
      for (const q of questions.filter(
        (q) => stage !== "framework-recheck" || q.id === "unknown",
      )) {
        const start = performance.now(),
          before = server.ledger.attempts.length,
          traceStart = server.traces.length;
        let row = { arm, case: q.id, input: q.text };
        try {
          const answer = await agentAnswer(
            arm,
            server,
            q.text,
            toolsFor(t, "live:" + arm, { failOnce: q.id === "failure" }),
            t,
          );
          const text = answer.text || "";
          const traces = server.traces.slice(traceStart);
          row = {
            ...row,
            returned: true,
            answer,
            checks: {
              toolResultRoundTrip:
                traces.length >= 2 &&
                traces.some((r) => r.input.some((m) => m.role === "tool")),
              unknownExpressed:
                /未知|未(?:知|登记|确认|记录|提供)|不(?:确定|清楚)|无法确定/.test(
                  text,
                ),
              explicitGiftPresent:
                q.id === "relationship"
                  ? /小夏/.test(text) && /送|赠/.test(text)
                  : null,
            },
            note: "Rule checks are not human quality judgments",
          };
        } catch (error) {
          row = { ...row, returned: false, error: error.message };
        }
        rows.push({
          ...row,
          requestCount: server.ledger.attempts.length - before,
          elapsedMs: Math.round(performance.now() - start),
        });
        console.log(
          JSON.stringify({
            arm,
            case: q.id,
            ...rows.at(-1).checks,
            error: row.error,
            requestCount: rows.at(-1).requestCount,
          }),
        );
      }
  }
  if (stage !== "framework-recheck") {
    const provider = createProvider(
      {
        AI_BASE_URL: "https://fixture.invalid/v1",
        AI_API_KEY: "fixture-only",
        AI_MODEL: server.model,
        AI_ALLOW_PAID_CALLS: "true",
        AI_ENABLE_THINKING: "false",
        AI_JSON_MODE: "true",
      },
      (_url, init) =>
        fetch(server.url + "/" + stage + "/v1/chat/completions", init),
    );
    for (const [id, itemId, question] of [
      [
        "painting",
        "painting",
        "你记得这幅画是谁送给我的吗？只说明确记录，不要编造日期和经历。",
      ],
      [
        "box",
        "box",
        "只用我登记的物品，旧纸盒有什么具体新用途？结合我喜欢安静手工和讲故事的偏好，不买东西、不加热、不碰水、不裁切。",
      ],
    ]) {
      const before = server.ledger.attempts.length,
        start = performance.now();
      try {
        const result = await responder(
          t.db,
          t.read,
          "lin",
          {
            requestId: crypto.randomUUID(),
            itemId,
            question,
            mode: "auto",
            uiContext: { page: "assistant" },
          },
          provider,
        );
        rows.push({
          arm: stage,
          case: id,
          input: question,
          returned: true,
          result,
          requestCount: server.ledger.attempts.length - before,
          elapsedMs: Math.round(performance.now() - start),
        });
      } catch (error) {
        rows.push({
          arm: stage,
          case: id,
          input: question,
          returned: false,
          error: error.message,
          requestCount: server.ledger.attempts.length - before,
        });
      }
      console.log(
        JSON.stringify({
          arm: stage,
          case: id,
          returned: rows.at(-1).returned,
          requestCount: rows.at(-1).requestCount,
        }),
      );
    }
  }
} finally {
  await server.close();
  t.db.close();
  saveReport(path.join(root, "live-" + stage + ".json"), {
    stage,
    rows,
    model: server.model,
    totalTaskAttempts: server.ledger.attempts.length,
    estimatedCny: server.ledger.attempts.reduce(
      (s, a) => s + a.estimatedCny,
      0,
    ),
    transport:
      "All frameworks use loopback budget gateway; real upstream is existing Bailian chat/completions non-streaming, gateway adapts response to SSE for streaming SDKs. Native upstream SSE not tested.",
    physicalTests: 0,
    humanBlindEvaluation: false,
  });
}
setTimeout(() => process.exit(0), 100).unref();
