// Each invocation is a fresh process. Only synthetic local SQLite writes.
import path from "node:path";
import { createHash } from "node:crypto";
import {
  Annotation,
  StateGraph,
  START,
  END,
  interrupt,
  Command,
} from "@langchain/langgraph";
import { SqliteCheckpointer } from "../../src/lib/agent/checkpointer.ts";
import { fixture, toolsFor, root } from "./shared.mjs";

const [arm, phase, runKey, crashFlag] = process.argv.slice(2);
const t = fixture("workflow-data-v2"),
  domain = toolsFor(t, arm),
  crash = crashFlag === "crash";
let output;
try {
  if (arm === "langgraph") {
    const S = Annotation.Root({
      key: Annotation(),
      item: Annotation(),
      result: Annotation(),
    });
    const graph = new StateGraph(S)
      .addNode("read", (s) => ({ item: domain.read({ itemId: "box" }) }))
      .addNode("approval", () => {
        if (!interrupt({ action: "save_explicit_preference" }))
          throw Error("not_approved");
        return {};
      })
      .addNode("write", (s) => ({ result: domain.commit(s.key, crash) }))
      .addEdge(START, "read")
      .addEdge("read", "approval")
      .addEdge("approval", "write")
      .addEdge("write", END)
      .compile({ checkpointer: new SqliteCheckpointer(t.db) });
    const config = { configurable: { thread_id: runKey } };
    output =
      phase === "start"
        ? await graph.invoke({ key: runKey }, config)
        : await graph.invoke(new Command({ resume: true }), config);
  } else if (arm === "mastra") {
    const [{ Mastra }, { createWorkflow, createStep }, { LibSQLStore }, { z }] =
      await Promise.all([
        import("@mastra/core/mastra"),
        import("@mastra/core/workflows"),
        import("@mastra/libsql"),
        import("zod"),
      ]);
    const schema = z.object({ key: z.string() });
    const read = createStep({
      id: "read",
      inputSchema: schema,
      outputSchema: schema,
      execute: async ({ inputData }) => {
        domain.read({ itemId: "box" });
        return inputData;
      },
    });
    const approval = createStep({
      id: "approval",
      inputSchema: schema,
      outputSchema: schema,
      resumeSchema: z.object({ approved: z.boolean() }),
      execute: async ({ inputData, resumeData, suspend }) => {
        if (!resumeData?.approved)
          return suspend({ action: "save_explicit_preference" });
        return inputData;
      },
    });
    const write = createStep({
      id: "write",
      inputSchema: schema,
      outputSchema: z.any(),
      execute: async ({ inputData }) => domain.commit(inputData.key, crash),
    });
    const workflow = createWorkflow({
      id: "wujian-lab",
      inputSchema: schema,
      outputSchema: z.any(),
      options: { shouldPersistSnapshot: () => true },
    })
      .then(read)
      .then(approval)
      .then(write)
      .commit();
    const storage = new LibSQLStore({
      id: "workflow-store",
      url:
        "file:" +
        path.join(root, "mastra-workflow.sqlite").replaceAll("\\", "/"),
    });
    const mastra = new Mastra({
      storage,
      workflows: { wujian: workflow },
      logger: false,
    });
    const run = await mastra.getWorkflow("wujian").createRun({ runId: runKey });
    const snapshot = await workflow.getWorkflowRunById(runKey);
    if (phase === "start")
      output = await run.start({ inputData: { key: runKey } });
    else if (snapshot?.status === "success") output = snapshot;
    else if (snapshot?.status === "suspended")
      output = await run.resume({
        step: "approval",
        resumeData: { approved: true },
      });
    else {
      const deadline = Date.now() + 30000;
      let waits = 0;
      while (true) {
        try {
          output = await run.restart();
          break;
        } catch (error) {
          if (!/ownership lease/.test(error.message) || Date.now() >= deadline)
            throw error;
          waits++;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      output = { ...output, hostLeaseWaits: waits };
    }
  } else if (arm === "pi-durable") {
    const [
      { Harness, createRegistry, defineExtension, defineTask },
      { openNodeSqliteStorage },
      { BACKGROUND_CONTEXT: context },
      { createModels },
    ] = await Promise.all([
      import("@earendil-works/pi-durable"),
      import("@earendil-works/pi-durable/storage/sqlite/node"),
      import("@earendil-works/chord/context"),
      import("@earendil-works/pi-ai"),
    ]);
    const Task = defineTask({
      name: "wujian.save-preference",
      version: 1,
      initial: () => ({ phase: "read" }),
      phases: {
        read: async (task, runtime, ctx) => {
          domain.read({ itemId: "box" });
          await runtime.commit(
            () => ({ status: "pending", checkpoint: { phase: "approval" } }),
            ctx,
          );
        },
        approval: async (task, runtime, ctx) => {
          const gate = t.db
            .prepare("SELECT * FROM lab_gate WHERE run_key=?")
            .get(task.input.key);
          if (!gate?.approved)
            return runtime.sleepUntil(
              Date.now() + 60000,
              { phase: "approval" },
              ctx,
            );
          if (gate.revoked) throw Error("authorization_denied");
          await runtime.commit(
            () => ({ status: "pending", checkpoint: { phase: "write" } }),
            ctx,
          );
        },
        write: async (task, runtime, ctx) => {
          const result = domain.commit(task.input.key, crash);
          await runtime.commit(
            () => ({
              status: "terminal",
              outcome: { status: "completed", result },
            }),
            ctx,
          );
        },
      },
      abort: (_task, runtime, ctx) =>
        runtime.commit(
          () => ({ status: "terminal", outcome: { status: "aborted" } }),
          ctx,
        ),
    });
    const registry = createRegistry();
    registry.install(defineExtension({ name: "wujian-tasks", tasks: [Task] }));
    const models = createModels();
    const storageFile = path.join(
      root,
      "pi-workflow-" +
        createHash("sha256").update(runKey).digest("hex").slice(0, 20) +
        ".sqlite",
    );
    const h = await Harness.open(
      await openNodeSqliteStorage(storageFile),
      {
        models,
        registry,
        now: () => Date.now() + (phase === "start" ? 0 : 120000),
      },
      context,
    );
    try {
      const conversation = await h.root(context);
      let taskId = t.db
        .prepare("SELECT task_id FROM lab_gate WHERE run_key=?")
        .get(runKey)?.task_id;
      if (!taskId) {
        taskId = await conversation.commit(
          (tx) =>
            tx.createTask(
              Task,
              { key: runKey },
              { ownership: { kind: "conversation" } },
            ),
          context,
        );
        t.db
          .prepare("UPDATE lab_gate SET task_id=? WHERE run_key=?")
          .run(taskId, runKey);
      }
      h.resume();
      const until = Date.now() + 8000;
      while (Date.now() < until) {
        const task = await h.getTask(taskId, context);
        if (
          task.state.status === "terminal" ||
          (phase === "start" && task.state.status === "sleeping")
        ) {
          output = task;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      if (!output) throw Error("task_timeout");
      console.log(
        "PROGRESS " +
          JSON.stringify({
            taskId,
            state: output.state.status,
            outcome: output.state.outcome?.status,
          }),
      );
    } finally {
      console.log("PROGRESS closing");
      await h.close(context);
      console.log("PROGRESS closed");
    }
  } else {
    // Pi Core has no native durable workflow: this is explicit host code.
    const old = t.db
      .prepare("SELECT * FROM lab_host_runs WHERE run_key=?")
      .get(runKey);
    if (!old) {
      domain.read({ itemId: "box" });
      t.db
        .prepare("INSERT INTO lab_host_runs VALUES(?,?,?)")
        .run(runKey, "approval", "{}");
    }
    if (phase === "start")
      output = { status: "suspended", implementation: "host-sqlite" };
    else if (old?.phase === "done") output = JSON.parse(old.body);
    else {
      output = domain.commit(runKey, crash);
      t.db
        .prepare("UPDATE lab_host_runs SET phase=?,body=? WHERE run_key=?")
        .run("done", JSON.stringify(output), runKey);
    }
  }
  console.log("RESULT " + JSON.stringify({ arm, phase, output }));
  t.db.close();
  process.exit(0);
} catch (error) {
  console.log("RESULT " + JSON.stringify({ arm, phase, error: error.message }));
  try {
    t.db.close();
  } catch {}
  process.exit(2);
}
