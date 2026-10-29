import path from "node:path";
import { mkdtempSync } from "node:fs";
import { gateway } from "./gateway.mjs";
import { root, saveReport } from "./shared.mjs";
import { createProvider } from "../../src/lib/ai/provider.ts";
import { validationFixture } from "../life-validation-fixture.ts";
import { planDiscovery } from "../../src/lib/life/planning.ts";
import { respond } from "../../src/lib/agent/service.ts";
import {
  listMemories,
  saveMemory,
  forgetMemory,
} from "../../src/lib/memory/store.ts";
import { installAlphaSamples } from "../../src/lib/life/alpha-samples.ts";
import { sharedItemKnowledge } from "../../src/lib/context/knowledge.ts";
import { creativeFacts } from "../../src/lib/life/creative-reasoning.ts";
if (!process.argv.includes("--live-max=100-cny=20"))
  throw Error("Explicit task budget flag required");
const stage =
  process.argv.find((s) => s.startsWith("--stage="))?.slice(8) || "first";
const server = await gateway({
  live: true,
  configPath: process.argv.find((s) => s.startsWith("--config="))?.slice(9),
});
const rows = [];
const provider = (arm) =>
  createProvider(
    {
      AI_BASE_URL: "https://fixture.invalid/v1",
      AI_API_KEY: "fixture-only",
      AI_MODEL: server.model,
      AI_ALLOW_PAID_CALLS: "true",
      AI_ENABLE_THINKING: "false",
      AI_JSON_MODE: "true",
    },
    (_url, init) =>
      fetch(server.url + "/" + arm + "/v1/chat/completions", init),
  );
