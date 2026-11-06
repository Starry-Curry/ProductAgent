import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { seed, type Item } from "../src/lib/domain.ts";
import {
  matchInventoryQuestion,
  isEventPreparationRequest,
} from "../src/lib/companion/item-matching.ts";
import {
  createReviewedEventPlan,
  trimEventProposal,
  eventProposalSchema,
  type EventProposal,
} from "../src/lib/companion/event-planning.ts";
import {
  createEventPlan,
  mutateCompanion,
  companionData,
} from "../src/lib/companion/store.ts";
import { recognizeOwnedPhoto } from "../src/lib/life/vision.ts";
import { createProvider, type Provider } from "../src/lib/ai/provider.ts";
import {
  issueVisitor,
  readVisitor,
  visitorContext,
  registry,
} from "../src/lib/cloud/runtime.ts";
const env = {
  AI_API_KEY: "offline-fixture",
  AI_BASE_URL: "https://example.test/v1",
  AI_MODEL: "text-fixture",
  AI_VISION_MODEL: "vision-fixture",
  AI_ALLOW_PAID_CALLS: "true",
  WUJIAN_ALLOW_PAID_CALLS: "true",
};
function device(
  id: string,
  name: string,
  shared = true,
  owner: "lin" | "dad" | "friend" = "lin",
): Item {
  return {
    ...seed().items[0],
    id,
    name,
    shared,
    owner,
    model: "known",
    availability: "available",
    state: "在用",
  };
}
const proposal: EventProposal = {
  title: "家里六人聚会",
  people: 6,
  assumptions: ["先按吃点东西、听歌和聊天安排。"],
  items: [
    {
      label: "餐食与零食",
      matchTerms: ["零食", "餐食"],
      quantity: "6人份",
      reason: "大家一起吃点东西",
      priority: "essential",
    },
    {
      label: "一起听音乐",
      matchTerms: ["音箱", "音响"],
      quantity: "1套",
      reason: "播放背景音乐",
      priority: "recommended",
    },
    {
      label: "座位与桌面",
      matchTerms: ["椅子", "边桌"],
      quantity: "6个座位",
      reason: "方便围坐聊天",
      priority: "essential",
    },
  ],
};
function model(replies: Array<string | Error>) {
  const inputs: string[] = [];
  const provider: Provider = {
    ready: true,
    model: "offline-stub",
    generate: async (_system, input) => {
      inputs.push(String(input));
      const v = replies.shift();
      if (v instanceof Error) throw v;
      return { text: v || "", model: "offline-stub", tokens: null };
    },
  };
  return { provider, inputs };
}
test("household aliases identify water separately from air and only suggest readable objects", () => {
  const items = [
    device("water", "家里的净水器"),
    device("air", "空气净化器"),
    device("secret", "私人的净水机", false, "dad"),
  ];
  assert.deepEqual(
    matchInventoryQuestion("净水机怎么取热水", items, "lin").candidates.map(
      (i) => i.id,
    ),
    ["water"],
  );
  assert.deepEqual(
    matchInventoryQuestion("空气净化机怎么换滤芯", items, "lin").candidates.map(
      (i) => i.id,
    ),
    ["air"],
  );
  assert.equal(
    matchInventoryQuestion("净水机怎么用", items, "friend").candidates.length,
    0,
  );
  assert.equal(
    matchInventoryQuestion("我家里的净水器怎么用", items, "lin").alias,
    false,
  );
});
test("alias confirmation preserves ambiguity rather than silently choosing the wrong device", () => {
  const items = [device("one", "厨房净水器"), device("two", "卧室饮水机")];
  assert.equal(
    matchInventoryQuestion("饮水机", items, "lin").candidates.length,
    2,
  );
  const duplicate = {
    ...items[0],
    id: "duplicate",
    referenceProductId: "same-reference",
    synthetic: true,
  };
  assert.equal(
    matchInventoryQuestion(
      "净水机",
      [
        { ...items[0], referenceProductId: "same-reference", synthetic: true },
        duplicate,
      ],
      "lin",
    ).candidates.length,
    1,
  );
});
test("future home party routes to preparation while translation and past memory do not", () => {
  for (const q of [
    "我明天家里开party，帮我准备",
    "我要办一个家庭聚会",
    "周末组织桌游聚会",
    "准备六个人的生日会",
  ])
    assert.equal(isEventPreparationRequest(q), true, q);
  for (const q of [
    "party是什么意思",
    "昨天家里开party，好开心",
    "帮我翻译家庭聚会",
  ])
    assert.equal(isEventPreparationRequest(q), false, q);
});
test("activity planning really runs a second model critique before inventory matching", async () => {
  const state = seed();
  state.items = [
    device("speaker", "随身音箱"),
    device("table", "客厅边桌"),
    device("private", "秘密收藏", false, "dad"),
  ];
  const fixture = model([
    JSON.stringify({
      ...proposal,
      items: [
        ...proposal.items,
        {
          label: "背包",
          matchTerms: ["背包"],
          quantity: "1个",
          reason: "旧草稿的偏题项",
          priority: "optional",
        },
      ],
    }),
    JSON.stringify(proposal),
  ]);
  const result = await createReviewedEventPlan(
    state,
    "lin",
    "明天家里开party，6个人",
    fixture.provider,
  );
  assert.equal(fixture.inputs.length, 2);
  assert.ok(!fixture.inputs[0].includes("秘密收藏"));
  assert.equal(result.source, "model-reviewed");
  assert.ok(!result.items.some((i) => i.label === "背包"));
  assert.equal(
    result.items.find((i) => i.label === "一起听音乐")?.itemId,
    "speaker",
  );
  assert.ok(result.scheduledDate);
  assert.equal(
    result.items.find((i) => i.label === "餐食与零食")?.group,
    "missing",
  );
});
test("a failed critique does not claim review; offline party fallback remains relevant", async () => {
  const f = model([JSON.stringify(proposal), Error("review timeout")]);
  const draft = await createReviewedEventPlan(
    seed(),
    "lin",
    "家庭聚会",
    f.provider,
  );
  assert.equal(draft.source, "model-draft");
  assert.match(draft.reviewNote || "", /未完成/);
  const bad = model([Error("first timeout")]);
  const fallback = await createReviewedEventPlan(
    seed(),
    "lin",
    "明天家里party",
    bad.provider,
  );
  assert.equal(fallback.source, "inventory-rules");
  assert.match(fallback.title, /聚会/);
  assert.ok(!fallback.items.some((i) => /背包|记录工具|保温杯/.test(i.label)));
});
test("model plans cannot reintroduce broken or revoked inventory during save", async () => {
  const state = seed();
  state.items = [device("speaker", "音箱")];
  const f = model([JSON.stringify(proposal), JSON.stringify(proposal)]);
  const prepared = await createReviewedEventPlan(
    state,
    "lin",
    "家庭聚会",
    f.provider,
  );
  state.items[0].availability = "broken";
  state.items[0].state = "损坏";
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE workspace(id INTEGER PRIMARY KEY,body TEXT)");
  db.prepare("INSERT INTO workspace VALUES(1,?)").run(JSON.stringify(state));
  const saved = mutateCompanion(
    db,
    state,
    "lin",
    "createPlan",
    { goal: "家庭聚会" },
    prepared,
  ).plan!;
  assert.equal(
    saved.items.find((i) => i.label === "一起听音乐")?.itemId,
    undefined,
  );
  assert.ok(saved.warnings.length);
  const edited = mutateCompanion(db, state, "lin", "updatePlan", {
    id: saved.id,
    revision: saved.revision,
    title: saved.title,
    people: saved.people,
    items: saved.items.map((i) => ({ ...i, done: true })),
  }).plan!;
  assert.equal(edited.items[0].reason, saved.items[0].reason);
  assert.equal(companionData(db, "lin").plans[0].revision, 2);
  db.close();
});
function photoFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE life_media(id TEXT PRIMARY KEY,owner TEXT,mime TEXT,body BLOB)",
  );
  db.prepare("INSERT INTO life_media VALUES(?,?,?,?)").run(
    "photo",
    "lin",
    "image/jpeg",
    Buffer.from("synthetic photo bytes"),
  );
  return db;
}
test("a demo visual model guess is delivered but labelled estimated and never writes an item", async () => {
  const db = photoFixture();
  const p: Provider = {
    ready: true,
    model: "vision-fixture",
    generate: async () => {
      throw Error("not text");
    },
    recognize: async () => ({
      text: JSON.stringify({
        candidates: [
          {
            name: "小米电热水壶",
            brand: "小米",
            model: "MJDSH04YM",
            basis: "visual-inference",
            confidence: 0.65,
            uncertainties: ["外观推测"],
          },
        ],
      }),
      model: "vision-fixture",
      tokens: null,
    }),
  };
  const r = await recognizeOwnedPhoto(
    db,
    "lin",
    "photo",
    true,
    { ...env, WUJIAN_DEMO_ANSWERS: "true" },
    p,
  );
  assert.equal(r.candidates[0].model, "MJDSH04YM");
  assert.equal(r.candidates[0].modelStatus, "estimated");
  assert.equal(r.candidates[0].referenceProductId, "xiaomi-kettle2-uk");
  assert.equal(db.prepare("SELECT count(*) n FROM life_media").get()!.n, 1);
  db.close();
});
test("claiming visible text without a legible model still produces an estimate", async () => {
  const db = photoFixture();
  const p: Provider = {
    ready: true,
    model: "vision-fixture",
    generate: async () => {
      throw Error();
    },
    recognize: async () => ({
      text: JSON.stringify({
        candidates: [
          {
            name: "净水机",
            brand: "飞利浦",
            model: "ADD6910",
            basis: "visible-text",
            observedText: "PHILIPS",
            uncertainties: [],
          },
        ],
      }),
      model: "vision-fixture",
      tokens: null,
    }),
  };
  const r = await recognizeOwnedPhoto(
    db,
    "lin",
    "photo",
    true,
    { ...env, WUJIAN_DEMO_ANSWERS: "true" },
    p,
  );
  assert.equal(r.candidates[0].modelStatus, "estimated");
  db.close();
});
test("vision failure keeps a usable recording path without inventing a random model", async () => {
  const db = photoFixture();
  const p: Provider = {
    ready: true,
    model: "vision-fixture",
    generate: async () => {
      throw Error();
    },
    recognize: async () => {
      throw Error("timeout");
    },
  };
  const r = await recognizeOwnedPhoto(
    db,
    "lin",
    "photo",
    true,
    { ...env, WUJIAN_DEMO_ANSWERS: "true" },
    p,
  );
  assert.equal(r.candidates[0].model, undefined);
  assert.match(r.notice, /没有完成/);
  db.close();
});
test("public vision accepts bounded photo payloads without treating base64 bytes as text tokens", async () => {
  const directory = mkdtempSync(
    path.join(process.cwd(), ".runtime/mobile-release/budget-test-"),
  );
  const config = {
    AUTH_MODE: "public-demo",
    WUJIAN_DEPLOYMENT: "cloud",
    PRODUCT_AGENT_DATA_DIR: directory,
    APP_PUBLIC_ORIGIN: "https://mobile.test",
    DEMO_AI_ENABLED: "true",
    DEMO_ALLOW_VISION: "true",
    AI_ALLOW_PAID_CALLS: "true",
    WUJIAN_ALLOW_PAID_CALLS: "true",
    DEMO_VISITOR_MODEL_CALLS: "40",
    DEMO_DAILY_TOKEN_BUDGET: "500000",
  };
  const previous = Object.fromEntries(
    Object.keys(config).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, config);
  try {
    const visitor = issueVisitor();
    const scope = readVisitor(
      new Request("https://mobile.test", {
        headers: { cookie: "wujian_visitor=" + visitor.token },
      }),
    );
    let sent = 0;
    await visitorContext.run(scope, async () => {
      const p = createProvider(
        {
          ...config,
          AI_API_KEY: "offline",
          AI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          AI_MODEL: "qwen3-vl-plus",
        },
        async () => {
          sent++;
          return Response.json({
            choices: [
              {
                message: { content: '{"candidates":[]}' },
                finish_reason: "stop",
              },
            ],
          });
        },
      );
      await p.recognize!(
        "identify",
        "data:image/jpeg;base64," + "A".repeat(300000),
      );
      assert.equal(sent, 1);
      await assert.rejects(
        p.recognize!(
          "identify",
          "data:image/jpeg;base64," + "A".repeat(3000000),
        ),
        /照片太大/,
      );
      assert.equal(sent, 1);
    });
    const db = registry();
    assert.ok(
      Number(
        db.prepare("SELECT reserved FROM model_requests").get()!.reserved,
      ) < 30000,
    );
    db.close();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("model numeric quantities are accepted and child-party trimming never restores rejected rows", () => {
  const draft = eventProposalSchema.parse({
    ...proposal,
    items: proposal.items.map((i) => ({ ...i, quantity: 6 })),
  });
  assert.equal(draft.items[0].quantity, "6");
  const result = trimEventProposal("8岁孩子生日会，不要酒精和明火", {
    ...proposal,
    items: [
      { ...proposal.items[0], label: "饮料杯" },
      { ...proposal.items[1], label: "含酒精饮料" },
      { ...proposal.items[2], label: "生日蜡烛" },
    ],
  });
  assert.ok(result.items.length >= 3);
  assert.ok(!result.items.some((i) => /饮料杯|含酒精|蜡烛/.test(i.label)));
});

test("compact critique removes obsolete requirements and marks alternatives without regenerating the draft", async () => {
  const f = model([
    JSON.stringify({
      ...proposal,
      items: [
        ...proposal.items,
        { ...proposal.items[0], label: "每人1个水杯" },
      ],
    }),
    JSON.stringify({
      remove: ["每人1个水杯"],
      optional: ["餐食与零食"],
      add: [],
      summary: "去掉普通家用耗材，聚焦本次聚会。",
    }),
  ]);
  const plan = await createReviewedEventPlan(
    seed(),
    "lin",
    "家庭聚会",
    f.provider,
  );
  assert.equal(plan.source, "model-reviewed");
  assert.ok(!plan.items.some((i) => i.label.includes("水杯")));
  assert.equal(
    plan.items.find((i) => i.label === "餐食与零食")?.priority,
    "optional",
  );
});

test("same model does not merge two real household instances", () => {
  const items = [
    {
      ...device("kitchen", "厨房净水器"),
      referenceProductId: "same",
      synthetic: false,
    },
    {
      ...device("study", "书房净水器"),
      referenceProductId: "same",
      synthetic: false,
    },
  ];
  assert.equal(
    matchInventoryQuestion("净水机", items, "lin").candidates.length,
    2,
  );
});
test("declining an item confirmation clears matching for that turn", async () => {
  const { routeProductTurn } = await import("../src/lib/home/router.ts");
  const state = seed();
  const session = {
    itemId: "filter",
    known: { uiPage: "home", uiSkipItemMatch: "true" },
    messages: [],
    tried: [],
  } as any;
  assert.equal(
    routeProductTurn("家里的净水器怎么用", state, "lin", session).itemId,
    undefined,
  );
  assert.equal(
    routeProductTurn("家里的净水器怎么用", state, "lin", {
      ...session,
      known: { uiPage: "home", uiSkipItemMatch: "false" },
    }).itemId,
    "filter",
  );
});

test("inventory matches device concepts, without counting a main device as its accessories or a desk lamp as a table", async () => {
  const { inventoryTermMatches } =
    await import("../src/lib/companion/item-matching.ts");
  assert.equal(inventoryTermMatches("随身音箱", "音响设备"), true);
  assert.equal(inventoryTermMatches("JBL蓝牙音箱", "蓝牙扬声器"), true);
  assert.equal(inventoryTermMatches("散步相机", "相机电池"), false);
  assert.equal(inventoryTermMatches("净水器", "净水器滤芯"), false);
  assert.equal(inventoryTermMatches("书桌上的台灯", "桌面"), false);
  assert.equal(inventoryTermMatches("小边桌", "桌面"), true);
});
test("a dinner-party plan cannot invent children or silently omit the meal", () => {
  const corrected = trimEventProposal("6个人吃饭聊天听音乐，尽量不买新东西", {
    ...proposal,
    assumptions: ["不备餐"],
    items: [
      { ...proposal.items[0], label: "零食拼盘" },
      { ...proposal.items[1], label: "音响设备" },
      { ...proposal.items[2], label: "儿童安全座椅（如有儿童）" },
    ],
  });
  assert.ok(corrected.items.some((i) => /餐食/.test(i.label)));
  assert.ok(!corrected.items.some((i) => /儿童/.test(i.label)));
  assert.ok(!corrected.assumptions.some((i) => /不备餐/.test(i)));
});
