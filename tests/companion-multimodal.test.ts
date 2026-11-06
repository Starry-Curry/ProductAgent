import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { demonstrationAnswer } from "../src/lib/agent/demonstration.ts";
import {
  washerGuide,
  diagramMarker,
  guideSketch,
} from "../src/lib/companion/visual-guide.ts";
import { createProvider } from "../src/lib/ai/provider.ts";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { respond } from "../src/lib/agent/service.ts";
test("demonstration answers remain useful, labelled and do not claim external actions", () => {
  const r = demonstrationAnswer("洗衣机怎么用？");
  assert.equal(r.outcome, "answered");
  assert.equal(r.demonstration, true);
  assert.equal(r.steps.length, 5);
  assert.match(r.steps[0].text, /电源/);
  assert.match(r.steps.at(-1)!.text, /启动/);
  const fallback = demonstrationAnswer(
    "帮我买垃圾袋",
    undefined,
    JSON.stringify({ kind: "general", answer: "我已经通知爸爸并购买好了" }),
  );
  assert.doesNotMatch(fallback.answer, /已经通知|购买好了/);
  assert.equal(fallback.source, "local-dialogue");
  assert.equal(fallback.citations.length, 0);
});
test("demo mode still answers a hazardous-device case with a non-operating next step", () => {
  const r = demonstrationAnswer("这个设备冒烟了怎么拆电池？");
  assert.equal(r.outcome, "answered");
  assert.match(r.answer, /暂停/);
  assert.ok(!r.steps.some((s) => /拆开电池|开始加热/.test(s.text)));
});
test("diagram target geometry stays inside its declared image and SVG text is escaped", () => {
  for (const step of washerGuide) {
    const m = diagramMarker(step.text);
    for (const n of [m.x, m.y, m.width, m.height]) assert.ok(n >= 0 && n <= 1);
  }
  const svg = decodeURIComponent(
    guideSketch("<script>alert(1)</script>", washerGuide[0].text).split(",")[1],
  );
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /e34e42/);
});
test("vision localization forwards the task instruction, picture and bounded options", async () => {
  let seen: any;
  const p = createProvider(
    {
      AI_BASE_URL: "https://example.test/v1",
      AI_API_KEY: "offline",
      AI_MODEL: "qwen3-vl-plus",
      AI_ALLOW_PAID_CALLS: "true",
    },
    async (_url, init) => {
      seen = JSON.parse(String(init?.body));
      return Response.json({
        choices: [
          { message: { content: '{"target":null}' }, finish_reason: "stop" },
        ],
      });
    },
  );
  const r = await p.recognize!(
    "定位任务",
    "data:image/png;base64,AA==",
    "定位电源按钮",
    { timeoutMs: 500, maxTokens: 650 },
  );
  assert.equal(seen.messages[1].content[0].text, "定位电源按钮");
  assert.equal(
    seen.messages[1].content[1].image_url.url,
    "data:image/png;base64,AA==",
  );
  assert.equal(seen.max_tokens, 650);
  assert.equal(JSON.parse(r.text).target, null);
});
test("companion demonstration gives an answer with no provider and unknown hardware, without writing a task", async () => {
  const t = validationFixture(
      mkdtempSync(path.join(process.cwd(), ".runtime", "demo-answer-test-")),
    ),
    old = process.env.WUJIAN_DEMO_ANSWERS;
  process.env.WUJIAN_DEMO_ANSWERS = "true";
  try {
    const itemId = t.add("演示洗衣机", "家用电器", "", "待确认");
    const count = t.read().tasks.length;
    const d = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        itemId,
        question: "这台洗衣机怎么用？",
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { client: "companion-v1", page: "item" },
      },
      {
        ready: false,
        model: "offline",
        generate: async () => {
          throw Error("must stay offline");
        },
      },
    );
    assert.equal(d.reply.outcome, "answered");
    assert.equal(d.reply.demonstration, true);
    assert.ok(d.reply.steps.length);
    assert.equal(t.read().tasks.length, count);
  } finally {
    if (old === undefined) delete process.env.WUJIAN_DEMO_ANSWERS;
    else process.env.WUJIAN_DEMO_ANSWERS = old;
    t.db.close();
  }
});
