import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { seed, mutate, type State } from "../src/lib/domain.ts";
import { migrate } from "../src/lib/migrations.ts";
import { migrateLife } from "../src/lib/life/schema.ts";
import { lifeDataDirectory } from "../src/lib/life/data-directory.ts";
import {
  saveFragment,
  listFragments,
  deleteFragment,
  readMedia,
} from "../src/lib/life/stories.ts";
import { storePhoto } from "../src/lib/life/media.ts";
import {
  discoverLife,
  feedbackIdea,
  listLifeIdeas,
} from "../src/lib/life/ideas.ts";
import { cloudStatus } from "../src/lib/life/provider.ts";
import { createProvider } from "../src/lib/ai/provider.ts";
import { createLifeItem } from "../src/lib/life/intake.ts";
import {
  parseCode,
  sourceURL,
  publicAddress,
  saveSource,
  sourceReply,
} from "../src/lib/life/sources.ts";
import { respond } from "../src/lib/agent/service.ts";
import {
  listMemories,
  saveMemory,
  forgetMemory,
} from "../src/lib/memory/store.ts";
import { buildContext } from "../src/lib/context/builder.ts";
import { reconcileMemories } from "../src/lib/memory/ambient.ts";
import { createLifeGift } from "../src/lib/life/gifts.ts";
import { installLifeDemo } from "../src/lib/life/demo.ts";

test("life v1升级v2保留原图文和升级前备份，重复迁移幂等", () => {
  const t = fixture();
  try {
    const f = saveFragment(t.db, t.read, "lin", {
      text: "升级前的合成生活片段",
      itemIds: ["lamp"],
    });
    t.db.exec(
      "DROP TABLE life_requests; DELETE FROM life_schema; INSERT INTO life_schema VALUES(1)",
    );
    migrateLife(t.db, t.file);
    migrateLife(t.db, t.file);
    assert.ok(existsSync(t.file + ".before-life-v2.sqlite"));
    assert.equal(listFragments(t.db, t.read(), "lin")[0].id, f.id);
    assert.equal(
      (
        t.db.prepare("SELECT MAX(version) n FROM life_schema").get() as {
          n: number;
        }
      ).n,
      2,
    );
    assert.equal(
      buildContext(t.db, t.read(), "lin", {
        question: "有哪些新玩法",
        mode: "ideas",
        excludeSynthetic: true,
      }).resources.length,
      0,
    );
  } finally {
    t.db.close();
  }
});

test("资料关键词不是答案；属性局部编辑保留其他维度并拒绝无效日期/数量", () => {
  const t = fixture();
  try {
    const s = t.read();
    saveSource(t.db, s, "lin", {
      itemId: "lamp",
      title: "不完整说明",
      text: "温度和清洁要求请参阅完整说明书。",
      kind: "user-text",
    });
    assert.equal(
      sourceReply(t.db, s, "lin", "lamp", "工作温度是多少度")!.outcome,
      "needs_info",
    );
    saveSource(t.db, s, "lin", {
      itemId: "lamp",
      title: "用户原文",
      text: "清洁时使用干燥软布擦拭，禁止浸泡。工作温度为10至35℃。",
      kind: "user-text",
    });
    assert.equal(
      sourceReply(t.db, s, "lin", "lamp", "工作温度是多少度")!.outcome,
      "answered",
    );
    assert.equal(
      sourceReply(t.db, s, "lin", "lamp", "额定功率是多少瓦")!.outcome,
      "needs_info",
    );
    const a = mutate(s, "lin", "updateItem", {
      itemId: "lamp",
      attributes: {
        material: "塑料",
        care: "干布",
        quantity: 2,
        capabilities: ["照明"],
      },
    });
    const b = mutate(a, "lin", "updateItem", {
      itemId: "lamp",
      attributes: { quantity: 0 },
    });
    assert.equal(
      b.items.find((i) => i.id === "lamp")!.attributes!.care,
      "干布",
    );
    assert.throws(() =>
      mutate(a, "lin", "updateItem", {
        itemId: "lamp",
        attributes: { expiresOn: "2026-02-30" },
      }),
    );
    assert.throws(() =>
      mutate(a, "lin", "updateItem", {
        itemId: "lamp",
        attributes: { quantity: -1 },
      }),
    );
  } finally {
    t.db.close();
  }
});

