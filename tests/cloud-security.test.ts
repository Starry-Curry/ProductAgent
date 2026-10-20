import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  publicDemo,
  issueVisitor,
  readVisitor,
  visitorContext,
  governedModelFetch,
  CloudError,
  reserveUpload,
  reservePublicFetch,
  registry,
  reserveEntryAttempt,
} from "../src/lib/cloud/runtime.ts";
import { withDemoRequest } from "../src/lib/cloud/request.ts";
import {
  createProvider,
  ProviderError,
  modelTimeout,
} from "../src/lib/ai/provider.ts";
import { publicAddress } from "../src/lib/life/sources.ts";

test("公开会话不可伪造；并发请求上下文隔离、来源验证、过期拒绝与响应脱敏", async () => {
  const before = { ...process.env };
  const root = fs.mkdtempSync(
    path.join(process.cwd(), ".runtime", "cloud-security-"),
  );
  Object.assign(process.env, {
    AUTH_MODE: "public-demo",
    WUJIAN_DEPLOYMENT: "cloud",
    PRODUCT_AGENT_DATA_DIR: root,
    APP_PUBLIC_ORIGIN: "http://127.0.0.1:58991",
    DEMO_ALLOW_LOCAL_HTTP: "true",
    DEMO_AI_ENABLED: "true",
    DEMO_VISITOR_MODEL_CALLS: "2",
    DEMO_GLOBAL_MODEL_CALLS: "3",
    DEMO_UPLOAD_BYTES: "500",
  });
  try {
    assert.equal(publicDemo(), true);
    for (let i = 0; i < 30; i++) reserveEntryAttempt();
    assert.throws(() => reserveEntryAttempt(), /额度/);
    const a = issueVisitor(),
      b = issueVisitor();
    const req = (token: string, headers: Record<string, string> = {}) =>
      new Request("http://127.0.0.1:58991/api/life", {
        headers: {
          host: "127.0.0.1:58991",
          cookie: `wujian_visitor=${token}`,
          ...headers,
        },
      });
    assert.throws(() => readVisitor(req("0".repeat(64))), /进入|到期/);
    const sa = readVisitor(req(a.token)),
      sb = readVisitor(req(b.token));
    assert.notEqual(sa.id, sb.id);
    const route = withDemoRequest(async () => {
      const first = visitorContext.getStore()!.id;
      await new Promise((r) => setTimeout(r, 15));
      return Response.json({
        first,
        last: visitorContext.getStore()!.id,
        error: "D:\\private\\file",
        trace: "internal",
        apiKey: "must-not-return",
      });
    });
    const results = await Promise.all([
      route(req(a.token, { "x-demo-actor": "dad", "x-tenant-id": sb.id })),
      route(req(b.token)),
    ]);
    const [ra, rb] = await Promise.all(results.map((r) => r.json()));
    assert.equal(ra.first, sa.id);
    assert.equal(ra.last, sa.id);
    assert.equal(rb.first, sb.id);
    assert.equal(rb.apiKey, undefined);
    assert.equal(rb.trace, undefined);
    assert.doesNotMatch(rb.error, /private/);
    assert.equal(
      (await route(req(a.token, { origin: "https://attacker.invalid" })))
        .status,
      403,
    );
    await visitorContext.run(sa, async () => {
      reserveUpload(100);
      assert.throws(() => reserveUpload(500), /额度/);
      assert.throws(() => reservePublicFetch("unapproved.example"), /尚未开放/);
    });
    let calls = 0;
    const env = {
      ...process.env,
      AI_ALLOW_PAID_CALLS: "true",
      WUJIAN_ALLOW_PAID_CALLS: "true",
    };
    const fake = governedModelFetch(async () => {
      calls++;
      return Response.json(
        { error: { code: "InvalidParameter" } },
        { status: calls === 1 ? 400 : 200 },
      );
    }, env);
    const init = {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "synthetic" }],
        max_tokens: 10000,
      }),
    };
    await visitorContext.run(sa, async () => {
      assert.equal(
        (
          await fake(
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            init,
          )
        ).status,
        400,
      );
      await fake(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        init,
      );
      await assert.rejects(
        fake(
          "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
          init,
        ),
        (e) => e instanceof CloudError && e.code === "budget_exhausted",
      );
    });
    assert.equal(calls, 2);
    fs.writeFileSync(path.join(root, "AI_STOP"), "");
    await visitorContext.run(sb, async () => {
      await assert.rejects(
        fake(
          "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
          init,
        ),
        /暂未开放/,
      );
    });
    assert.equal(calls, 2);
    const db = registry();
    try {
      db.prepare("UPDATE visitors SET expires=0 WHERE id=?").run(sa.id);
      assert.equal(
        db.prepare("SELECT count(*) n FROM model_requests").get()!.n,
        2,
      );
    } finally {
      db.close();
    }
    assert.equal((await route(req(a.token))).status, 401);
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
});

test("JSON模式显式JSON约束，普通问答可关闭；400错误安全分类，超时可配置，SSRF特殊地址拒绝", async () => {
  const env = {
    AI_API_KEY: "offline-placeholder",
    AI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    AI_MODEL: "qwen-plus",
    AI_ALLOW_PAID_CALLS: "true",
    AI_JSON_MODE: "true",
  };
  let body: any;
  const provider = createProvider(env, async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({
      choices: [
        { finish_reason: "stop", message: { content: '{"answer":"ok"}' } },
      ],
    });
  });
  await provider.generate("普通问答", "synthetic");
  assert.match(body.messages[0].content, /JSON/);
  assert.equal(body.response_format.type, "json_object");
  assert.equal(body.enable_thinking, false);
  await createProvider({ ...env, AI_JSON_MODE: "false" }, async (_u, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({
      choices: [{ finish_reason: "stop", message: { content: "普通回答" } }],
    });
  }).generate("普通问答", "synthetic");
  assert.equal(body.response_format, undefined);
  const bad = createProvider(env, async () =>
    Response.json(
      {
        error: { code: "InvalidParameter", message: "sensitive upstream echo" },
      },
      { status: 400 },
    ),
  );
  await assert.rejects(
    bad.generate("hello", {}),
    (e) =>
      e instanceof ProviderError &&
      e.code === "invalid_request" &&
      e.upstreamCode === "InvalidParameter" &&
      !e.message.includes("sensitive"),
  );
  for (const address of [
    "127.0.0.1",
    "169.254.169.254",
    "100.100.100.200",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "198.18.0.1",
  ])
    assert.equal(publicAddress(address), false, address);
  for (const [status, code] of [
    [401, "authentication"],
    [429, "rate_limited"],
    [504, "upstream_timeout"],
    [503, "upstream"],
  ] as const) {
    const p = createProvider(env, async () =>
      Response.json(
        { error: { code: "test-error", message: "private" } },
        { status },
      ),
    );
    await assert.rejects(
      p.generate("JSON", {}),
      (e) =>
        e instanceof ProviderError &&
        e.code === code &&
        !e.message.includes("private"),
    );
  }
  const timed = createProvider(env, async () => {
    throw new TypeError("fetch failed", {
      cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
    });
  });
  await assert.rejects(
    timed.complete!([{ role: "user", content: "JSON" }], []),
    (e) => e instanceof ProviderError && e.code === "timeout",
  );
  assert.equal(modelTimeout({ AI_REQUEST_TIMEOUT_MS: "65000" }, 70000), 65000);
  assert.equal(modelTimeout({ AI_REQUEST_TIMEOUT_MS: "999999" }), 90000);
});
