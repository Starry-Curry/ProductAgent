import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { inspectProduct } from "../src/lib/life/product-inspection.ts";
import { readCompletionStream } from "../src/lib/ai/provider.ts";
import {
  storeOfficialDocument,
  makeKnowledgeDocument,
} from "../src/lib/life/acquisition.ts";
import { respond } from "../src/lib/agent/service.ts";

test("陌生型号读入资料，无预置包；最终域名和型号分别核对", async () => {
  const doc = {
    title: "CLIP 5",
    text: "CLIP 5 dimensions 86.3 x 134.5 x 46 mm",
    url: "https://support.jbl.com/test.pdf",
    links: [
      { title: "Privacy", url: "https://support.jbl.com/privacy.pdf" },
      { title: "Quick Start Guide", url: "https://support.jbl.com/guide.pdf" },
    ],
  };
  const input = { brand: "JBL", model: "CLIP 5", url: doc.url };
  assert.equal((await inspectProduct(input, async () => doc)).official, true);
  assert.equal(
    (await inspectProduct({ ...input, model: "CLIP 50" }, async () => doc))
      .official,
    false,
  );
  assert.equal(
    (
      await inspectProduct(input, async () => ({
        ...doc,
        url: "https://example.com/manual",
      }))
    ).official,
    false,
  );
  assert.equal(
    (await inspectProduct(input, async () => doc)).manuals.length,
    1,
  );
});
test("SSE逐字节跨UTF8边界、usage分包，不能转发思考内容", async () => {
  const raw =
    'data: {"choices":[{"delta":{"reasoning_content":"隐藏思考","content":"你好"}}]}\n\ndata: {"choices":[{"finish_reason":"stop","delta":{}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(raw);
  let received = "";
  const stream = new ReadableStream({
    start(c) {
      for (const b of bytes) c.enqueue(new Uint8Array([b]));
      c.close();
    },
  });
  const result = await readCompletionStream(
    new Response(stream),
    (t) => (received += t),
  );
  assert.equal(received, "你好");
  assert.equal(result.choices[0].finish_reason, "stop");
  assert.deepEqual(result.usage, { prompt_tokens: 10, completion_tokens: 2 });
});
test("SSE截断不能伪造stop；provider仍能拒绝未完成内容", async () => {
  const result = await readCompletionStream(
    new Response('data: {"choices":[{"delta":{"content":"部分"}}]}'),
    () => {},
  );
  assert.equal(result.choices[0].finish_reason, undefined);
});
test("实验事实问答一轮提取主张；未审阅属性不能因引用存在就发布；越权不能读资料", async () => {
  const previous = process.env.WUJIAN_EXPERIMENTAL_FACT_QA;
  process.env.WUJIAN_EXPERIMENTAL_FACT_QA = "true";
  const f = validationFixture(
    mkdtempSync(path.join(process.cwd(), ".runtime", "foundation-qa-")),
  );
  try {
    const id = f.add("合成陌生音箱", "电子设备", "JBL", "CLIP 5");
    const item = f.read().items.find((i) => i.id === id)!;
    storeOfficialDocument(
      f.db,
      "lin",
      item,
      makeKnowledgeDocument(
        {
          url: "https://support.jbl.com/manual.pdf",
          title: "CLIP 5",
          text: "CLIP 5. Dimensions 86.3 x 134.5 x 46 mm. Net weight 285 g. IP67. Battery charge time 3 hours. Maximum operation temperature 45 C.",
          links: [],
        },
        item,
        [],
      ),
    );
    let calls = 0;
    const provider = {
      ready: true,
      model: "test-only",
      generate: async (_s: string, input: any, options: any) => {
        calls++;
        assert.equal(options.json, true);
        assert.equal(input.question, "尺寸、重量、防水等级各是多少？");
        return {
          text: JSON.stringify({claims:[{predicate:"dimensions",value:"86.3×134.5×46毫米"},{predicate:"weight",value:285},{predicate:"waterproof",value:"IP67"}]}),
          model: "test-only",
          tokens: { input: 10, output: 20 },
        };
      },
    };
    const result = await respond(
      f.db,
      f.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        itemId: id,
        mode: "service",
        question: "尺寸、重量、防水等级各是多少？",
        memoryPolicy: "off",
      },
      provider,
    );
    assert.equal(calls, 1);
    assert.equal(result.modelCalls, 1);
    assert.equal(result.reply.citations.length, 0);
    assert.equal(result.reply.outcome,"needs_info");
    assert.doesNotMatch(result.reply.answer, /285|IP67/);
    assert.ok(result.trace.some((t) => t.stage === "grounded_answer"));
    await assert.rejects(() =>
      respond(
        f.db,
        f.read,
        "friend",
        {
          requestId: crypto.randomUUID(),
          itemId: id,
          mode: "service",
          question: "尺寸？",
        },
        provider,
      ),
    );
    assert.equal(calls, 1);
  } finally {
    f.db.close();
    if (previous === undefined) delete process.env.WUJIAN_EXPERIMENTAL_FACT_QA;
    else process.env.WUJIAN_EXPERIMENTAL_FACT_QA = previous;
  }
});
