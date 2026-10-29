import { validateModelPacket } from "../src/lib/agent/graph.ts";
import { routeProductTurn } from "../src/lib/home/router.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import path from "node:path";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { recognizeProduct } from "../src/lib/life/product-arrival.ts";
import { createLifeItem } from "../src/lib/life/intake.ts";
import { buildContext } from "../src/lib/context/builder.ts";
import {
  saveMemory,
  forgetMemory,
  savePersona,
  getPersona,
} from "../src/lib/memory/store.ts";
import {
  saveFragment,
  listFragments,
  deleteFragment,
} from "../src/lib/life/stories.ts";
import { respond } from "../src/lib/agent/service.ts";
const fixture = () => {
  mkdirSync(".runtime", { recursive: true });
  return validationFixture(
    mkdtempSync(path.resolve(".runtime/personal-test-")),
  );
};
test("商品名称和精确官方链接可识别，网页失败不伪装新事实", async () => {
  const cached = await recognizeProduct({ query: "SAMLA" });
  assert.equal(cached.products.length, 1);
  const pack = cached.products[0].pack;
  let calls = 0;
  const fresh = await recognizeProduct(
    { query: pack.source.url, refresh: true },
    async () => {
      calls++;
      return {
        url: pack.source.url,
        title: "官方页",
        text: "194.408.48 SAMLA",
        links: [{ title: "说明书", url: "https://www.ikea.cn/example.pdf" }],
      };
    },
  );
  assert.equal(calls, 1);
  assert.equal(fresh.products[0].retrieval.status, "official-page-read");
  assert.equal(fresh.products[0].retrieval.manuals.length, 1);
  const failed = await recognizeProduct(
    { query: "KNAGGLIG", refresh: true },
    async () => {
      throw Error("HTTP403");
    },
  );
  assert.equal(failed.products[0].retrieval.status, "reviewed-cache");
  assert.match(failed.products[0].retrieval.message, /无法/);
  const wrong = await recognizeProduct(
    { query: "SAMLA", refresh: true },
    async () => ({
      url: pack.source.url,
      title: "登录",
      text: "请登录",
      links: [],
    }),
  );
  assert.equal(wrong.products[0].retrieval.status, "reviewed-cache");
});
test("未知商城链接不猜测型号，危险地址拒绝且不发请求", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw Error("unexpected");
  };
  assert.equal(
    (
      await recognizeProduct(
        { query: "https://detail.tmall.com/item.htm?id=123", refresh: true },
        fetcher,
      )
    ).products.length,
    0,
  );
  assert.equal(
    (
      await recognizeProduct(
        { query: "https://www.ikea.cn/other-samla/", refresh: true },
        fetcher,
      )
    ).products.length,
    0,
  );
  await assert.rejects(
    recognizeProduct({ query: "https://127.0.0.1/private" }, fetcher),
  );
  assert.equal(calls, 0);
});
test("个人商品确认、合成身份、照片归属与录入重试均受事务保护", async () => {
  const t = fixture();
  try {
    const pack = (await recognizeProduct({ query: "SAMLA" })).products[0].pack;
    const v = {
      requestId: crypto.randomUUID(),
      name: "测试旅行盒",
      brand: "IKEA",
      model: pack.model,
      packId: pack.id,
      category: "收纳用品",
      lifecycle: "长期耐用",
      availability: "unknown",
      confirmed: true,
      synthetic: true,
      location: "新房间",
      note: "我的盖子有划痕",
    };
    assert.throws(() => createLifeItem(t.db, t.read, "lin", v), /确认拥有/);
    const first = createLifeItem(t.db, t.read, "lin", {
      ...v,
      ownsConfirmed: true,
    }).item;
    assert.equal(first.synthetic, true);
    assert.equal(first.note, v.note);
    assert.equal(first.location, v.location);
    assert.equal(first.productBinding?.packId, pack.id);
    assert.equal(first.attributes?.material, undefined);
    assert.equal(
      createLifeItem(t.db, t.read, "lin", { ...v, ownsConfirmed: true }).item
        .id,
      first.id,
    );
    const before = t.read().items.length;
    assert.throws(
      () =>
        createLifeItem(t.db, t.read, "lin", {
          ...v,
          requestId: crypto.randomUUID(),
          ownsConfirmed: true,
          mediaId: crypto.randomUUID(),
        }),
      /照片未获授权/,
    );
    assert.equal(t.read().items.length, before);
  } finally {
    t.db.close();
  }
});
test("关系只在本件物品明确选择后参与普通帮助；云端、临时、其他用户和分身授权独立", () => {
  const t = fixture();
  try {
    const itemId = t.add("合成赠画", "画作", "未知", "待确认", {
      attributes: { dimensions: "40×30厘米" },
    });
    const m = saveMemory(t.db, t.read, "lin", {
      kind: "relationship",
      itemId,
      text: "这幅画是朋友小夏送给我的。",
      allowCloud: true,
    });
    const input = {
      question: "新房间的书桌宽80厘米，怎么摆这幅画？",
      mode: "auto",
      itemId,
      taskMemoryOnly: true,
    };
    assert.equal(
      buildContext(t.db, t.read(), "lin", input).cloudMemories.length,
      0,
    );
    assert.equal(
      buildContext(t.db, t.read(), "lin", {
        ...input,
        includeItemRelationships: true,
      }).cloudMemories[0].id,
      m.id,
    );
    assert.equal(
      buildContext(t.db, t.read(), "lin", {
        ...input,
        includeItemRelationships: true,
        temporary: true,
      }).cloudMemories.length,
      0,
    );
    const state = t.read();
    state.items.find((i) => i.id === itemId)!.shared = true;
    t.write(state);
    assert.equal(
      buildContext(t.db, t.read(), "dad", {
        ...input,
        includeItemRelationships: true,
      }).cloudMemories.length,
      0,
    );
    const other = t.add("另一幅画", "画作", "未知", "待确认");
    assert.equal(
      buildContext(t.db, t.read(), "lin", {
        ...input,
        itemId: other,
        includeItemRelationships: true,
      }).cloudMemories.length,
      0,
    );
    savePersona(t.db, t.read(), "lin", {
      enabled: true,
      nickname: "小夏的画",
      avatar: "frame",
      style: "warm",
      memoryUse: "off",
      itemId,
    });
    assert.equal(
      buildContext(t.db, t.read(), "lin", {
        ...input,
        includeItemRelationships: true,
      }).cloudMemories.length,
      0,
    );
    savePersona(t.db, t.read(), "lin", {
      enabled: false,
      nickname: "画画",
      avatar: "sun",
      style: "playful",
      memoryUse: "relevant",
      itemId,
    });
    assert.equal(
      buildContext(t.db, t.read(), "lin", {
        ...input,
        includeItemRelationships: true,
      }).cloudMemories.length,
      1,
    );
    const corrected = saveMemory(
      t.db,
      t.read,
      "lin",
      {
        kind: "relationship",
        itemId,
        text: "纠正：这幅画是同事阿禾送的，不是小夏。",
        allowCloud: false,
      },
      m.id,
    );
    let ctx = buildContext(t.db, t.read(), "lin", {
      ...input,
      includeItemRelationships: true,
    });
    assert.equal(ctx.cloudMemories.length, 0);
    assert.equal(ctx.memories[0].text, corrected.text);
    forgetMemory(t.db, "lin", m.id);
    assert.equal(
      buildContext(t.db, t.read(), "lin", {
        ...input,
        includeItemRelationships: true,
      }).memories.length,
      0,
    );
    assert.equal(getPersona(t.db, "dad", itemId).enabled, false);
    assert.throws(() =>
      savePersona(t.db, t.read(), "dad", {
        enabled: true,
        nickname: "盗用",
        style: "warm",
        itemId,
      }),
    );
  } finally {
    t.db.close();
  }
});
test("同一会话明确切回物间会清除分身身份，关系授权逐轮覆盖", async () => {
  const t = fixture();
  try {
    const itemId = t.add("合成赠画", "画作", "未知", "待确认");
    savePersona(t.db, t.read(), "lin", {
      enabled: true,
      nickname: "小画",
      style: "warm",
      avatar: "frame",
      itemId,
    });
    const offline = {
      ready: false,
      model: "offline",
      generate: async () => {
        throw Error("offline");
      },
    };
    const first = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        itemId,
        question: "你好",
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { page: "item", companion: true, useItemMemories: true },
      },
      offline,
    );
    assert.equal(first.session.known.companionItemId, itemId);
    const next = await respond(
      t.db,
      t.read,
      "lin",
      {
        sessionId: first.session.id,
        requestId: crypto.randomUUID(),
        itemId,
        question: "你好",
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { page: "item", companion: false, useItemMemories: false },
      },
      offline,
    );
    assert.equal(next.session.known.companionItemId, undefined);
    assert.equal(next.session.known.useItemMemories, "no");
    assert.equal(
      next.session.known.itemMemoryBoundary,
      String(first.session.messages.length),
    );
  } finally {
    t.db.close();
  }
});