async function record(id, arm, run) {
  const before = server.ledger.attempts.length,
    start = performance.now();
  try {
    const result = await run();
    rows.push({
      id,
      arm,
      result,
      requests: server.ledger.attempts.length - before,
      elapsedMs: Math.round(performance.now() - start),
    });
    console.log(
      id + " " + arm + " returned " + (server.ledger.attempts.length - before),
    );
  } catch (e) {
    rows.push({
      id,
      arm,
      error: e.message,
      requests: server.ledger.attempts.length - before,
    });
    console.log(id + " " + arm + " FAILED " + e.message);
  }
  saveReport(path.join(root, "live-" + stage + ".json"), {
    rows,
    physicalTests: 0,
    humanBlindEvaluation: false,
  });
}
function fixture() {
  const t = validationFixture(
    mkdtempSync(path.resolve(".runtime/alpha-live-")),
  );
  const box = t.add("旧纸盒", "手工材料", "", "未知", {
      attributes: {
        material: "纸板（用户报告）",
        dimensions: "20×15×10厘米",
        quantity: 1,
      },
    }),
    painting = t.add("朋友送的画", "装饰", "", "未知", {
      attributes: { quantity: 1 },
    });
  const pref = saveMemory(t.db, t.read, "lin", {
    kind: "interest",
    text: "我喜欢安静的口述故事和轻量手工，不喜欢复杂布置。",
    allowCloud: true,
  });
  return { ...t, box, painting, pref };
}
try {
  const cases = [
    {
      id: "box-story",
      goal: "只用登记的旧纸盒，想得到一种具体的新用途。我喜欢安静的口述故事；不要拍照、不裁切、不碰水、不加热，不增加任何材料。",
      pick: "box",
    },
    {
      id: "goal-combination",
      goal: "只用登记的旧纸盒和朋友送的画，设计一种能反复玩的安静叙事互动。不要损坏画，不假设画能放进盒子，不裁切、不粘贴、不买材料。",
      pick: "both",
    },
    {
      id: "box-practical",
      goal: "只用登记的旧纸盒，在独自练习口头表达时找个具体新用途。不要只是观察物品，不增加材料，不加热不裁切。",
      pick: "box",
    },
  ];
  const only = process.argv.find((s) => s.startsWith("--only="))?.slice(7);
  const baseline = (
    await import("../../.runtime/alpha-baseline/src/lib/life/planning.ts")
  ).planDiscovery;
  for (const c of cases.filter(
    (c) => !only || only === "cases" || only === c.id,
  )) {
    // One fixture and exact item IDs/context/preferences across arms; independent DB snapshots for product writes.
    const t = fixture();
    try {
      const ids = c.pick === "both" ? [t.box, t.painting] : [t.box];
      const info = {
        goal: c.goal,
        itemContexts: sharedItemKnowledge(t.read(), "lin", ids).items,
        creativeFacts: creativeFacts(
          t.read().items.filter((i) => ids.includes(i.id)),
        ),
        authorizedPreferences: [{ id: t.pref.id, text: t.pref.text }],
        minutes: 15,
      };
      await record(c.id, "direct", () =>
        provider("direct").generate(
          "你是通用千问助手。利用所给物品与偏好提出一个具体新用途，解释原理、步骤、关键条件和不确定项，不编造未登记物品或未知性质，不声称已实物验证。输出JSON。",
          info,
          { maxTokens: 1900, timeoutMs: 45000 },
        ),
      );
      await record(c.id, "baseline", () =>
        baseline(
          t.db,
          t.read(),
          "lin",
          {
            goal: c.goal,
            itemIds: ids,
            itemId: c.pick === "box" ? t.box : undefined,
            minutes: 15,
            model: true,
            candidates: 1,
            publicEvidence: false,
          },
          provider("baseline"),
          t.read,
        ),
      );
      await record(c.id, "alpha", () =>
        planDiscovery(
          t.db,
          t.read(),
          "lin",
          {
            goal: c.goal,
            itemIds: ids,
            itemId: c.pick === "box" ? t.box : undefined,
            minutes: 15,
            model: true,
            candidates: 1,
            publicEvidence: false,
          },
          provider("alpha"),
          t.read,
        ),
      );
    } finally {
      t.db.close();
    }
  }
  const t = fixture();
  try {
    const { itemIds } = installAlphaSamples(t.db, t.read, "lin");
    for (const id of itemIds.filter(() => !only || only === "products")) {
      await record("product-" + id, "alpha", () =>
        provider("product").generate(
          "仅根据给定型号资料，列出材质、结构、尺寸、功能、操作/维护、限制、未知和一个有条件的新作用。不得把来源事实升级为实物验证。输出JSON。",
          sharedItemKnowledge(t.read(), "lin", [id]),
          { maxTokens: 1300, timeoutMs: 45000 },
        ),
      );
    }
    if (!only || only === "memory") {
      const p = provider("memory");
      for (const [id, question, itemId] of [
        ["interest", "我最近在学水彩，想练习把日常物品编成小故事。", undefined],
        ["gift", "这幅画是朋友小夏送我的，我把它带到了新住处。", t.painting],
      ])
        await record(id, "natural-chat", () =>
          respond(
            t.db,
            t.read,
            "lin",
            {
              question,
              itemId,
              mode: "auto",
              requestId: crypto.randomUUID(),
              memoryPolicy: "candidates",
              uiContext: { page: "assistant" },
            },
            p,
          ),
        );
      const candidates = listMemories(t.db, t.read(), "lin").filter(
        (m) => m.status === "candidate",
      );
      rows.push({ id: "candidates-before-confirmation", candidates });
      const gift = candidates.find((m) => m.kind === "relationship");
      if (gift) {
        saveMemory(
          t.db,
          t.read,
          "lin",
          {
            kind: gift.kind,
            text: gift.text,
            itemId: t.painting,
            status: "active",
            allowCloud: true,
          },
          gift.id,
        );
        await record("gift-cross-session", "alpha", () =>
          respond(
            t.db,
            t.read,
            "lin",
            {
              question: "你还记得这幅画是谁送给我的？不要推测日期。",
              itemId: t.painting,
              mode: "story",
              requestId: crypto.randomUUID(),
              memoryPolicy: "off",
            },
            p,
          ),
        );
        saveMemory(
          t.db,
          t.read,
          "lin",
          {
            kind: gift.kind,
            text: "更正：这幅画是朋友小林送给我的，不是小夏。",
            itemId: t.painting,
            status: "active",
            allowCloud: true,
          },
          gift.id,
        );
        await record("gift-corrected", "alpha", () =>
          respond(
            t.db,
            t.read,
            "lin",
            {
              question: "这幅画的赠送者是谁？请使用更正后的记录。",
              itemId: t.painting,
              mode: "story",
              requestId: crypto.randomUUID(),
              memoryPolicy: "off",
            },
            p,
          ),
        );
        const dad = listMemories(t.db, t.read(), "dad");
        rows.push({
          id: "private-other-role",
          pass: !dad.some((m) => m.id === gift.id),
        });
        forgetMemory(t.db, "lin", gift.id);
        await record("gift-forgotten", "alpha", () =>
          respond(
            t.db,
            t.read,
            "lin",
            {
              question: "你还记得这幅画是谁送给我的？",
              itemId: t.painting,
              mode: "story",
              requestId: crypto.randomUUID(),
              memoryPolicy: "off",
            },
            p,
          ),
        );
      } else rows.push({ id: "gift-candidate-missing", pass: false });
    }
  } finally {
    t.db.close();
  }
} finally {
  await server.close();
  saveReport(path.join(root, "live-" + stage + ".json"), {
    rows,
    requests: server.ledger.attempts.length,
    estimatedCny: server.ledger.attempts.reduce(
      (s, a) => s + a.estimatedCny,
      0,
    ),
    physicalTests: 0,
    humanBlindEvaluation: false,
  });
}