test("商品指导排除私人经历，明确回忆才读取；临时聊天/遗忘不会重新激活", async () => {
  const t = fixture();
  try {
    const m = saveMemory(t.db, t.read, "lin", {
      kind: "experience",
      itemId: "lamp",
      text: "合成测试：妈妈和我在这盏灯下过生日",
      allowCloud: true,
    });
    assert.ok(
      !buildContext(t.db, t.read(), "lin", {
        question: "这盏灯如何清洁",
        mode: "service",
        itemId: "lamp",
      }).memories.some((x) => x.id === m.id),
    );
    assert.ok(
      buildContext(t.db, t.read(), "lin", {
        question: "回忆生日故事",
        mode: "service",
        itemId: "lamp",
      }).memories.some((x) => x.id === m.id),
    );
    assert.equal(
      buildContext(t.db, t.read(), "lin", {
        question: "回忆生日故事",
        mode: "service",
        itemId: "lamp",
        temporary: true,
      }).memories.length,
      0,
    );
    forgetMemory(t.db, "lin", m.id);
    reconcileMemories(t.db, t.read(), "lin");
    assert.ok(
      !buildContext(t.db, t.read(), "lin", {
        question: "回忆生日故事",
        mode: "service",
        itemId: "lamp",
      }).memories.some((x) => x.id === m.id),
    );
    saveFragment(t.db, t.read, "lin", {
      text: "合成片段：海边散步",
      itemIds: ["lamp"],
    });
    assert.equal(
      recallLifeFragments(t.db, t.read(), "lin", "回忆火星探险经历")!.outcome,
      "needs_info",
    );
  } finally {
    t.db.close();
  }
});

test("创意遵守自然语言时间/室内/静音与数量，开放式模型协议保留条件且不套固定模板", async () => {
  const t = fixture();
  try {
    installLifeDemo(t.db);
    const s = t.read();
    const rows = discoverLife(t.db, s, "lin", {
      goal: "在家静音，10分钟，不要手工",
      minutes: 60,
      includeSynthetic: true,
    });
    assert.ok(
      rows.every(
        (i) => i.minutes <= 10 && !/野餐|散步|音乐|速写/.test(i.title),
      ),
    );
    assert.throws(() =>
      discoverLife(t.db, s, "lin", {
        goal: "短接电源",
        includeSynthetic: true,
      }),
    );
    const input: any[] = [];
    const provider = {
      model: "offline-fixture",
      async generate(_s: string, x: unknown) {
        input.push(x);
        return {
          model: this.model,
          tokens: null,
          text: JSON.stringify({
            title: "用户目标下全新的观察练习",
            itemIds: ["life-sample-13"],
            minutes: 5,
            steps: ["用现有相机比较三种取景"],
            limits: ["确认电量与现场安全；未验证"],
          }),
        };
      },
    };
    const result = await modelIdea(
      t.db,
      s,
      "lin",
      "5分钟摄影",
      provider,
      true,
      t.read,
      { minutes: 10, itemId: "life-sample-13" },
    );
    assert.equal(result.source, "model-creative");
    assert.equal(result.tested, false);
    assert.equal(input[0].minutes, 5);
    await assert.rejects(
      modelIdea(
        t.db,
        s,
        "lin",
        "5分钟摄影",
        {
          ...provider,
          async generate() {
            return { model: "offline", tokens: null, text: "invalid" };
          },
        },
        true,
      ),
      { code: "invalid_response" },
    );
  } finally {
    t.db.close();
  }
});

test("录入响应丢失/资料失败重试不重复建档，资料重试幂等并隔离身份", () => {
  const t = fixture();
  try {
    const input = {
      requestId: crypto.randomUUID(),
      name: "真实新台灯测试",
      category: "电子产品",
      lifecycle: "长期耐用",
      availability: "available",
    };
    const before = t.read().items.length;
    const first = createLifeItem(t.db, t.read, "lin", input);
    assert.throws(() =>
      saveSource(t.db, t.read(), "lin", {
        itemId: first.item.id,
        title: "测试",
        text: "合法的测试资料原文足够长",
        url: "http://127.0.0.1/private",
        kind: "user-link",
      }),
    );
    const retry = createLifeItem(t.db, t.read, "lin", input);
    assert.equal(first.item.id, retry.item.id);
    assert.equal(t.read().items.length, before + 1);
    assert.throws(
      () => createLifeItem(t.db, t.read, "lin", { ...input, name: "changed" }),
      /内容已变化/,
    );
    const v = {
      itemId: first.item.id,
      title: "确认资料",
      text: "本测试物品用干燥软布清洁。",
      kind: "user-text",
    };
    assert.equal(
      saveSource(t.db, t.read(), "lin", v),
      saveSource(t.db, t.read(), "lin", v),
    );
    assert.throws(() => saveSource(t.db, t.read(), "dad", v));
    assert.notEqual(
      createLifeItem(t.db, t.read, "dad", input).item.id,
      first.item.id,
    );
  } finally {
    t.db.close();
  }
});

