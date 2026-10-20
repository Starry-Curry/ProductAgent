import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { createProvider } from "../src/lib/ai/provider.ts";
import {
  taskEvidence,
  selectTaskEvidence,
} from "../src/lib/life/knowledge-task.ts";
import {
  makeKnowledgeDocument,
  acquireKnowledge,
  retrieveKnowledge,
} from "../src/lib/life/acquisition.ts";
import { groundedReply } from "../src/lib/skills/document-help.ts";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { respond } from "../src/lib/agent/service.ts";
const fixture = () =>
  validationFixture(
    mkdtempSync(path.join(process.cwd(), ".runtime", "task-search-test-")),
  );
test("搜索独立授权、固定turbo且只信结构化来源，不把生成链接当网页", async () => {
  let calls = 0;
  const env = {
    AI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    AI_API_KEY: "offline-placeholder",
    AI_MODEL: "qwen-plus",
    AI_ALLOW_PAID_CALLS: "true",
    WUJIAN_ALLOW_PAID_CALLS: "true",
    WUJIAN_ALLOW_SEARCH: "false",
  };
  const request: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(new URL(String(url)).hostname, "dashscope.aliyuncs.com");
    const b = JSON.parse(String(init?.body));
    assert.equal(b.parameters.search_options.search_strategy, "turbo");
    assert.equal(b.parameters.search_options.enable_source, true);
    return Response.json({
      output: {
        choices: [
          {
            message: { content: "fabricated https://invented.invalid/manual" },
          },
        ],
        search_info: {
          search_results: [
            { title: "hit", url: "https://www.lego.com/product/31136" },
          ],
        },
      },
      usage: { input_tokens: 10, output_tokens: 2 },
    });
  };
  await assert.rejects(
    createProvider(env, request).search!("test"),
    /未单独启用/,
  );
  assert.equal(calls, 0);
  const p = createProvider({ ...env, WUJIAN_ALLOW_SEARCH: "true" }, request);
  assert.equal((await p.search!("test", ["lego.com"])).hits.length, 1);
  const noSources = createProvider(
    { ...env, WUJIAN_ALLOW_SEARCH: "true" },
    async () =>
      Response.json({
        output: {
          choices: [{ message: { content: "https://www.lego.com/fake" } }],
        },
      }),
  );
  assert.deepEqual((await noSources.search!("test")).hits, []);
});
test("完整任务按阶段取证；规格、数值与单位错配拒绝，序号和否定安全表述可用", () => {
  const t = fixture();
  try {
    const id = t.add("普通烹饪器具", "厨房用品", "测试", "TEST1");
    const item = t.read().items.find((i) => i.id === id)!;
    const d = makeKnowledgeDocument(
      {
        url: "https://example.org/manual",
        title: "TEST1",
        text: "Model TEST1. Before first use clean the basket. Turn on the power. Select the mode. Start cooking. After cooking unplug and cool down. Cleaning and maintenance: wash using a soft cloth. Charge at 5 V. Wait 3 minutes.",
        links: [],
      },
      item,
      [],
    );
    const task = taskEvidence(d.chunks, "第一次带我完成一次烹饪");
    for(const chunk of d.chunks){assert.ok(chunk.start>=0);assert.equal(d.text.slice(chunk.start,chunk.end),chunk.text);}
    assert.equal(task.requiredPhases.length, 6);
    assert.ok(
      selectTaskEvidence(d.chunks, "第一次带我完成一次烹饪", []).length,
    );
    const p = {
      kind: "grounded",
      answer: "按来源操作，不保证完全安全。",
      steps: [
        {
          text: "1. 等待3分钟。",
          sourceIds: [d.chunks[0].id],
          phase: "prepare",
          covers: ["initial", "load", "program", "end"],
        },
      ],
    };
    assert.equal(
      groundedReply(p, d.chunks, { tried: [] }, task).steps.length,
      1,
    );
    assert.equal(
      groundedReply(p, d.chunks, { tried: [] }, task).taskProgress?.guidance,
      "partial",
    );
    assert.ok(
      groundedReply(
        p,
        d.chunks,
        { tried: [] },
        task,
      ).taskProgress?.missing.some((m) => m.includes("首次清洁")),
    );
    assert.equal(
      groundedReply(
        { ...p, steps: [{ ...p.steps[0], covers: ["care"] }] },
        d.chunks,
        { tried: [] },
        task,
      ).steps.length,
      1,
    );
    const spelled = d.chunks.map((c) => ({
      ...c,
      text: c.text.replace("3 minutes", "five minutes"),
    }));
    assert.equal(
      groundedReply(
        { ...p, steps: [{ ...p.steps[0], text: "等待五分钟。" }] },
        spelled,
        { tried: [] },
        task,
      ).steps.length,
      1,
    );
    assert.throws(
      () =>
        groundedReply(
          { ...p, steps: [{ ...p.steps[0], text: "使用5瓦电源。" }] },
          d.chunks,
          { tried: [] },
        ),
      /数字/,
    );
    assert.match(
      groundedReply(p, d.chunks, { tried: [] }, task).caveat!,
      /实际使用/,
    );
    const partial = groundedReply(
      {
        ...p,
        steps: [
          ...p.steps,
          {
            text: "使用999伏电源。",
            phase: "start",
            sourceIds: [d.chunks[0].id],
          },
        ],
      },
      d.chunks,
      { tried: [] },
      task,
    );
    assert.equal(partial.steps.length, 1);
    assert.match(partial.caveat!, /隐藏1/);
    assert.ok(!partial.steps.some((s) => s.text.includes("999")));
  } finally {
    t.db.close();
  }
});
test("搜索命中还须实际读取和型号核对；完成第一步后保持服务意图并从下一阶段继续", async () => {
  const t = fixture();
  try {
    const id = t.add("测试工具", "玩具", "LEGO", "31136");
    let searches = 0;
    const result = await acquireKnowledge(t.db, t.read, "lin", id, {
      search: async () => {
        searches++;
        return {
          hits: [
            { title: "wrong", url: "https://www.lego.com/wrong" },
            { title: "right", url: "https://www.lego.com/right" },
          ],
          tokens: null,
          model: "fake",
          usage: null,
        };
      },
      fetchDocument: async (url) => ({
        url,
        title: url.endsWith("right") ? "31136" : "31135",
        text: url.endsWith("right")
          ? "31136. Before first use check parts. Assemble pieces following the guide. After completed check stability."
          : "31135. unrelated product.",
        links: [],
      }),
    });
    assert.equal(searches, 1);
    assert.equal(result.documents.length, 1);
    assert.equal(result.documents[0].url, "https://www.lego.com/right");
    const e = retrieveKnowledge(t.db, t.read(), "lin", id, "第一次怎么用");
    const provider = {
      ready: true,
      model: "offline-test",
      generate: async () => ({
        model: "offline-test",
        tokens: null,
        text: JSON.stringify({
          kind: "grounded",
          answer: "按对应资料继续。",
          steps: [
            { phase: "prepare", text: "核对零件。", sourceIds: [e[0].id] },
            { phase: "operate", text: "依次组装零件。", sourceIds: [e[0].id] },
          ],
          questions: [],
        }),
      }),
    };
    const a = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        question: "第一次怎么用",
        itemId: id,
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { page: "item" },
      },
      provider,
    );
    const b = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        question: "我已经做过第一步了，接下来呢？",
        itemId: id,
        sessionId: a.session.id,
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { page: "item" },
      },
      provider,
    );
    assert.equal(b.reply.route?.intent, "help");
    assert.equal(b.reply.steps.length, 1);
    assert.match(b.reply.steps[0].text, /组装/);
  } finally {
    t.db.close();
  }
});
