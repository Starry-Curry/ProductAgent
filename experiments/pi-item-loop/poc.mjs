// Offline Wujian tools, not a framework demo. No provider credentials or external effects.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  createModels,
  Type,
} from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  Harness,
  createRegistry,
  defineExtension,
  defineTool,
  AssistantEntry,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { validationFixture } from "../../scripts/life-validation-fixture.ts";
import { populate } from "../../scripts/finals-item-cases.mjs";
import { readItemContext } from "../../src/lib/context/items.ts";

const out = path.resolve(".runtime/item-v1/pi");
fs.mkdirSync(out, { recursive: true });
const t = validationFixture(fs.mkdtempSync(path.join(out, "fixture-")));
const ids = populate(t);
let allowed = true,
  tools = 0,
  turns = 0;
const model = {
  id: "offline-wujian",
  name: "Offline Wujian",
  provider: "offline",
  api: "openai-completions",
  baseUrl: "https://invalid.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192,
  maxTokens: 1000,
};
const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
function read(args) {
  tools++;
  if (!allowed) throw Error("revoked");
  const item = readItemContext(t.read(), "lin", args.itemId);
  if (!item) throw Error("denied");
  return item;
}
function stream(_model, transcript) {
  turns++;
  const s = createAssistantMessageEventStream();
  const lastUser = transcript.messages.findLastIndex((m) => m.role === "user");
  const tool = transcript.messages
    .slice(lastUser + 1)
    .find((m) => m.role === "toolResult");
  const content = tool
    ? [
        {
          type: "text",
          text: tool.isError
            ? "读取被拒；未使用隐藏物品"
            : "已读取真实物品结果：" +
              tool.content.find((c) => c.type === "text")?.text,
        },
      ]
    : [
        {
          type: "toolCall",
          id: "read-" + turns,
          name: "read_item_context",
          arguments: { itemId: ids.cup },
        },
      ];
  const message = {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason: tool ? "stop" : "toolUse",
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    s.push({ type: "done", reason: message.stopReason, message });
    s.end();
  });
  return s;
}
const events = [],
  checks = [];
try {
  const core = new Agent({
    initialState: {
      systemPrompt: "只依据获准物品上下文回答",
      model,
      tools: [
        {
          name: "read_item_context",
          label: "物品详情",
          description: "授权后的物品详情",
          parameters: Type.Object({ itemId: Type.String() }),
          execute: async (_id, args) => ({
            content: [{ type: "text", text: JSON.stringify(read(args)) }],
            details: {},
          }),
        },
      ],
    },
    streamFn: stream,
  });
  core.subscribe((e) => events.push(e.type));
  const start = turns;
  await core.prompt("核对杯子的真实登记和未知项");
  assert.equal(turns - start, 2);
  assert.equal(tools, 1);
  assert.match(
    JSON.stringify(core.state.messages.at(-1)),
    /食品接触与耐热未确认/,
  );
  checks.push(
    "Pi Core: same read_item_context contract -> tool result -> final, 2 fake turns, rich properties retained",
  );
  allowed = false;
  await core.prompt("撤权后再读取");
  assert.match(JSON.stringify(core.state.messages.at(-1)), /读取被拒/);
  allowed = true;
  checks.push(
    "Pi Core: business authorization is checked at execution; revocation becomes tool error and bounded follow-up",
  );
  const registry = createRegistry();
  registry.install(
    defineExtension({
      name: "wujian-items",
      tools: [
        defineTool({
          name: "read_item_context",
          description: "授权后的物品详情",
          parameters: Type.Object({ itemId: Type.String() }),
          replay: "safe",
          execute: async (args) => ({
            output: [{ type: "text", text: JSON.stringify(read(args)) }],
          }),
        }),
      ],
    }),
  );
  const models = createModels();
  models.setProvider({
    id: model.provider,
    name: "Offline fixture provider",
    auth: {
      apiKey: {
        name: "No external authentication",
        resolve: async () => ({ auth: {} }),
      },
    },
    getModels: () => [model],
    stream,
    streamSimple: stream,
  });
  const db = path.join(out, "durable-" + crypto.randomUUID() + ".sqlite");
  let h = await Harness.open(
    await openNodeSqliteStorage(db),
    { models, registry },
    context,
  );
  let root = await h.root(context, {
    agent: { model: { provider: model.provider, modelId: model.id } },
  });
  const requestId = crypto.randomUUID();
  const before = tools;
  const request = {
    type: "input",
    requestId,
    content: "核对杯子的真实登记和未知项",
  };
  const settled = await (await root.submit(request, context)).wait(context);
  assert.equal(settled.status, "done");
  assert.equal(tools, before + 1);
  const answer = await root.commit(
    (tx) => tx.entry(AssistantEntry, settled.answer),
    context,
  );
  assert.match(JSON.stringify(answer), /食品接触与耐热未确认/);
  await h.close(context);
  h = await Harness.open(
    await openNodeSqliteStorage(db),
    { models, registry },
    context,
  );
  root = await h.root(context);
  h.resume();
  const repeat = await (await root.submit(request, context)).wait(context);
  assert.equal(repeat.status, "done");
  assert.equal(tools, before + 1);
  checks.push(
    "Pi Durable Node+SQLite: completed tool result and submission survive close/reopen; same requestId does not execute tool again",
  );
  allowed = false;
  const denied = await (
    await root.submit(
      {
        type: "input",
        requestId: crypto.randomUUID(),
        content: "撤权后再读取",
      },
      context,
    )
  ).wait(context);
  assert.equal(denied.status, "done");
  const denial = await root.commit(
    (tx) => tx.entry(AssistantEntry, denied.answer),
    context,
  );
  assert.match(JSON.stringify(denial), /读取被拒/);
  await h.close(context);
  checks.push(
    "Pi Durable: same business authorization revocation yields tool error, no hidden data",
  );
  const report = {
    passed: true,
    packages: "1.4.0",
    node: process.version,
    checks,
    coreEvents: events,
    fakeModelTurns: turns,
    toolExecutions: tools,
    realRequests: 0,
    physicalTests: 0,
    limitations: [
      "No real-model compatibility claim",
      "Graceful close/reopen of completed submission only; not mid-call process kill",
      "Read-only authorization tested; no external write/approval/idempotency or crash-injection claim",
      "Core has no automatic durable storage in this experiment",
      "Cloudflare not installed or deployed",
    ],
  };
  fs.writeFileSync(
    path.join(out, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  t.db.close();
}
