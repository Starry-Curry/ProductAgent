import test from "node:test";
import assert from "node:assert/strict";
import { createProvider, ProviderError } from "../src/lib/ai/provider.ts";
import { CloudError } from "../src/lib/cloud/runtime.ts";

// Entirely in-process SDK protocol doubles; no real Qwen/network/credential access.
const env = {
  AI_BASE_URL: "https://fixture.invalid/v1",
  AI_API_KEY: "offline-test-placeholder",
  AI_MODEL: "qwen-protocol-double",
  AI_ALLOW_PAID_CALLS: "true",
};
const answer = (text = "完整回答") =>
  Response.json({
    id: "fixture",
    object: "chat.completion",
    created: 0,
    model: env.AI_MODEL,
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: text },
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
  });
function sse(packets: unknown[], stall = false): typeof fetch {
  return async (_url, init) =>
    new Response(
      new ReadableStream({
        start(c) {
          const bytes = new TextEncoder().encode(
            packets.map((p) => "data: " + JSON.stringify(p) + "\n\n").join("") +
              (stall ? "" : "data: [DONE]\n\n"),
          );
          for (const b of bytes) c.enqueue(new Uint8Array([b]));
          if (stall)
            init?.signal?.addEventListener(
              "abort",
              () => c.error(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          else c.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
}
const chunk = (delta: unknown, finish_reason: string | null = null) => ({
  id: "fixture",
  object: "chat.completion.chunk",
  created: 0,
  model: env.AI_MODEL,
  choices: [{ index: 0, delta, finish_reason }],
});

test("SDK generate使用严格JSON Schema、受控HTTPS且只有一次上游请求", async () => {
  let calls = 0;
  const p = createProvider(env, async (url, init) => {
    calls++;
    assert.equal(String(url), "https://fixture.invalid/v1/chat/completions");
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.match(headers.get("user-agent") || "", /OpenAI/);
    assert.equal(
      headers.get("authorization"),
      "Bearer offline-test-placeholder",
    );
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.response_format, {
      type: "json_schema",
      json_schema: {
        name: "fact_card",
        strict: true,
        schema: {
          type: "object",
          properties: { claim: { type: "string" } },
          required: ["claim"],
          additionalProperties: false,
        },
      },
    });
    assert.equal(body.enable_thinking, false);
    assert.equal(body.max_tokens, 4000);
    return answer('{"claim":"candidate"}');
  });
  const r = await p.generate(
    "提取当前资料",
    { text: "已核对原文" },
    {
      json: false,
      maxTokens: 99999,
      jsonSchema: {
        name: "fact_card",
        schema: {
          type: "object",
          properties: { claim: { type: "string" } },
          required: ["claim"],
          additionalProperties: false,
        },
      },
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(r.tokens, { input: 12, output: 4 });
  assert.equal(r.text, '{"claim":"candidate"}');
});

test("JSON object与自然文本兼容：不自动增加审稿调用", async () => {
  const bodies: any[] = [];
  const p = createProvider(
    { ...env, AI_JSON_MODE: "true" },
    async (_u, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return answer("{}");
    },
  );
  await p.generate("普通JSON", {});
  await p.generate("自然表达", {}, { json: false });
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0].response_format, { type: "json_object" });
  assert.equal(bodies[1].response_format, undefined);
});

test("SDK流聚合UTF8/usage，外部仅收到content且推理不外发", async () => {
  let content = "";
  let calls = 0;
  const transport = sse([
    chunk({
      role: "assistant",
      content: "你",
      reasoning_content: "not-for-user",
    }),
    chunk({ content: "好" }),
    chunk({}, "stop"),
    {
      id: "fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: env.AI_MODEL,
      choices: [],
      usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 },
    },
  ]);
  const p = createProvider(env, async (u, i) => {
    calls++;
    return transport(u, i);
  });
  const r = await p.generate("正常交流", {}, { onText: (t) => (content += t) });
  assert.equal(content, "你好");
  assert.equal(r.text, "你好");
  assert.deepEqual(r.tokens, { input: 9, output: 2 });
  assert.equal(calls, 1);
});

test("SDK错误仍保留安全状态分类、拒绝自动重试并不反射上游正文", async () => {
  for (const [status, code] of [
    [400, "invalid_request"],
    [401, "authentication"],
    [403, "permission"],
    [429, "rate_limited"],
    [504, "upstream_timeout"],
    [503, "upstream"],
  ] as const) {
    let calls = 0;
    const p = createProvider(env, async () => {
      calls++;
      return Response.json(
        { error: { code: "Safe.Code", message: "private-upstream-payload" } },
        { status },
      );
    });
    await assert.rejects(
      p.generate("s", {}),
      (e) =>
        e instanceof ProviderError &&
        e.code === code &&
        e.upstreamStatus === status &&
        e.upstreamCode === "Safe.Code" &&
        !e.message.includes("private"),
    );
    assert.equal(calls, 1);
  }
  const p = createProvider(env, async () => {
    throw new CloudError("budget_exhausted", "本地预算已耗尽");
  });
  await assert.rejects(p.complete!([], []), { code: "budget_exhausted" });
  const timed = createProvider(env, async () => {
    throw new TypeError("private", {
      cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
    });
  });
  await assert.rejects(timed.generate("s", {}), { code: "timeout" });
});

test("SDK整段流截止时间有效，headers后卡住也不重试", async () => {
  let calls = 0;
  const transport = sse([chunk({ role: "assistant", content: "部分" })], true);
  const p = createProvider(env, async (u, i) => {
    calls++;
    return transport(u, i);
  });
  const start = Date.now();
  await assert.rejects(
    p.generate("s", {}, { timeoutMs: 60, onText: () => {} }),
    { code: "timeout" },
  );
  assert.equal(calls, 1);
  assert.ok(Date.now() - start < 1000);
});

test("缺少授权/HTTPS不安全时网络请求为零；返回格式与截断仍拒绝", async () => {
  let calls = 0;
  const transport: typeof fetch = async () => {
    calls++;
    return answer();
  };
  for (const e of [
    { ...env, AI_ALLOW_PAID_CALLS: "false" },
    { ...env, AI_BASE_URL: "http://fixture.invalid" },
    { ...env, AI_API_KEY: " " },
  ])
    await assert.rejects(createProvider(e, transport).generate("s", {}));
  assert.equal(calls, 0);
  for (const response of [
    new Response("bad json", {
      headers: { "content-type": "application/json" },
    }),
    Response.json({
      choices: [{ finish_reason: "length", message: { content: "部分" } }],
    }),
  ])
    await assert.rejects(
      createProvider(env, async () => response).generate("s", {}),
      { code: "invalid_response" },
    );
  await assert.rejects(
    createProvider(
      env,
      sse([chunk({ role: "assistant", content: "部分" })]),
    ).generate("s", {}, { onText: () => {} }),
    { code: "invalid_response" },
  );
});

test("SDK complete保持function calling合同；未知custom工具类型仍被拒绝", async () => {
  let calls = 0;
  const tools = [
    {
      type: "function" as const,
      function: {
        name: "get_item_context",
        description: "read only",
        parameters: { type: "object", properties: {} },
      },
    },
  ];
  const p = createProvider(env, async (_u, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.tools, tools);
    assert.equal(body.enable_thinking, false);
    return Response.json({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call1",
                type: "function",
                function: { name: "get_item_context", arguments: "{}" },
              },
            ],
          },
        },
      ],
    });
  });
  const r = await p.complete!([{ role: "user", content: "当前物品" }], tools, {
    timeoutMs: 3000,
    toolChoice: { type: "function", function: { name: "get_item_context" } },
  });
  assert.equal(r.toolCalls[0].function.name, "get_item_context");
  assert.equal(calls, 1);
  await assert.rejects(
    createProvider(env, async () =>
      Response.json({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                { id: "x", type: "custom", custom: { name: "unsafe" } },
              ],
            },
          },
        ],
      }),
    ).complete!([], tools),
    { code: "invalid_response" },
  );
});
