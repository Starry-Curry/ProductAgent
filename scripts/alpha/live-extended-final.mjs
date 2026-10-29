import { mkdtempSync } from "node:fs";
import path from "node:path";
import { gateway } from "./gateway.mjs";
import { root, saveReport } from "./shared.mjs";
import { validationFixture } from "../life-validation-fixture.ts";
import { createProvider } from "../../src/lib/ai/provider.ts";
import { planDiscovery } from "../../src/lib/life/planning.ts";
import { respond } from "../../src/lib/agent/service.ts";
import { saveMemory } from "../../src/lib/memory/store.ts";
import { feedbackIdea } from "../../src/lib/life/ideas.ts";
import { installAlphaSamples } from "../../src/lib/life/alpha-samples.ts";
import { sharedItemKnowledge } from "../../src/lib/context/knowledge.ts";
import { creativeFacts } from "../../src/lib/life/creative-reasoning.ts";
if (!process.argv.includes("--live-max=100-cny=20"))
  throw Error("Explicit task budget flag required");
const gate = await gateway({
  live: true,
  configPath: process.argv.find((s) => s.startsWith("--config="))?.slice(9),
});
const t = validationFixture(
    mkdtempSync(path.resolve(".runtime/alpha-extended-")),
  ),
  rows = [];
const provider = (arm) =>
  createProvider(
    {
      AI_BASE_URL: "https://fixture.invalid/v1",
      AI_API_KEY: "fixture-only",
      AI_MODEL: gate.model,
      AI_ALLOW_PAID_CALLS: "true",
      AI_ENABLE_THINKING: "false",
      AI_JSON_MODE: "true",
    },
    (_u, init) => fetch(gate.url + "/" + arm + "/v1/chat/completions", init),
  );
async function run(id, arm, fn) {
  const before = gate.ledger.attempts.length;
  try {
    const result = await fn();
    rows.push({
      id,
      arm,
      result,
      requests: gate.ledger.attempts.length - before,
    });
    console.log(
      id,
      arm,
      result.source || result.reply?.source || "direct",
      result.ideas?.map((i) => i.title).join("; "),
    );
    return result;
  } catch (e) {
    rows.push({
      id,
      arm,
      error: e.message,
      requests: gate.ledger.attempts.length - before,
    });
    console.log(id, arm, "FAILED", e.message);
  } finally {
    saveReport(path.join(root, "live-extended-final.json"), {
      rows,
      physicalTests: 0,
      humanBlindEvaluation: false,
    });
  }
}
try {
  const box = t.add("旧纸盒", "手工材料", "", "未知", {
    attributes: { material: "纸板", dimensions: "20×15×10厘米", quantity: 1 },
  });
  const paper = t.add("20张白纸", "手工材料", "", "未知", {
    attributes: {
      material: "普通纸",
      dimensions: "A4",
      quantity: 20,
      quantityUnit: "张",
      capabilities: ["可在纸上书写"],
    },
  });
  const pen = t.add("铅笔", "文具", "", "未知", {
    attributes: {
      material: "木杆石墨芯",
      quantity: 1,
      capabilities: ["在纸上书写"],
    },
  });
  const preference = saveMemory(t.db, t.read, "lin", {
    kind: "interest",
    text: "我最近在学水彩，喜欢把日常片段编成安静的小故事，不想用屏幕。",
    allowCloud: true,
  });
  const products = installAlphaSamples(t.db, t.read, "lin").itemIds;
  const baseline = (
    await import("../../.runtime/alpha-baseline/src/lib/life/planning.ts")
  ).planDiscovery;
  for (const c of [
    {
      id: "box-with-real-resources",
      itemIds: [box, paper, pen],
      itemId: box,
      goal: "只用登记的旧纸盒、白纸和铅笔，想练习讲小故事。设计一种有具体规则、可反复变化的新用途，不要只是观察或仪式；不买材料、不裁切、不加热。",
    },
    {
      id: "goal-with-official-products",
      itemIds: [...products, paper, pen],
      goal: "只用登记的两款盒子、白纸和铅笔，为练习水彩构思和口述故事做一个可持续改变的创意系统。不要把所有物品硬凑在一起，不买材料、不用屏幕，不裁切不加热。",
    },
  ]) {
    const input = {
      goal: c.goal,
      itemIds: c.itemIds,
      itemId: c.itemId,
      includeSynthetic: true,
      minutes: 15,
      model: true,
      candidates: 1,
      publicEvidence: false,
    };
    const information = {
      goal: c.goal,
      minutes: 15,
      itemContexts: sharedItemKnowledge(t.read(), "lin", c.itemIds).items,
      creativeFacts: creativeFacts(
        t.read().items.filter((i) => c.itemIds.includes(i.id)),
      ),
      authorizedPreferences: [{ id: preference.id, text: preference.text }],
    };
    await run(c.id, "direct", () =>
      provider("extended-direct").generate(
        "使用给定物品、来源和偏好提出一个具体新用途，说明作用原理、操作步骤、条件与未知，不编造材料或能力。输出JSON。",
        information,
        { maxTokens: 1900, timeoutMs: 45000 },
      ),
    );
    await run(c.id, "baseline", () =>
      baseline(
        t.db,
        t.read(),
        "lin",
        input,
        provider("extended-baseline"),
        t.read,
      ),
    );
    const result = await run(c.id, "alpha", () =>
      planDiscovery(
        t.db,
        t.read(),
        "lin",
        { ...input, review: true },
        provider("extended-alpha"),
        t.read,
      ),
    );
    if (result?.ideas?.length) {
      const first = result.ideas[0];
      feedbackIdea(t.db, t.read(), "lin", {
        id: first.id,
        saved: true,
        outcome: "未成功",
        note: "合成反馈：不希望依赖盒盖",
      });
      await run(c.id + "-feedback", "alpha", () =>
        planDiscovery(
          t.db,
          t.read(),
          "lin",
          {
            ...input,
            review: true,
            goal: "刚才不希望依赖盒盖，换成不使用盒盖、可独自练习的玩法；原来只用登记物品、不买、不裁切限制不变。",
            previousIdeaIds: [first.id],
            continuation: result.continuation,
          },
          provider("extended-feedback"),
          t.read,
        ),
      );
    }
  }
  for (const itemId of products)
    await run(itemId, "actual-chat", () =>
      respond(
        t.db,
        t.read,
        "lin",
        {
          itemId,
          mode: "service",
          question:
            "根据这件物品的官方资料，材质、尺寸和使用限制是什么？耐热和内部净尺寸未知就明确说未知。",
          requestId: crypto.randomUUID(),
          memoryPolicy: "off",
        },
        provider("product-chat"),
      ),
    );
} finally {
  t.db.close();
  await gate.close();
}
