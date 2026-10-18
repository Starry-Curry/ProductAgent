import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { seed, mutate, visible } from "../src/lib/domain.ts";
import { productPacks } from "../src/lib/products.ts";
import { validateAnswer, runAssist, replayRun } from "../src/lib/ai/harness.ts";
import {
  createProvider,
  ProviderError,
  type Provider,
} from "../src/lib/ai/provider.ts";
import {
  saveRun,
  listRuns,
  recordFeedback,
  accessibleRun,
} from "../src/lib/service-store.ts";
import { migrate } from "../src/lib/migrations.ts";
import { assertLocalDemo } from "../src/lib/auth.ts";
import { discover } from "../src/lib/discovery.ts";
const pack = productPacks[0];
const good = JSON.stringify({
  answer: pack.claims[0].text,
  evidenceIds: [pack.claims[0].id],
  uncertainties: [],
});
function bound() {
  const s = seed();
  mutate(s, "lin", "bindProduct", {
    itemId: "lamp",
    packId: pack.id,
    confirmed: true,
  });
  return s;
}
const provider: Provider = {
  model: "test-double-not-real-ai",
  generate: async () => ({
    text: good,
    model: "test-double-not-real-ai",
    tokens: { input: 50, output: 20 },
  }),
};
function database() {
  const dir = mkdtempSync(path.join(tmpdir(), "wujian-test-"));
  const filename = path.join(dir, "test.sqlite");
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE workspace(id INTEGER PRIMARY KEY,body TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO workspace VALUES(1,?)").run(JSON.stringify(seed()));
  return { db, filename };
}
test("合法引用 ID 不能支持错误电池、危险步骤或伪称状态", () => {
  for (const text of [
    "使用两节 AAA 电池。",
    "拆开电池后短接触点即可修好。",
    "设备已经修复成功。",
  ])
    assert.throws(
      () =>
        validateAnswer(
          JSON.stringify({
            answer: text,
            evidenceIds: [pack.claims[0].id],
            uncertainties: [],
          }),
          pack,
        ),
      /逐条支持/,
    );
});
test("逐条原文通过；跨型号引用、附加文本、自由 uncertainty 均拒绝", () => {
  assert.equal(validateAnswer(good, pack).grounding, "extractive-supported");
  assert.throws(() =>
    validateAnswer(
      JSON.stringify({
        answer: pack.claims[0].text,
        evidenceIds: ["MR0102:battery"],
        uncertainties: [],
      }),
      pack,
    ),
  );
  assert.throws(() =>
    validateAnswer(
      JSON.stringify({
        answer: pack.claims[0].text + "可以充电。",
        evidenceIds: [pack.claims[0].id],
        uncertainties: [],
      }),
      pack,
    ),
  );
  assert.throws(() =>
    validateAnswer(
      JSON.stringify({
        answer: pack.claims[0].text,
        evidenceIds: [pack.claims[0].id],
        uncertainties: ["直接加热电池"],
      }),
      pack,
    ),
  );
});
test("缺型号时不调用模型，记录可回放的失败阶段", async () => {
  let calls = 0;
  const result = await runAssist(
    seed(),
    "lin",
    { itemId: "lamp", question: "怎么修", mode: "service" },
    {
      ...provider,
      generate: async () => {
        calls++;
        return provider.generate("", {});
      },
    },
  );
  assert.equal(calls, 0);
  assert.equal(result.run.status, "needs_identity");
  assert.equal(replayRun(result.run).mode, "trace-only");
});
test("成功运行逐阶段持久化，不写业务数据，不存问题正文；回放不调用模型", async () => {
  const s = bound(),
    before = JSON.stringify(s);
  const { db, filename } = database();
  try {
    migrate(db, filename);
    const result = await runAssist(
      s,
      "lin",
      {
        itemId: "lamp",
        question: "我的私人问题 123456，电池规格？",
        mode: "service",
      },
      provider,
      (r) => saveRun(db, r),
    );
    assert.equal(result.run.status, "succeeded");
    assert.equal(result.run.events?.length, 7);
    assert.equal(JSON.stringify(s), before);
    assert.equal(JSON.stringify(result.run).includes("私人问题"), false);
    assert.equal(listRuns(db, s, "lin", "lamp").length, 1);
    assert.equal(replayRun(result.run).mode, "validator");
    assert.equal(listRuns(db, s, "dad", "lamp").length, 0);
    recordFeedback(db, () => s, "lin", result.run.id, "completed");
    assert.throws(() =>
      recordFeedback(db, () => s, "lin", result.run.id, "unresolved"),
    );
  } finally {
    db.close();
  }
});
test("型号变化、赠送、资源撤权后旧服务不可读取或反馈", async () => {
  const s = bound();
  const result = await runAssist(
    s,
    "lin",
    { itemId: "lamp", question: "电池", mode: "service" },
    provider,
  );
  s.items[0].model = "另一个型号";
  assert.equal(!!accessibleRun(result.run, s, "lin"), false);
});
test("超时保留错误代码和 trace，不输出预设成功答案", async () => {
  const result = await runAssist(
    bound(),
    "lin",
    { itemId: "lamp", question: "电池", mode: "service" },
    {
      ...provider,
      generate: async () => {
        throw new ProviderError("timeout", "请求超时");
      },
    },
  );
  assert.equal(result.run.errorCode, "timeout");
  assert.equal(result.answer, undefined);
  assert.equal(result.run.events?.at(-1)?.stage, "failed");
});
test("模型缺配置或缺付费授权时不产生网络请求", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    throw Error("should not send");
  }) as typeof fetch;
  await assert.rejects(
    createProvider({}, fetcher).generate("", {}),
    (e: ProviderError) => e.code === "not_configured",
  );
  await assert.rejects(
    createProvider(
      {
        AI_BASE_URL: "https://example.com",
        AI_API_KEY: "test-only",
        AI_MODEL: "test",
      },
      fetcher,
    ).generate("", {}),
    (e: ProviderError) => e.code === "payment_not_authorized",
  );
  assert.equal(calls, 0);
});
test("Qwen 兼容传输处理成功、429 和截断；测试替身不是真实调用", async () => {
  const env = {
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-only",
    AI_MODEL: "test",
    AI_ALLOW_PAID_CALLS: "true",
  };
  const ok = (async (_u: unknown, options: RequestInit) => {
    assert.equal(options.redirect, "error");
    return Response.json({
      choices: [{ finish_reason: "stop", message: { content: good } }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    });
  }) as typeof fetch;
  assert.equal(
    (await createProvider(env, ok).generate("system", {})).tokens?.input,
    5,
  );
  await assert.rejects(
    createProvider(
      env,
      (async () => new Response("", { status: 429 })) as typeof fetch,
    ).generate("", {}),
    (e: ProviderError) => e.code === "rate_limited",
  );
  await assert.rejects(
    createProvider(env, (async () =>
      Response.json({
        choices: [{ finish_reason: "length", message: { content: good } }],
      })) as typeof fetch).generate("", {}),
    (e: ProviderError) => e.code === "invalid_response",
  );
});
test("迁移前备份保留 WAL 数据，重复迁移幂等且不丢物品", () => {
  const { db, filename } = database();
  try {
    db.exec("PRAGMA journal_mode=WAL");
    const before = (
      db.prepare("SELECT body FROM workspace").get() as { body: string }
    ).body;
    migrate(db, filename);
    migrate(db, filename);
    const backup = filename + ".before-v0-to-v2.sqlite";
    assert.ok(existsSync(backup));
    const copy = new DatabaseSync(backup, { readOnly: true });
    assert.equal(
      (copy.prepare("SELECT body FROM workspace").get() as { body: string })
        .body,
      before,
    );
    copy.close();
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as {
          n: number;
        }
      ).n,
      4,
    );
    assert.deepEqual(
      JSON.parse(
        (db.prepare("SELECT body FROM workspace").get() as { body: string })
          .body,
      ).items,
      seed().items,
    );
  } finally {
    db.close();
  }
});
test("礼物故事保留真人作者，接收者持有权限且新故事不回流", () => {
  const s = seed();
  mutate(s, "lin", "gift", { itemId: "frame", memoryIds: ["memory-frame"] });
  mutate(s, "friend", "claim", { token: s.gifts[0].token, received: true });
  const received = s.memories.find((m) => m.owner === "friend")!;
  assert.equal(received.author, "lin");
  assert.equal(received.origin?.memoryId, "memory-frame");
  assert.ok(visible(s, "friend").memories.some((m) => m.id === received.id));
  assert.ok(!visible(s, "lin").memories.some((m) => m.id === received.id));
});
test("旧赠礼缺来源时标未知，不将接收人伪造为原作者", () => {
  const { db, filename } = database();
  try {
    const s = seed();
    s.gifts.push({
      id: "old",
      itemId: "frame",
      sender: "lin",
      token: "token",
      message: "",
      nickname: "",
      stories: ["legacy"],
      includeKnowledge: false,
      itemName: "frame",
      claimedBy: "friend",
      revoked: false,
    });
    s.memories.push({
      id: "copied",
      itemId: "frame",
      author: "friend",
      text: "legacy",
      at: "old",
      shared: false,
    });
    db.prepare("UPDATE workspace SET body=?").run(JSON.stringify(s));
    migrate(db, filename);
    const migrated = JSON.parse(
      (db.prepare("SELECT body FROM workspace").get() as { body: string }).body,
    );
    assert.equal(migrated.memories.at(-1).author, null);
    assert.equal(migrated.memories.at(-1).owner, "friend");
  } finally {
    db.close();
  }
});
test("模拟角色默认关闭，远程和跨站请求不能启用", () => {
  const r = new Request("http://127.0.0.1:3100/api/workspace", {
    headers: { host: "127.0.0.1:3100" },
  });
  assert.throws(() => assertLocalDemo(r, {}));
  assert.doesNotThrow(() => assertLocalDemo(r, { AUTH_MODE: "local-demo" }));
  assert.throws(() =>
    assertLocalDemo(new Request(r, { headers: { host: "evil.example" } }), {
      AUTH_MODE: "local-demo",
    }),
  );
  assert.throws(() =>
    assertLocalDemo(
      new Request(r, {
        headers: { host: "127.0.0.1:3100", origin: "https://evil.example" },
      }),
      { AUTH_MODE: "local-demo" },
    ),
  );
});
test("新增真实型号物品可触发组合，不依赖种子 ID；户外和超载被阻止", () => {
  const s = seed();
  for (const [name, packId] of [
    ["speaker", "jbl-go4"],
    ["cart", "ikea-raskog-30629711"],
  ]) {
    mutate(s, "lin", "createItem", { name });
    mutate(s, "lin", "bindProduct", {
      itemId: s.items.at(-1)!.id,
      packId,
      confirmed: true,
    });
  }
  assert.equal(discover(s, "lin").length, 1);
  assert.equal(discover(s, "lin", { scene: "outdoor" })[0].status, "blocked");
  assert.equal(discover(s, "lin", { perShelfKg: 7 })[0].status, "blocked");
  assert.equal(discover(s, "dad").length, 0);
});
test("Context 分离未知/明确偏好，禁止替其他成员设置，云端默认不发送", async () => {
  const s = bound();
  mutate(s, "dad", "setContext", { key: "instructionStyle", value: "short" });
  mutate(s, "lin", "setContext", {
    key: "instructionStyle",
    value: "detailed",
    allowCloud: false,
  });
  assert.equal(visible(s, "lin").contexts.length, 1);
  assert.throws(() =>
    mutate(s, "lin", "setContext", {
      owner: "dad",
      key: "skillLevel",
      value: "beginner",
    }),
  );
  let sent: any;
  await runAssist(
    s,
    "lin",
    { itemId: "lamp", question: "电池", mode: "service" },
    {
      ...provider,
      generate: async (_s, input) => {
        sent = input;
        return provider.generate("", {});
      },
    },
  );
  assert.deepEqual(sent.context, []);
  mutate(s, "lin", "setContext", { key: "instructionStyle", value: null });
  assert.equal(visible(s, "lin").contexts[0].status, "unknown");
});

test("过期运行可恢复为中断，未过期运行不被误伤", async () => {
  const { db, filename } = database();
  try {
    migrate(db, filename);
    const result = await runAssist(
      bound(),
      "lin",
      { itemId: "lamp", question: "电池", mode: "service" },
      provider,
    );
    const active = { ...result.run, id: "active", status: "running" as const };
    saveRun(db, active);
    const { recoverStaleRuns } = await import("../src/lib/service-store.ts");
    assert.equal(recoverStaleRuns(db), 0);
    assert.equal(recoverStaleRuns(db, Date.now() + 180000), 1);
    const row = db
      .prepare("SELECT body FROM service_runs WHERE id=?")
      .get("active") as { body: string };
    assert.equal(JSON.parse(row.body).errorCode, "interrupted");
  } finally {
    db.close();
  }
});
