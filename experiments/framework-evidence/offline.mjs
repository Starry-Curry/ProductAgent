import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { arms, agentAnswer } from "./agents.mjs";
import { gateway } from "./gateway.mjs";
import {
  fixture,
  toolsFor,
  root,
  questions,
  facts,
  saveReport,
} from "./shared.mjs";

const results = [],
  details = [];
const only = process.argv.find((a) => a.startsWith("--arm="))?.slice(6);
const selectedArms = only ? arms.filter((a) => a === only) : arms;
if (!selectedArms.length) throw Error("unknown arm");
async function test(name, fn) {
  const start = performance.now();
  try {
    await fn();
    results.push({
      name,
      status: "passed",
      elapsedMs: Math.round(performance.now() - start),
    });
  } catch (error) {
    results.push({
      name,
      status: "failed",
      error: error.message,
      elapsedMs: Math.round(performance.now() - start),
    });
  }
  console.log(JSON.stringify(results.at(-1)));
}
const t = fixture(),
  tw = fixture("workflow-data-v2"),
  server = await gateway();
try {
  for (const arm of selectedArms) {
    for (const q of questions) {
      await test(arm + ":" + q.id, async () => {
        const before = server.traces.length;
        const answer = await agentAnswer(
          arm,
          server,
          q.text,
          toolsFor(t, arm, { failOnce: q.id === "failure" }),
          t,
        );
        const trace = server.traces.slice(before);
        details.push({ arm, case: q.id, answer, trace });
        assert(
          trace.length >= 2,
          "must consume a tool result in later model turn",
        );
        assert.match(answer.text, /未知|unknown/);
        if (q.id === "relationship") {
          assert.match(answer.text, /小夏/);
          assert.match(answer.text, /送/);
        }
        if (q.id === "unknown") assert.match(answer.text, /20×15×10/);
        if (q.id === "failure")
          assert(
            trace.some((turn) =>
              JSON.stringify(turn.input).includes("temporary_tool_failure"),
            ),
            "tool error must reach model",
          );
      });
    }
    await test(arm + ":shared-domain-read-denies-other-owner", () =>
      assert.throws(
        () => toolsFor(t, arm).read({ itemId: "hidden" }),
        /denied/,
      ),
    );
  }
  await test("existing-memory:cross-session-reopen-and-no-invented-detail", () => {
    const first = toolsFor(t, "memory").read({
      itemId: "painting",
    }).relationship;
    const reopened = fixture();
    try {
      const second = toolsFor(reopened, "memory2").read({
        itemId: "painting",
      }).relationship;
      assert.deepEqual(second, first);
      assert.equal(second[0].text, facts);
      assert(!/生日|旅行/.test(second[0].text));
    } finally {
      reopened.db.close();
    }
  });
  await test("mastra-memory:resource-scope-persists-across-threads-and-reopen", async () => {
    const url =
      "file:" + path.join(root, "mastra-memory.sqlite").replaceAll("\\", "/");
    const options = {
      lastMessages: 0,
      semanticRecall: false,
      workingMemory: {
        enabled: true,
        scope: "resource",
        template: "已明确报告的关系事实；未知细节保持未知。",
      },
    };
    let memory = new Memory({
      storage: new LibSQLStore({ id: "memory1", url }),
      options,
    });
    await memory.createThread({
      threadId: "a1",
      resourceId: "lin",
      title: "synthetic",
    });
    await memory.updateWorkingMemory({
      threadId: "a1",
      resourceId: "lin",
      workingMemory: facts,
    });
    memory = new Memory({
      storage: new LibSQLStore({ id: "memory2", url }),
      options,
    });
    await memory.createThread({
      threadId: "a2",
      resourceId: "lin",
      title: "synthetic",
    });
    assert.equal(
      await memory.getWorkingMemory({ threadId: "a2", resourceId: "lin" }),
      facts,
    );
    await memory.createThread({
      threadId: "other",
      resourceId: "dad",
      title: "synthetic",
    });
    assert.equal(
      await memory.getWorkingMemory({ threadId: "other", resourceId: "dad" }),
      null,
    );
    details.push({
      memory: "mastra",
      inputExplicitlyWrittenByHost: facts,
      automaticExtractionTested: false,
      semanticRecallEnabled: false,
    });
  });
  for (const arm of selectedArms) {
    const key = "workflow:" + arm + ":" + crypto.randomUUID();
    tw.db.prepare("INSERT INTO lab_gate(run_key) VALUES(?)").run(key);
    function worker(phase, crash = false, requestKey = key) {
      const child = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "experiments/framework-evidence/workflow-worker.mjs",
          arm,
          phase,
          requestKey,
          ...(crash ? ["crash"] : []),
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            AI_ALLOW_PAID_CALLS: "false",
            WUJIAN_ALLOW_PAID_CALLS: "false",
            LANGSMITH_TRACING: "false",
            OTEL_SDK_DISABLED: "true",
          },
          encoding: "utf8",
          timeout: 45000,
          windowsHide: true,
        },
      );
      const line = child.stdout
        ?.split(/\r?\n/)
        .find((l) => l.startsWith("RESULT "));
      const record = {
        arm,
        phase,
        crash,
        status: child.status,
        signal: child.signal,
        result: line ? JSON.parse(line.slice(7)) : null,
        stdout: child.stdout,
        stderr: child.stderr,
      };
      details.push(record);
      return record;
    }
    function completed(record) {
      assert.equal(record.status, 0, record.stdout + record.stderr);
      const out = record.result?.output;
      if (arm === "mastra") assert.equal(out?.status, "success");
      else if (arm === "pi-durable")
        assert.equal(out?.state?.outcome?.status, "completed");
      else
        assert(
          out?.result?.memoryId || out?.memoryId,
          "missing completion receipt",
        );
    }
    await test(arm + ":pause-before-authorization", () => {
      const r = worker("start");
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(
        tw.db
          .prepare(
            "SELECT count(*) n FROM lab_calls WHERE request_key=? AND tool='effect'",
          )
          .get(key).n,
        0,
      );
    });
    tw.db.prepare("UPDATE lab_gate SET approved=1 WHERE run_key=?").run(key);
    await test(arm + ":crash-after-domain-commit", () => {
      const r = worker("resume", true);
      assert.equal(r.status, 73, r.stdout + r.stderr);
      assert.equal(
        tw.db
          .prepare(
            "SELECT count(*) n FROM lab_calls WHERE request_key=? AND tool='effect'",
          )
          .get(key).n,
        1,
      );
    });
    await test(arm + ":restart-no-duplicate-effect", () => {
      completed(worker("resume"));
      assert.equal(
        tw.db
          .prepare(
            "SELECT count(*) n FROM lab_calls WHERE request_key=? AND tool='effect'",
          )
          .get(key).n,
        1,
      );
    });
    await test(arm + ":completed-operation-repeat", () => {
      completed(worker("resume"));
      assert.equal(
        tw.db
          .prepare(
            "SELECT count(*) n FROM lab_calls WHERE request_key=? AND tool='effect'",
          )
          .get(key).n,
        1,
      );
    });
    await test(arm + ":revocation-while-paused-blocks-write", () => {
      const deniedKey = key + ":revoked";
      tw.db.prepare("INSERT INTO lab_gate(run_key) VALUES(?)").run(deniedKey);
      assert.equal(worker("start", false, deniedKey).status, 0);
      tw.db
        .prepare("UPDATE lab_gate SET approved=1,revoked=1 WHERE run_key=?")
        .run(deniedKey);
      const record = worker("resume", false, deniedKey);
      assert.match(JSON.stringify(record.result), /authorization_denied/);
      assert.equal(
        tw.db
          .prepare(
            "SELECT count(*) n FROM lab_calls WHERE request_key=? AND tool='effect'",
          )
          .get(deniedKey).n,
        0,
      );
    });
  }
} finally {
  await server.close();
  const counts = t.db
    .prepare("SELECT arm,tool,count(*) count FROM lab_calls GROUP BY arm,tool")
    .all();
  counts.push(
    ...tw.db
      .prepare(
        "SELECT arm,tool,count(*) count FROM lab_calls GROUP BY arm,tool",
      )
      .all(),
  );
  t.db.close();
  tw.db.close();
  saveReport(
    path.join(
      root,
      only ? "offline-" + only + "-recheck.json" : "offline.json",
    ),
    {
      node: process.version,
      arms: selectedArms,
      startedFrom: "ea32c3f4c9e18992ca267b6dd74e26e418c9e95a",
      passed: results.filter((r) => r.status === "passed").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
      counts,
      details,
      realRequests: 0,
      physicalTests: 0,
      limitations: [
        "Scripted model tests plumbing, not semantic intelligence",
        "LangGraph arm is a minimal harness with current package/provider/checkpointer, not the full product graph",
        "All arms reuse domain authorization/idempotency; these are not framework guarantees",
        "Mastra memory explicitly written by host; no automatic relationship extraction claim",
        "Pi Core workflow persistence implemented by host",
        "Pi Durable approval uses host grant plus durable sleep and an advancing clock with a test-only offset",
      ],
    },
  );
}
process.exitCode = results.some((r) => r.status === "failed") ? 1 : 0;
// Optional native handles from libSQL may outlive the completed test driver.
setTimeout(() => process.exit(process.exitCode), 100).unref();
