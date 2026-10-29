import path from "node:path";
import { Agent as MastraAgent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent as PiAgent } from "@earendil-works/pi-agent-core";
import { Type, createModels } from "@earendil-works/pi-ai";
import {
  stream,
  streamSimple,
} from "@earendil-works/pi-ai/api/openai-completions";
import {
  Harness,
  createRegistry,
  defineExtension,
  defineTool,
  AssistantEntry,
  section,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { z } from "zod";
import { createProvider } from "../../src/lib/ai/provider.ts";
import { SqliteCheckpointer } from "../../src/lib/agent/checkpointer.ts";
import { system, root } from "./shared.mjs";

export const arms = ["langgraph", "mastra", "pi-core", "pi-durable"];
export function piModels(url, modelId) {
  const model = {
    id: modelId,
    name: modelId,
    provider: "wujian-lab",
    api: "openai-completions",
    baseUrl: url,
    reasoning: false,
    input: ["text"],
    cost: { input: 0.8, output: 2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
    maxTokens: 900,
    compat: {
      supportsDeveloperRole: false,
      supportsStore: false,
      maxTokensField: "max_tokens",
    },
  };
  const models = createModels();
  models.setProvider({
    id: model.provider,
    name: "Wujian guarded gateway",
    auth: {
      apiKey: {
        name: "Local synthetic gateway",
        resolve: async () => ({ auth: { apiKey: "fixture-only" } }),
      },
    },
    getModels: () => [model],
    stream,
    streamSimple,
  });
  return { models, model };
}
export async function agentAnswer(arm, server, question, domain, t) {
  const url = server.url + "/" + arm + "/v1";
  if (arm === "mastra") {
    const provider = createOpenAICompatible({
      name: "wujian-lab",
      baseURL: url,
      apiKey: "fixture-only",
    });
    const tool = createTool({
      id: "read_item",
      description: "读取已授权登记物品、关系和未知项",
      inputSchema: z.object({ itemId: z.string() }),
      execute: async (args) => domain.read(args),
    });
    const agent = new MastraAgent({
      id: "wujian-read",
      name: "物间实验",
      instructions: system,
      model: provider.chatModel(server.model),
      tools: { read_item: tool },
    });
    const result = await agent.generate(question, {
      maxSteps: 4,
      maxRetries: 0,
      modelSettings: { temperature: 0.2, maxOutputTokens: 900 },
    });
    return { text: result.text, steps: result.steps?.length };
  }
  const { models, model } = piModels(url, server.model);
  if (arm === "pi-core") {
    const agent = new PiAgent({
      initialState: {
        systemPrompt: system,
        model,
        tools: [
          {
            name: "read_item",
            label: "读取物品",
            description: "读取获准的物品、关系和未知",
            parameters: Type.Object({ itemId: Type.String() }),
            execute: async (_id, args) => ({
              content: [
                { type: "text", text: JSON.stringify(domain.read(args)) },
              ],
              details: {},
            }),
          },
        ],
      },
      streamFn: (m, c, o) =>
        models.streamSimple(m, c, { ...o, maxTokens: 900, temperature: 0.2 }),
    });
    await agent.prompt(question);
    return {
      text: agent.state.messages
        .at(-1)
        ?.content.filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n"),
      messages: agent.state.messages.length,
    };
  }
  if (arm === "pi-durable") {
    const registry = createRegistry();
    registry.install(
      defineExtension({
        name: "wujian",
        sections: [section("wujian-policy", () => system, { tag: false })],
        tools: [
          defineTool({
            name: "read_item",
            description: "读取获准的物品、关系和未知",
            parameters: Type.Object({ itemId: Type.String() }),
            replay: "safe",
            execute: async (args) => ({
              output: [
                { type: "text", text: JSON.stringify(domain.read(args)) },
              ],
            }),
          }),
        ],
      }),
    );
    const h = await Harness.open(
      await openNodeSqliteStorage(
        path.join(root, "pi-agent-" + crypto.randomUUID() + ".sqlite"),
      ),
      { models, registry, settings: { compaction: { enabled: false } } },
      context,
    );
    try {
      const conversation = await h.root(context, {
        agent: { model: { provider: model.provider, modelId: model.id } },
      });
      const settled = await (
        await conversation.submit(
          { type: "input", requestId: crypto.randomUUID(), content: question },
          context,
        )
      ).wait(context);
      const answer =
        settled.status === "done"
          ? await conversation.commit(
              (tx) => tx.entry(AssistantEntry, settled.answer),
              context,
            )
          : settled;
      return { text: JSON.stringify(answer), status: settled.status };
    } finally {
      await h.close(context);
    }
  }
  // Current LangGraph package + actual Wujian SQLite saver/provider; a minimal
  // runtime contract, not a claim that main's full product graph behaves identically.
  const provider = createProvider(
    {
      AI_BASE_URL: "https://fixture.invalid/v1",
      AI_API_KEY: "fixture-only",
      AI_MODEL: server.model,
      AI_ALLOW_PAID_CALLS: "true",
    },
    (_url, init) => fetch(url + "/chat/completions", init),
  );
  const State = Annotation.Root({
    messages: Annotation({
      reducer: (_old, value) => value,
      default: () => [],
    }),
    round: Annotation({ default: () => 0, reducer: (_old, value) => value }),
  });
  const definition = [
    {
      type: "function",
      function: {
        name: "read_item",
        description: "读取获准物品、关系与未知",
        parameters: {
          type: "object",
          properties: { itemId: { type: "string" } },
          required: ["itemId"],
          additionalProperties: false,
        },
      },
    },
  ];
  const graph = new StateGraph(State)
    .addNode("model", async (state) => {
      if (state.round >= 4) throw Error("round_budget");
      const result = await provider.complete(state.messages, definition, {
        timeoutMs: 45000,
        maxTokens: 900,
      });
      return {
        round: state.round + 1,
        messages: [
          ...state.messages,
          {
            role: "assistant",
            content: result.text || null,
            ...(result.toolCalls.length
              ? { tool_calls: result.toolCalls }
              : {}),
          },
        ],
      };
    })
    .addNode("tools", async (state) => {
      const result = [...state.messages];
      for (const call of state.messages.at(-1).tool_calls || []) {
        let data;
        try {
          data = domain.read(JSON.parse(call.function.arguments));
        } catch (error) {
          data = { error: error.message };
        }
        result.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(data),
        });
      }
      return { messages: result };
    })
    .addEdge(START, "model")
    .addConditionalEdges("model", (s) =>
      s.messages.at(-1).tool_calls?.length ? "tools" : END,
    )
    .addEdge("tools", "model")
    .compile({ checkpointer: new SqliteCheckpointer(t.db) });
  const answer = await graph.invoke(
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: question },
      ],
      round: 0,
    },
    { configurable: { thread_id: "lab:" + crypto.randomUUID() } },
  );
  return { text: answer.messages.at(-1).content, rounds: answer.round };
}