test("云配置/费用状态与离线Provider错误准确区分，不发出未授权请求", async () => {
  const env = {
    AI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    AI_MODEL: "qwen-plus",
    AI_API_KEY: "",
    AI_ALLOW_PAID_CALLS: "true",
    WUJIAN_ALLOW_PAID_CALLS: "true",
  };
  assert.equal(cloudStatus(env).state, "missing_key");
  let calls = 0;
  const request = async () => {
    calls++;
    return Response.json({});
  };
  await assert.rejects(createProvider(env, request).generate("s", {}), {
    code: "not_configured",
  });
  env.AI_API_KEY = "offline-fixture-not-real";
  env.AI_ALLOW_PAID_CALLS = "false";
  assert.equal(cloudStatus(env).state, "unauthorized");
  await assert.rejects(createProvider(env, request).complete!([], []), {
    code: "payment_not_authorized",
  });
  assert.equal(calls, 0);
  env.AI_ALLOW_PAID_CALLS = "true";
  assert.equal(cloudStatus(env).state, "ready");
  for (const method of ["generate", "complete"] as const) {
    for (const [status, code] of [
      [401, "authentication"],
      [403, "permission"],
      [429, "rate_limited"],
      [503, "upstream"],
    ] as const) {
      const p = createProvider(
        env,
        async () => new Response("ignored-sensitive-upstream-body", { status }),
      );
      await assert.rejects(
        method === "generate" ? p.generate("s", {}) : p.complete!([], []),
        { code },
      );
    }
    const p = createProvider(env, async () => new Response("not-json"));
    await assert.rejects(
      method === "generate" ? p.generate("s", {}) : p.complete!([], []),
      { code: "invalid_response" },
    );
    for(const payload of [null,{choices:[{finish_reason:"stop"}]}]) {
      const invalid=createProvider(env,async()=>Response.json(payload));
      await assert.rejects(method==="generate"?invalid.generate("s",{}):invalid.complete!([],[]),{code:"invalid_response"});
    }
  }
  await assert.rejects(
    createProvider(env, async () => {
      throw new TypeError("secret-like-network-detail");
    }).generate("s", {}),
    (e) =>
      (e as any).code === "network" &&
      !(e as Error).message.includes("secret-like"),
  );
  assert.equal(
    cloudStatus({ ...env, AI_BASE_URL: "http://unsafe" }).state,
    "invalid_config",
  );
});