test("故事确认后只有单一记忆来源，纠正/遗忘不复活原文，编辑或删除故事撤回派生记忆", () => {
  const t = fixture();
  try {
    const itemId = t.add("合成画", "画作", "未知", "未知");
    let f = saveFragment(t.db, t.read, "lin", {
      text: "朋友小夏送给我的画",
      itemIds: [itemId],
      allowRecall: true,
      allowCloud: true,
    });
    const v = { kind: "relationship", itemId, text: f.text, allowCloud: true };
    const requestId = crypto.randomUUID();
    const m = saveMemory(t.db, t.read, "lin", v, undefined, requestId, {
      id: f.id,
      revision: f.revision,
    });
    assert.equal(
      saveMemory(t.db, t.read, "lin", v, undefined, requestId, {
        id: f.id,
        revision: f.revision,
      }).id,
      m.id,
    );
    f = listFragments(t.db, t.read(), "lin", itemId)[0];
    assert.equal(f.allowRecall, false);
    assert.equal(f.allowCloud, false);
    assert.throws(
      () =>
        saveMemory(t.db, t.read, "lin", v, undefined, crypto.randomUUID(), {
          id: f.id,
          revision: f.revision,
        }),
      /已保留关系记忆/,
    );
    saveMemory(t.db, t.read, "lin", { ...v, text: "纠正：同事阿禾送的" }, m.id);
    const input = {
      question: "这幅画是谁送的？",
      itemId,
      mode: "auto",
      taskMemoryOnly: true,
      includeItemRelationships: true,
    };
    let ctx = buildContext(t.db, t.read(), "lin", input);
    assert.equal(ctx.cloudFragments.length, 0);
    assert.equal(ctx.cloudMemories[0].text, "纠正：同事阿禾送的");
    forgetMemory(t.db, "lin", m.id);
    ctx = buildContext(t.db, t.read(), "lin", input);
    assert.equal(ctx.cloudFragments.length, 0);
    assert.equal(ctx.memories.length, 0);
    const m2 = saveMemory(
      t.db,
      t.read,
      "lin",
      v,
      undefined,
      crypto.randomUUID(),
      { id: f.id, revision: f.revision },
    );
    f = listFragments(t.db, t.read(), "lin", itemId)[0];
    saveFragment(t.db, t.read, "lin", {
      id: f.id,
      revision: f.revision,
      text: "改写后的私人原文",
      itemIds: [itemId],
    });
    assert.equal(
      buildContext(t.db, t.read(), "lin", input).memories.some(
        (m) => m.id === m2.id,
      ),
      false,
    );
    f = listFragments(t.db, t.read(), "lin", itemId)[0];
    const m3 = saveMemory(
      t.db,
      t.read,
      "lin",
      { ...v, text: f.text },
      undefined,
      crypto.randomUUID(),
      { id: f.id, revision: f.revision },
    );
    f = listFragments(t.db, t.read(), "lin", itemId)[0];
    deleteFragment(t.db, t.read(), "lin", f.id, f.revision);
    assert.equal(
      buildContext(t.db, t.read(), "lin", input).memories.some(
        (m) => m.id === m3.id,
      ),
      false,
    );
  } finally {
    t.db.close();
  }
});

