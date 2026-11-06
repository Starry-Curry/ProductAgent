import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { seed, mutate } from "../src/lib/domain.ts";
import { migrate } from "../src/lib/migrations.ts";
import { boundPack, validateAnswer } from "../src/lib/ai/harness.ts";
import { buildContext } from "../src/lib/context/builder.ts";
import { validateModelPacket } from "../src/lib/agent/graph.ts";
import { respond } from "../src/lib/agent/service.ts";
import { createProvider } from "../src/lib/ai/provider.ts";
export async function foundationBenchmark() {
  const file = path.join(
      mkdtempSync(path.join(tmpdir(), "wujian-ablation-")),
      "eval.sqlite",
    ),
    db = new DatabaseSync(file);
  db.exec("CREATE TABLE workspace(id INTEGER PRIMARY KEY,body TEXT)");
  const state = seed();
  mutate(state, "lin", "bindProduct", {
    itemId: "lamp",
    packId: "logitech-m185-m-r0061",
    confirmed: true,
  });
  db.prepare("INSERT INTO workspace VALUES(1,?)").run(JSON.stringify(state));
  migrate(db, file);
  try {
    const pack = boundPack(state.items.find((i) => i.id === "lamp")!)!,
      fact = pack.claims[0];
    const cases = [
      {
        name: "natural-summary-selected-fact",
        question: "电池规格",
        kind: "supported",
        answer: "需要一节 AA 电池。",
        ids: [fact.id],
        expected: true,
      },
      {
        name: "unrelated-valid-id",
        question: "怎么调双击速度",
        kind: "supported",
        answer: fact.text,
        ids: [fact.id],
        expected: false,
      },
      {
        name: "invented-long-press",
        question: "电池规格",
        kind: "general",
        answer: "长按配对键八秒即可。",
        ids: [],
        expected: false,
      },
      {
        name: "invented-hardware-state",
        question: "电池规格",
        kind: "general",
        answer: "已经确认正常。",
        ids: [],
        expected: false,
      },
      {
        name: "invented-common-history",
        question: "电池规格",
        kind: "general",
        answer: "我记得我们一起修好了它。",
        ids: [],
        expected: false,
      },
      {
        name: "unsupported-any-receiver",
        question: "兼容接收器",
        kind: "general",
        answer: "兼容任意接收器。",
        ids: [],
        expected: false,
      },
      {
        name: "ordinary-general-help",
        question: "如何把问题描述清楚",
        kind: "general",
        answer: "可以先说想完成什么，再描述现在看到的现象。",
        ids: [],
        expected: true,
      },
    ];
    const rows = cases.map((c) => {
      let oldAccepted = true,
        newAccepted = true;
      try {
        validateAnswer(
          JSON.stringify({
            answer: c.answer,
            evidenceIds: c.ids.length ? c.ids : [fact.id],
            uncertainties: [],
          }),
          pack,
        );
      } catch {
        oldAccepted = false;
      }
      try {
        validateModelPacket(
          JSON.stringify({
            kind: c.kind,
            answer: c.answer,
            factIds: c.ids,
            procedureId: null,
            questions: [],
          }),
          buildContext(db, state, "lin", {
            question: c.question,
            mode: "service",
            itemId: "lamp",
          }),
          "service",
        );
      } catch {
        newAccepted = false;
      }
      return { ...c, idOnlyFixtureAccepted: true, oldAccepted, newAccepted };
    });
    const off = createProvider({ AI_ALLOW_PAID_CALLS: "false" });
    const first = await respond(
      db,
      () => state,
      "lin",
      { question: "怎么调双击速度", requestId: crypto.randomUUID() },
      off,
    );
    const next = await respond(
      db,
      () => state,
      "lin",
      {
        question: "Windows 11",
        sessionId: first.session.id,
        requestId: crypto.randomUUID(),
      },
      off,
    );
    const setup = await respond(
      db,
      () => state,
      "lin",
      {
        itemId: "lamp",
        question: "首次怎么用",
        requestId: crypto.randomUUID(),
      },
      off,
    );
    const ready = await respond(
      db,
      () => state,
      "lin",
      {
        itemId: "lamp",
        sessionId: setup.session.id,
        question: "有原配接收器",
        requestId: crypto.randomUUID(),
      },
      off,
    );
    const coverage = {
      productIntroFactCount: pack.claims.length,
      productIntroProcedureCount: 0,
      reviewedProcedureCount: 2,
      unknownItemCanAskNecessaryQuestion: first.reply.outcome === "needs_info",
      windows11StepsAfterClarification: next.reply.steps.length,
      m185StepsAfterReceiverConfirmation: ready.reply.steps.length,
      realModelCalls: 0,
    };
    const regressions =
      rows.filter((r) => r.newAccepted !== r.expected).length +
      (coverage.windows11StepsAfterClarification === 3 ? 0 : 1) +
      (coverage.m185StepsAfterReceiverConfirmation === 3 ? 0 : 1);
    const report = {
      kind: "offline-contract-and-curated-coverage-ablation",
      measuredAt: new Date().toISOString(),
      realModelCalls: 0,
      cost: null,
      limits:
        "Synthetic fixtures compare an intentionally weak ID checker, the existing extractive validator, and new contracts. Not a live-model/competitor accuracy estimate. Regex checks are not a semantic safety proof.",
      rows,
      coverage,
      regressions,
    };
    mkdirSync("artifacts", { recursive: true });
    writeFileSync(
      "artifacts/foundation-benchmark.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
    if (regressions) throw Error("Foundation benchmark regression");
    return report;
  } finally {
    db.close();
  }
}