test("规则创意重复生成复用ID及收藏，旧种子默认为合成且拒绝不可用物品", () => {
  const t = fixture();
  try {
    installLifeDemo(t.db);
    const state = t.read();
    assert.equal(discoverLife(t.db, state, "lin", { goal: "摄影" }).length, 0);
    const first = discoverLife(t.db, state, "lin", {
      goal: "安静",
      includeSynthetic: true,
    });
    assert.ok(first.length);
    feedbackIdea(t.db, state, "lin", {
      id: first[0].id,
      saved: true,
      outcome: "用户报告有效",
    });
    const count = (
      t.db.prepare("SELECT count(*) n FROM life_ideas").get() as { n: number }
    ).n;
    const again = discoverLife(t.db, state, "lin", {
      goal: "安静",
      includeSynthetic: true,
    });
    assert.equal(
      (t.db.prepare("SELECT count(*) n FROM life_ideas").get() as { n: number })
        .n,
      count,
    );
    assert.ok(
      again.some(
        (i) => i.id === first[0].id && i.saved && i.outcome === "用户报告有效",
      ),
    );
    assert.ok(
      listLifeIdeas(t.db, state, "lin").some(
        (i) => i.id === first[0].id && i.saved,
      ),
    );
    for (const id of first[0].itemIds)
      state.items.find((i) => i.id === id)!.attributes = { quantity: 0 };
    assert.ok(
      !discoverLife(t.db, state, "lin", {
        goal: "安静",
        includeSynthetic: true,
      }).some((i) => i.id === first[0].id),
    );
  } finally {
    t.db.close();
  }
});
test("演示安装跨重开可恢复且幂等，25实例/10型号、3片段含2图文，不重置用户数据", () => {
  const t = fixture();
  try {
    installLifeDemo(t.db);
    const s = t.read();
    assert.equal(s.items.filter((i) => !i.demo).length, 25);
    assert.equal(
      new Set(
        s.items
          .filter((i) => !i.demo && i.productBinding)
          .map((i) => i.productBinding!.packId),
      ).size,
      10,
    );
    assert.equal(listFragments(t.db, s, "lin").length, 3);
    assert.equal(
      listFragments(t.db, s, "lin").filter((f) => f.mediaId).length,
      2,
    );
    s.items.find((i) => i.id === "life-sample-14")!.name = "用户改过的绿植";
    t.write(s);
    installLifeDemo(t.db);
    assert.equal(
      t.read().items.find((i) => i.id === "life-sample-14")!.name,
      "用户改过的绿植",
    );
    assert.equal(listFragments(t.db, t.read(), "lin").length, 3);
  } finally {
    t.db.close();
  }
});
import { recallLifeFragments } from "../src/lib/life/recall.ts";
import { submitIdea, modelIdea } from "../src/lib/life/ideas.ts";
test("生活回忆只在主动请求时读取本人原文，删除立即失效且不需要Persona", () => {
  const t = fixture();
  try {
    const f = saveFragment(t.db, t.read, "lin", {
      text: "合成故事：相框来自毕业那一天",
      itemIds: ["frame"],
    });
    assert.equal(
      recallLifeFragments(t.db, t.read(), "lin", "怎么清洁", "frame"),
      undefined,
    );
    assert.match(
      recallLifeFragments(t.db, t.read(), "lin", "回忆以前的故事", "frame")!
        .answer,
      /毕业/,
    );
    assert.equal(
      recallLifeFragments(t.db, t.read(), "dad", "回忆以前的故事"),
      undefined,
    );
    deleteFragment(t.db, t.read(), "lin", f.id, f.revision);
    assert.equal(
      recallLifeFragments(t.db, t.read(), "lin", "回忆以前的故事", "frame"),
      undefined,
    );
  } finally {
    t.db.close();
  }
});
test("用户经验保留来源类型，模型创意返回前重新复核物品授权", async () => {
  const t = fixture();
  try {
    const idea = submitIdea(t.db, t.read(), "lin", {
      title: "用户绘画经验",
      itemIds: ["frame"],
      minutes: 10,
      steps: ["先在纸上画轮廓"],
      limits: ["需有纸笔，未实物验证"],
      sourceUrl: "https://example.org/authorized-post",
    });
    assert.equal(idea.source, "user-submitted");
    assert.equal(idea.tested, false);
    const s = t.read();
    const provider = {
      model: "offline-fixture",
      async generate() {
        const changed = t.read();
        changed.items.find((i) => i.id === "frame")!.availability = "loaned";
        t.write(changed);
        return {
          text: JSON.stringify({
            title: "候选",
            itemIds: ["frame"],
            minutes: 10,
            steps: ["观察画面"],
            limits: ["现场核对"],
          }),
          model: this.model,
          tokens: null,
        };
      },
    };
    await assert.rejects(
      () => modelIdea(t.db, s, "lin", "看看新玩法", provider, true, t.read),
      /状态已变化/,
    );
  } finally {
    t.db.close();
  }
});
test("恢复后回扫仍遵守仅聊天/候选政策，不把候选升级成事实", async () => {
  for (const policy of ["off", "candidates"] as const) {
    const t = fixture();
    try {
      const provider = {
        model: "offline-fixture",
        async generate() {
          return {
            text: JSON.stringify({
              kind: "general",
              answer: "可以继续交流。",
              factIds: [],
              procedureId: null,
              questions: [],
            }),
            model: this.model,
            tokens: null,
          };
        },
      };
      await respond(
        t.db,
        t.read,
        "lin",
        {
          question: "我喜欢绘画",
          mode: "auto",
          memoryPolicy: policy,
          requestId: crypto.randomUUID(),
        },
        provider,
      );
      reconcileMemories(t.db, t.read(), "lin");
      const interests = listMemories(t.db, t.read(), "lin").filter(
        (m) => m.kind === "interest",
      );
      assert.equal(interests.length, policy === "off" ? 0 : 1);
      assert.ok(interests.every((m) => m.status === "candidate"));
    } finally {
      t.db.close();
    }
  }
});
test("生活片段赠礼仅转交明确选中的文字快照，保留作者且不自动采集快照", () => {
  const t = fixture();
  try {
    const f = saveFragment(t.db, t.read, "lin", {
      text: "这只相框的合成来源故事",
      itemIds: ["frame"],
    });
    const gift = createLifeGift(t.db, t.read, "lin", {
      itemId: "frame",
      message: "一份心意",
      fragmentIds: [f.id],
    });
    assert.equal(gift.storySnapshots?.[0].author, "lin");
    assert.equal(gift.stories[0], f.text);
    assert.throws(() =>
      createLifeGift(t.db, t.read, "dad", {
        itemId: "frame",
        message: "越权",
        fragmentIds: [f.id],
      }),
    );
    reconcileMemories(t.db, t.read(), "lin");
    assert.ok(
      !listMemories(t.db, t.read(), "lin").some((m) => m.text === f.text),
    );
    const s = mutate(t.read(), "friend", "claim", {
      token: gift.token,
      received: true,
    });
    t.write(s);
    assert.equal(listFragments(t.db, s, "lin")[0].id, f.id);
    assert.equal(listFragments(t.db, s, "friend").length, 0);
  } finally {
    t.db.close();
  }
});
function fixture() {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "wujian-life-")),
    "test.sqlite",
  );
  const db = new DatabaseSync(file);
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE workspace(id INTEGER PRIMARY KEY,body TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO workspace VALUES(1,?)").run(JSON.stringify(seed()));
  migrate(db, file);
  migrateLife(db, file);
  const read = () =>
    JSON.parse(
      (db.prepare("SELECT body FROM workspace").get() as { body: string }).body,
    ) as State;
  return {
    db,
    file,
    read,
    write: (s: State) =>
      db.prepare("UPDATE workspace SET body=?").run(JSON.stringify(s)),
  };
}
test("新版拒绝旧数据目录及其他工作区；默认独立路径", () => {
  const root = path.resolve("D:/ProductAgent-LifeContext");
  assert.equal(lifeDataDirectory({}, root), path.join(root, "data-life-v1"));
  assert.throws(() =>
    lifeDataDirectory(
      { PRODUCT_AGENT_DATA_DIR: path.join(root, "data") },
      root,
    ),
  );
  assert.throws(() =>
    lifeDataDirectory(
      { PRODUCT_AGENT_DATA_DIR: "D:/ProductAgent-Dev/data" },
      root,
    ),
  );
});
test("生活增量表保留旧库正文、备份并幂等", () => {
  const t = fixture();
  try {
    const before = t.read();
    migrateLife(t.db, t.file);
    assert.deepEqual(t.read(), before);
    assert.ok(existsSync(t.file + ".before-life-v1.sqlite"));
  } finally {
    t.db.close();
  }
});
test("生活片段唯一正文关联多物品，解除关联不删除原文；版本/作者保护", () => {
  const t = fixture();
  try {
    const a = saveFragment(t.db, t.read, "lin", {
      text: "合成毕业旅行",
      itemIds: ["lamp", "frame"],
    });
    assert.equal(listFragments(t.db, t.read(), "lin", "lamp")[0].id, a.id);
    assert.equal(listFragments(t.db, t.read(), "lin", "frame")[0].id, a.id);
    const b = saveFragment(t.db, t.read, "lin", {
      ...{
        id: a.id,
        revision: a.revision,
        text: "更正后的旅行",
        itemIds: ["frame"],
      },
    });
    assert.equal(listFragments(t.db, t.read(), "lin", "lamp").length, 0);
    assert.equal(b.id, a.id);
    assert.throws(() =>
      saveFragment(t.db, t.read, "dad", {
        id: a.id,
        revision: b.revision,
        text: "越权",
        itemIds: [],
      }),
    );
    assert.throws(() => deleteFragment(t.db, t.read(), "lin", a.id, 1));
    deleteFragment(t.db, t.read(), "lin", a.id, b.revision);
    assert.equal(listFragments(t.db, t.read(), "lin").length, 0);
  } finally {
    t.db.close();
  }
});
test("图片验证、去元数据、权限读取及删除清理同一事务", async () => {
  const t = fixture();
  try {
    const bytes = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "red" },
    })
      .jpeg()
      .toBuffer();
    const photo = await storePhoto(t.db, "lin", bytes);
    const a = saveFragment(t.db, t.read, "lin", {
      text: "测试照片",
      mediaId: photo.id,
      itemIds: [],
    });
    assert.throws(() => readMedia(t.db, t.read(), "dad", photo.id));
    assert.equal(
      (await sharp(readMedia(t.db, t.read(), "lin", photo.id).body).metadata())
        .exif,
      undefined,
    );
    deleteFragment(t.db, t.read(), "lin", a.id, a.revision);
    assert.throws(() => readMedia(t.db, t.read(), "lin", photo.id));
    await assert.rejects(() =>
      storePhoto(t.db, "lin", new TextEncoder().encode("not an image at all")),
    );
  } finally {
    t.db.close();
  }
});
test("编码只解析实际内容；内网、IP及带凭证链接被拒", () => {
  assert.equal(parseCode("6901234567892").type, "barcode");
  assert.equal(parseCode("https://example.org/a").type, "url");
  for (const url of [
    "http://example.org",
    "https://127.0.0.1",
    "https://user:pass@example.org",
    "https://localhost",
  ])
    assert.throws(() => sourceURL(url));
  for (const ip of [
    "127.0.0.1",
    "10.2.3.4",
    "169.254.1.2",
    "::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(publicAddress(ip), false);
});
test("新物品ID也参与创意；状态变化阻止尝试；跳过反馈影响下一次", () => {
  const t = fixture();
  try {
    let s = mutate(t.read(), "lin", "createItem", {
      name: "新的台灯",
      category: "照明",
    });
    const i = s.items.at(-1)!;
    s = mutate(s, "lin", "updateItem", {
      itemId: i.id,
      availability: "available",
    });
    t.write(s);
    const ideas = discoverLife(t.db, s, "lin", {
      goal: "摄影",
      itemId: i.id,
      includeSynthetic: true,
    });
    assert.ok(ideas.length > 0);
    assert.ok(ideas[0].itemIds.includes(i.id));
    assert.equal(ideas[0].tested, false);
    s = mutate(s, "lin", "updateItem", {
      itemId: i.id,
      availability: "loaned",
    });
    assert.throws(() =>
      feedbackIdea(t.db, s, "lin", {
        id: ideas[0].id,
        saved: true,
        outcome: "准备尝试",
      }),
    );
    assert.equal(
      discoverLife(t.db, s, "lin", { goal: "摄影", itemId: i.id }).length,
      0,
    );
  } finally {
    t.db.close();
  }
});
test("上传资料是用户提供的摘录，物品共享不自动分享私有文件", () => {
  const t = fixture();
  try {
    saveSource(t.db, t.read(), "lin", {
      itemId: "lamp",
      title: "手工测试说明",
      text: "清洁要求：只用干燥软布，具体条件以原说明为准。",
      kind: "user-text",
    });
    assert.match(
      sourceReply(t.db, t.read(), "lin", "lamp", "清洁要求")!.answer,
      /干燥软布/,
    );
    assert.equal(
      sourceReply(t.db, t.read(), "dad", "lamp", "清洁要求"),
      undefined,
    );
  } finally {
    t.db.close();
  }
});
test("新版聊天候选不自动召回，普通消息保留连续性且不自动写原故事", async () => {
  const t = fixture();
  try {
    const inputs: unknown[] = [];
    const provider = {
      model: "offline-protocol-fixture",
      async generate(_s: string, i: unknown) {
        inputs.push(i);
        return {
          text: JSON.stringify({
            kind: "general",
            answer: "可以继续聊。",
            factIds: [],
            procedureId: null,
            questions: [],
          }),
          model: this.model,
          tokens: null,
        };
      },
    };
    const first = await respond(
      t.db,
      t.read,
      "lin",
      {
        question: "我喜欢摄影",
        mode: "auto",
        memoryPolicy: "candidates",
        requestId: crypto.randomUUID(),
      },
      provider,
    );
    assert.ok(
      listMemories(t.db, t.read(), "lin").every(
        (m) => m.status === "candidate",
      ),
    );
    await respond(
      t.db,
      t.read,
      "lin",
      {
        question: "那今天想聊点别的",
        mode: "auto",
        memoryPolicy: "candidates",
        sessionId: first.session.id,
        expectedRevision: first.session.revision,
        requestId: crypto.randomUUID(),
      },
      provider,
    );
    assert.match(JSON.stringify(inputs.at(-1)), /我喜欢摄影/);
    assert.equal(t.read().memories.length, seed().memories.length);
  } finally {
    t.db.close();
  }
});
