// Reproduce audit findings without any model network requests or product fixes.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validationFixture } from "./life-validation-fixture.ts";
import { respond } from "../src/lib/agent/service.ts";
import { planDiscovery } from "../src/lib/life/planning.ts";
const out = path.resolve(".runtime/audit-20261029");
mkdirSync(out, { recursive: true });
process.env.AI_ALLOW_PAID_CALLS = "false";
process.env.WUJIAN_ALLOW_PAID_CALLS = "false";
process.env.WUJIAN_ALLOW_PUBLIC_FETCH = "false";
process.env.WUJIAN_ALLOW_SEARCH = "false";
const t = validationFixture(mkdtempSync(path.join(out, "diagnostic-")));
const cup = t.add("无盖不锈钢水杯", "水杯", "未知", "未知", {
  attributes: {
    quantity: 1,
    material: "单层不锈钢",
    capabilities: ["容纳常温物品"],
  },
});
const results = [];
try {
  for (const mode of ["local-demo", "public-demo"]) {
    process.env.AUTH_MODE = mode;
    let calls = 0;
    let toolPayload;
    const provider = {
      model: "offline-tool-fixture",
      ready: true,
      generate: async () => {
        throw Error("Unexpected generate");
      },
      complete: async (messages) => {
        calls++;
        const tool = messages.find((m) => m.role === "tool");
        if (!tool)
          return {
            text: "",
            toolCalls: [
              {
                id: "audit-call",
                type: "function",
                function: { name: "list_accessible_items", arguments: "{}" },
              },
            ],
            finishReason: "tool_calls",
            model: "offline-tool-fixture",
            tokens: null,
          };
        toolPayload = JSON.parse(tool.content);
        return {
          text: JSON.stringify({
            kind: "general",
            answer: "已核对登记物品。",
            factIds: [],
            procedureId: null,
            questions: [],
          }),
          toolCalls: [],
          finishReason: "stop",
          model: "offline-tool-fixture",
          tokens: null,
        };
      },
    };
    const result = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        mode: "auto",
        memoryPolicy: "off",
        question: "今天很累，先看看我的登记再聊聊。",
        uiContext: { page: "assistant" },
      },
      provider,
    );
    assert.equal(calls, mode === "public-demo" ? 1 : 2);
    assert.equal(
      result.reply.outcome,
      mode === "public-demo" ? "referred" : "answered",
    );
    if (toolPayload)
      assert.ok(
        toolPayload.every(
          (i) => !("attributes" in i) && !("availability" in i),
        ),
      );
    results.push({
      probe: "tool-round-trip",
      mode,
      providerCalls: calls,
      outcome: result.reply.outcome,
      trace: result.trace,
      toolPayload,
    });
  }
  process.env.AUTH_MODE = "local-demo";
  for (const phrase of ["只用我已登记的物品", "利用现有物品"]) {
    let calls = 0;
    const p = {
      model: "offline-counting-fixture",
      ready: true,
      generate: async () => {
        calls++;
        throw Error("Probe reached provider; no network");
      },
    };
    let result, error;
    try {
      result = await planDiscovery(
        t.db,
        t.read(),
        "lin",
        {
          goal: "想做个有趣玩法，" + phrase + "，不买东西",
          model: true,
          publicEvidence: false,
          candidates: 1,
        },
        p,
        t.read,
      );
    } catch (e) {
      error = e.message;
    }
    assert.equal(calls, phrase.startsWith("只用") ? 0 : 1);
    results.push({
      probe: "inventory-reference-phrase",
      phrase,
      providerCalls: calls,
      missing: result?.missing,
      source: result?.source,
      error,
    });
  }
  const integrity = t.db.prepare("PRAGMA integrity_check").get();
  assert.equal(integrity.integrity_check, "ok");
  const report = {
    kind: "offline-reproduction-not-live-provider-or-public-http",
    at: new Date().toISOString(),
    realModelCalls: 0,
    fixtureItemId: cup,
    results,
    integrity,
  };
  writeFileSync(
    path.join(out, "offline-diagnostics.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  t.db.close();
  process.env.AUTH_MODE = "local-demo";
}