test("物品页面的普通使用目标不丢进全库存规划，明确新玩法仍可探索", () => {
  const t = fixture();
  try {
    const itemId = t.add("合成旅行盒", "收纳", "IKEA", "194.408.48");
    const session = {
      itemId,
      known: { uiPage: "item" },
      messages: [],
      mode: "auto",
    } as any;
    assert.equal(
      routeProductTurn(
        "我想在新房间书桌上放旅行纪念品，怎样利用它，同时不让灰尘落进去？",
        t.read(),
        "lin",
        session,
      ).intent,
      "help",
    );
    assert.equal(
      routeProductTurn("这件物品还有哪些新用途？", t.read(), "lin", session)
        .intent,
      "plan",
    );
  } finally {
    t.db.close();
  }
});

test("个人空间条件可参与有来源的型号回答，但没有提供的数值仍拒绝",async()=>{
 const t=fixture();try {const pack=(await recognizeProduct({query:"SAMLA"})).products[0].pack;
 const item=createLifeItem(t.db,t.read,"lin",{name:"测试旅行盒",brand:"IKEA",model:pack.model,category:"收纳",lifecycle:"长期耐用",availability:"available",packId:pack.id,confirmed:true,ownsConfirmed:true,synthetic:true}).item;
 const ctx=buildContext(t.db,t.read(),"lin",{question:"桌宽80厘米，盒子宽多少？",mode:"service",itemId:item.id,taskMemoryOnly:true});
 const packet={kind:"supported",answer:"盒子的组合外宽28厘米；你说的桌宽是80厘米，内部净尺寸未知。",factIds:["samla:size"],procedureId:null,questions:[]};
 assert.equal(validateModelPacket(JSON.stringify(packet),ctx,"service",[],[]).source,"model-with-evidence");
 assert.throws(()=>validateModelPacket(JSON.stringify({...packet,answer:"厂家确认承重999公斤。"}),ctx,"service",[],[]),/数值|物品条件/);
 }finally{t.db.close();}
});
