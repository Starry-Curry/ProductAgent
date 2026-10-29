import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { sharedItemKnowledge } from "../src/lib/context/knowledge.ts";
import { buildContext } from "../src/lib/context/builder.ts";
import { saveMemory, forgetMemory } from "../src/lib/memory/store.ts";
import {
  planMemoryStory,
  storytellingMessages,
  canComposeInCloud,
} from "../src/lib/skills/memory-storytelling.ts";
import { modelIdea } from "../src/lib/life/ideas.ts";
import { ProviderError, type Provider } from "../src/lib/ai/provider.ts";
import type { ServiceSession } from "../src/lib/agent/contracts.ts";
import { routeProductTurn } from "../src/lib/home/router.ts";

function setup() {
  const t = validationFixture(
    mkdtempSync(path.join(process.cwd(), ".runtime", "shared-knowledge-")),
  );
  const box = t.add("旧纸盒", "手工", "", "未确认", {
    attributes: {
      material: "纸质",
      dimensions: "20×15×10厘米",
      capabilities: ["容纳轻小物品（待核对状态）"],
    },
  });
  const painting = t.add("朋友送的画", "装饰", "", "未确认");
  return { ...t, box, painting };
}
function session(itemId: string): ServiceSession {
  const at = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    owner: "lin",
    itemId,
    mode: "story",
    revision: 0,
    status: "active",
    messages: [],
    known: {},
    tried: [],
    memoryEpoch: 0,
    createdAt: at,
    updatedAt: at,
    expiresAt: at,
  };
}
test("共享资料只包含登记事实、出处与未知，不带私密字段", () => {
  const t = setup();
  try {
    const state = t.read(),
      item = state.items.find((i) => i.id === t.box)!;
    item.note = "private-note-sentinel";
    item.location = "private-location-sentinel";
    const packet = sharedItemKnowledge(state, "lin", [t.box]);
    assert.equal(packet.items[0].sources.registration.verified, false);
    assert.match(packet.items[0].unknowns.join(" "), /承重/);
    assert(!JSON.stringify(packet).includes("private-"));
    assert.equal(packet.items[0].properties.dimensions, "20×15×10厘米");
  } finally {
    t.db.close();
  }
});
test("共享读取每次重授权，越权不返回部分物品或隐藏名字", () => {
  const t = setup();
  try {
    const state = t.read(),
      item = state.items.find((i) => i.id === t.box)!;
    item.owner = "dad";
    item.shared = false;
    item.name = "hidden-sentinel";
    assert.throws(
      () => sharedItemKnowledge(state, "lin", [t.painting, t.box]),
      (e) => e instanceof Error && !e.message.includes("hidden-sentinel"),
    );
  } finally {
    t.db.close();
  }
});
test("快照仅随获准投影变化，不能冒充持久修订或权限", () => {
  const t = setup();
  try {
    const state = t.read(),
      item = state.items.find((i) => i.id === t.box)!;
    const first = sharedItemKnowledge(state, "lin", [t.box]);
    item.note = "unrelated private change";
    assert.equal(
      sharedItemKnowledge(state, "lin", [t.box]).snapshot.digest,
      first.snapshot.digest,
    );
    item.attributes!.dimensions = "30×20×10厘米";
    assert.notEqual(
      sharedItemKnowledge(state, "lin", [t.box]).snapshot.digest,
      first.snapshot.digest,
    );
    assert.equal(first.snapshot.kind, "legacy-projection-sha256");
  } finally {
    t.db.close();
  }
});
test("共享投影不与原始状态数组共用引用，选择顺序不影响快照", () => {
  const t = setup();
  try {
    const state = t.read(),
      a = sharedItemKnowledge(state, "lin", [t.box, t.painting]);
    assert.equal(
      a.snapshot.digest,
      sharedItemKnowledge(state, "lin", [t.painting, t.box]).snapshot.digest,
    );
    a.items
      .find((i) => i.id === t.box)!
      .properties.capabilities.push("invented");
    assert(
      !state.items
        .find((i) => i.id === t.box)!
        .attributes!.capabilities!.includes("invented"),
    );
  } finally {
    t.db.close();
  }
});
test("聊天与故事使用同一物品资料，关系仅来自显式记忆", () => {
  const t = setup();
  try {
    const memory = saveMemory(t.db, t.read, "lin", {
      kind: "relationship",
      text: "朋友小夏送给我这幅画。",
      itemId: t.painting,
      allowCloud: true,
    });
    const ctx = buildContext(t.db, t.read(), "lin", {
      question: "你还记得这幅画的来历吗？",
      mode: "story",
      itemId: t.painting,
    });
    const plan = planMemoryStory(ctx, session(t.painting))!;
    assert.deepEqual(
      ctx.itemContexts,
      sharedItemKnowledge(t.read(), "lin", [t.painting]).items,
    );
    assert.equal(plan.sources[0].id, memory.id);
    assert(canComposeInCloud(plan));
    const input = JSON.parse(storytellingMessages(plan)[1].content!);
    assert.deepEqual(plan.itemKnowledge, ctx.sharedKnowledge);
    assert.deepEqual(input.itemKnowledge.items, [
      { id: t.painting, name: "朋友送的画" },
    ]);
    assert(!("properties" in input.itemKnowledge.items[0]));
    assert.equal(input.memories[0].text, "朋友小夏送给我这幅画。");
    assert(!JSON.stringify(input).includes("生日"));
  } finally {
    t.db.close();
  }
});
test("私密关系不因共享物品资料而进入模型，遗忘后新会话不召回", () => {
  const t = setup();
  try {
    const memory = saveMemory(t.db, t.read, "lin", {
      kind: "relationship",
      text: "朋友小夏送给我这幅画。",
      itemId: t.painting,
      allowCloud: false,
    });
    const input = {
      question: "你还记得这幅画的来历吗？",
      mode: "story",
      itemId: t.painting,
    };
    const ctx = buildContext(t.db, t.read(), "lin", input);
    assert.equal(ctx.cloudMemories.length, 0);
    assert(!canComposeInCloud(planMemoryStory(ctx, session(t.painting))!));
    assert(!JSON.stringify(ctx.sharedKnowledge).includes("小夏"));
    forgetMemory(t.db, "lin", memory.id);
    assert.equal(buildContext(t.db, t.read(), "lin", input).memories.length, 0);
  } finally {
    t.db.close();
  }
});
test("创意实际发送共享物品资料；超时不生成成功方案", async () => {
  const t = setup();
  let captured: any;
  const provider: Provider = {
    ready: true,
    model: "offline-fixture",
    generate: async (_system, input) => {
      captured = input;
      throw new ProviderError("timeout", "fixture-stop");
    },
  };
  try {
    await assert.rejects(
      modelIdea(
        t.db,
        t.read(),
        "lin",
        "只用旧纸盒构思一个安静的新用途",
        provider,
        false,
        t.read,
        { itemIds: [t.box], candidates: 1 },
      ),
      (e) => e instanceof ProviderError && e.code === "timeout",
    );
    assert.deepEqual(
      captured.itemContexts,
      sharedItemKnowledge(t.read(), "lin", [t.box]).items,
    );
    assert.equal(
      (t.db.prepare("SELECT count(*) n FROM life_ideas").get() as { n: number })
        .n,
      0,
    );
  } finally {
    t.db.close();
  }
});
test("演示物品不能通过普通资料入口混入个人上下文", () => {
  const t = setup();
  try {
    const state = t.read(),
      item = state.items.find((i) => i.id === t.box)!;
    item.demo = {
      caseId: "fixture",
      title: "合成",
      summary: "测试",
      questions: [],
    };
    assert.throws(() => sharedItemKnowledge(state, "lin", [t.box]));
    assert.equal(
      sharedItemKnowledge(state, "lin", [t.box], { demo: true }).items.length,
      1,
    );
  } finally {
    t.db.close();
  }
});
test("正式助手入口的新用途目标包含个人偏好时仍进入创意规划", () => {
  const t = setup();
  try {
    const context = {
      ...session(t.box),
      mode: "auto" as const,
      known: { uiPage: "assistant" },
    };
    const route = routeProductTurn(
      "只用我登记的物品，旧纸盒有什么具体新用途？结合我喜欢安静手工和讲故事的偏好，不买东西、不加热、不碰水、不裁切。",
      t.read(),
      "lin",
      context,
    );
    assert.equal(route.intent, "plan");
    assert.equal(route.mode, "ideas");
  } finally {
    t.db.close();
  }
});
