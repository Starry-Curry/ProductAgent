import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { seed, mutate, type State } from "../src/lib/domain.ts";
import { migrate } from "../src/lib/migrations.ts";
import { migrateLife } from "../src/lib/life/schema.ts";
import { planDiscovery } from "../src/lib/life/planning.ts";
import { goalDuration } from "../src/lib/life/planning-constraints.ts";
import { feedbackIdea } from "../src/lib/life/ideas.ts";
import { submitIdea } from "../src/lib/life/ideas.ts";
import {
  saveMemory,
  forgetMemory,
  listMemories,
  recallMemories,
} from "../src/lib/memory/store.ts";
import { saveFragment, listFragments } from "../src/lib/life/stories.ts";
import { buildContext } from "../src/lib/context/builder.ts";
import { reconcileMemories } from "../src/lib/memory/ambient.ts";
import type { Provider } from "../src/lib/ai/provider.ts";

function fixture() {
  const filename = path.join(
      mkdtempSync(path.join(tmpdir(), "wujian-planning-")),
      "test.sqlite",
    ),
    db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE workspace(id INTEGER PRIMARY KEY,body TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO workspace VALUES(1,?)").run(JSON.stringify(seed()));
  migrate(db, filename);
  migrateLife(db, filename);
  const read = () =>
    JSON.parse(
      (db.prepare("SELECT body FROM workspace").get() as { body: string }).body,
    ) as State;
  const write = (s: State) =>
    db.prepare("UPDATE workspace SET body=?").run(JSON.stringify(s));
  const add = (
    name: string,
    category: string,
    attributes: Record<string, unknown>,
  ) => {
    let s = mutate(read(), "lin", "createItem", { name, category });
    const id = s.items.at(-1)!.id;
    s = mutate(s, "lin", "updateItem", {
      itemId: id,
      availability: "available",
      attributes,
    });
    write(s);
    return id;
  };
  const plan = (input: unknown, p: Provider = offline) =>
    planDiscovery(db, read(), "lin", input, p, read);
  return { db, read, write, add, plan };
}
const offline: Provider = {
  ready: false,
  model: "offline",
  generate: async () => {
    throw Error("must remain offline");
  },
};

test("未知品牌/新ID的单物品与跨类别组合支持整理、学习和出行；数量和状态约束真实生效", async () => {
  const t = fixture();
  try {
    const storage = t.add("票据夹A", "办公用品", {
        capabilities: ["storage"],
        quantity: 1,
      }),
      writing = t.add("书写套装B", "文具", {
        capabilities: ["writing"],
        quantity: 1,
      }),
      bag = t.add("随行包C", "出行用品", {
        capabilities: ["carrying"],
        quantity: 1,
      });
    const broken = t.add("停用容器D", "其他", {
      capabilities: ["storage"],
      quantity: 0,
    });
    const organize = await t.plan({ goal: "想整理桌面，预算0元，只有5分钟" });
    assert.ok(
      organize.ideas.some(
        (i) => i.itemIds.length === 1 && i.itemIds.includes(storage),
      ),
    );
    assert.ok(
      organize.ideas.every(
        (i) => i.minutes <= 5 && !i.itemIds.includes(broken),
      ),
    );
    const learn = await t.plan({
      goal: "我有1小时，想学习观察，不买东西",
      itemIds: [storage, writing],
    });
    assert.match(learn.understanding, /60分钟/);
    assert.ok(
      learn.ideas.some(
        (i) => i.itemIds.includes(writing) && i.itemIds.includes(storage),
      ),
    );
    const trip = await t.plan({
      goal: "规划出行，不花钱",
      itemIds: [bag, storage],
    });
    assert.ok(
      trip.ideas.some(
        (i) => i.itemIds.includes(bag) && i.itemIds.includes(storage),
      ),
    );
    assert.ok(trip.missing.length);
    assert.equal(goalDuration("我有1.5小时"), 90);
  } finally {
    t.db.close();
  }
});
test("多轮短名排除和限制保留，换方向不会因为只筛掉前6条而假装库存不足", async () => {
  const t = fixture();
  try {
    const light = t.add("夜跑手电筒", "照明", {
        material: "塑料",
        quantity: 1,
      }),
      glass = t.add("旅行玻璃杯", "厨房用品", {
        material: "玻璃",
        quantity: 1,
      });
    const first = await t.plan({
      goal: "我有一支手电筒和一个玻璃杯，想做点有趣的事，不买东西",
    });
    assert.ok(first.ideas.length);
    const omit = await t.plan({
      goal: "不用手电筒，换个方向",
      previousIdeaIds: first.ideas.map((i) => i.id),
    });
    assert.ok(omit.resources.every((i) => i.id !== light));
    assert.ok(omit.ideas.length);
    assert.ok(omit.ideas.every((i) => i.itemIds.includes(glass)));
    const next = await t.plan({
      goal: "更简单一点",
      previousIdeaIds: omit.ideas.map((i) => i.id),
    });
    assert.ok(next.resources.every((i) => i.id !== light));
    assert.match(next.understanding, /不新增购买/);
    const short = await t.plan({
      goal: "时间减半",
      previousIdeaIds: next.ideas.map((i) => i.id),
    });
    const budget = Math.floor(
      Math.max(...next.ideas.map((i) => i.minutes)) / 2,
    );
    assert.ok(short.ideas.every((i) => i.minutes <= budget));
    const generic = await t.plan({
      goal: "想做有趣的事，不买东西，只有10分钟",
    });
    const omitted = await t.plan({
      goal: "不用手电筒",
      previousIdeaIds: generic.ideas.map((i) => i.id),
      continuation: generic.continuation,
    });
    const keep = await t.plan({
      goal: "更有趣一点",
      previousIdeaIds: omitted.ideas.map((i) => i.id),
      continuation: omitted.continuation,
    });
    assert.ok(keep.resources.every((i) => i.id !== light));
    assert.equal(keep.continuation.minutes, 10);
    assert.ok(keep.continuation.restrictions.includes("不买东西"));
  } finally {
    t.db.close();
  }
});
test("收藏和失败反馈参与规划排序与云端上下文；不相关获准偏好也不滥用，超数量方案被拒", async () => {
  const t = fixture();
  try {
    const id = t.add("收纳容器X", "厨房用品", {
      material: "塑料",
      quantity: 1,
    });
    const first = await t.plan({ goal: "整理桌面" });
    const failed = first.ideas[0];
    feedbackIdea(t.db, t.read(), "lin", {
      id: failed.id,
      saved: true,
      outcome: "未成功",
      note: "私人反馈只留本地",
    });
    saveMemory(t.db, t.read, "lin", {
      kind: "interest",
      text: "我喜欢极地探险",
      allowCloud: true,
    });
    let seen: any;
    const model: Provider = {
      ready: true,
      model: "fixture",
      generate: async (_s, input) => {
        seen = input;
        return {
          text: JSON.stringify({
            title: "离线协议的重新试放",
            itemIds: [id],
            minutes: 5,
            steps: ["先核对尺寸，试放一次并恢复原位"],
            limits: ["尚未实物验证"],
            requirements: [{ itemId: id, quantity: 1 }],
          }),
          model: "fixture",
          tokens: null,
        };
      },
    };
    await t.plan({ goal: "整理桌面，不花钱", engine: "legacy", model: true }, model);
    assert.ok(
      seen.planning.recentFeedback.some((i: any) => i.outcome === "未成功"),
    );
    assert.equal(JSON.stringify(seen).includes("私人反馈只留本地"), false);
    assert.equal(JSON.stringify(seen).includes("极地探险"), false);
    model.generate = async () => ({
      text: JSON.stringify({
        title: "数量过量候选",
        itemIds: [id],
        minutes: 5,
        steps: ["同时使用两个容器分区"],
        limits: ["先确认"],
        requirements: [{ itemId: id, quantity: 2 }],
      }),
      model: "fixture",
      tokens: null,
    });
    await assert.rejects(
      t.plan({ goal: "整理桌面", engine: "legacy", model: true }, model),
      /超出实际登记数量/,
    );
    const repeated = await t.plan({ goal: "整理桌面" });
    assert.ok(!repeated.ideas.some((i) => i.id === failed.id));
    assert.equal((t.db.prepare("SELECT saved FROM life_idea_feedback WHERE idea_id=? AND owner='lin'").get(failed.id) as {saved:number}).saved,1);
  } finally {
    t.db.close();
  }
});
test("赠出后本人长期记忆与跨物品生活片段保留，可纠正/忘记但不泄露给收礼人或普通商品问答", () => {
  const t = fixture();
  try {
    const item = t.add("毕业礼物相机", "电子设备", { quantity: 1 });
    const m = saveMemory(t.db, t.read, "lin", {
      kind: "story",
      text: "毕业那天一起看过蓝色海边",
      itemId: item,
      allowCloud: true,
    });
    const f = saveFragment(t.db, t.read, "lin", {
      text: "毕业那天真实保存的原话",
      itemIds: [item],
    });
    let s = mutate(t.read(), "lin", "gift", { itemId: item, memoryIds: [] });
    const token = s.gifts.at(-1)!.token;
    s = mutate(s, "friend", "claim", { token, received: true });
    t.write(s);
    reconcileMemories(t.db, t.read(), "lin");
    assert.equal(
      listMemories(t.db, t.read(), "lin").find((x) => x.id === m.id)?.archived,
      true,
    );
    assert.equal(
      listFragments(t.db, t.read(), "lin").some((x) => x.id === f.id),
      true,
    );
    assert.equal(
      listFragments(t.db, t.read(), "friend").some((x) => x.id === f.id),
      false,
    );
    assert.equal(
      listMemories(t.db, t.read(), "friend").some((x) => x.id === m.id),
      false,
    );
    assert.equal(
      recallMemories(t.db, t.read(), "lin", "回忆毕业那天", "companion").some(
        (x) => x.id === m.id,
      ),
      true,
    );
    assert.equal(
      buildContext(t.db, t.read(), "lin", {
        question: "怎么使用相机",
        mode: "service",
        taskMemoryOnly: true,
      }).cloudMemories.some((x) => x.id === m.id),
      false,
    );
    const corrected = saveMemory(
      t.db,
      t.read,
      "lin",
      {
        kind: "story",
        text: "更正：毕业时一起看过海边",
        itemId: item,
        allowCloud: false,
      },
      m.id,
    );
    assert.equal(corrected.version, 2);
    assert.throws(
      () =>
        saveMemory(t.db, t.read, "lin", {
          kind: "story",
          text: "不能新建无权物品的关联",
          itemId: item,
        }),
      /没有访问权限/,
    );
    forgetMemory(t.db, "lin", m.id);
    reconcileMemories(t.db, t.read(), "lin");
    assert.equal(
      listMemories(t.db, t.read(), "lin").some((x) => x.id === m.id),
      false,
    );
  } finally {
    t.db.close();
  }
});

test("仅明确选择的本人经验可进入模型，引用可追溯；外部伪造来源ID被拒", async () => {
  const t = fixture();
  try {
    const id = t.add("纸板收纳盒", "手工材料", { material: "纸", quantity: 1 });
    const reference = submitIdea(t.db, t.read(), "lin", {
      title: "合成用户经验：给盒子做归位索引",
      itemIds: [id],
      minutes: 5,
      steps: ["用已有方式标记不同物品的归位位置"],
      limits: ["来源为合成测试，未独立核验"],
      sourceUrl: "https://example.org/synthetic-experience",
    });
    let seen: any;
    const p: Provider = {
      ready: true,
      model: "fixture",
      generate: async (_s, input) => {
        seen = input;
        return {
          text: JSON.stringify({
            title: "离线协议的参考组合",
            itemIds: [id],
            minutes: 5,
            steps: ["先核对容器稳定和尺寸，再试放"],
            limits: ["需本人核对"],
            experienceIds: [reference.id],
          }),
          model: "fixture",
          tokens: null,
        };
      },
    };
    await assert.rejects(
      t.plan({ goal: "整理桌面", engine: "legacy", model: true }, p),
      /未获准提供的经验/,
    );
    const result = await t.plan(
      { goal: "整理桌面", experienceIds: [reference.id], engine: "legacy", model: true },
      p,
    );
    assert.equal(seen.userProvidedExperiences[0].id, reference.id);
    assert.equal(
      result.ideas[0].experienceSources?.[0].url,
      "https://example.org/synthetic-experience",
    );
    const other = await t.plan({
      goal: "不用纸板收纳盒",
      excludedItemIds: [id],
      experienceIds: [reference.id],
    });
    assert.ok(other.missing.some((x) => x.includes("已跳过一份参考经验")));
    await assert.rejects(
      t.plan({ goal: "整理桌面", experienceIds: [crypto.randomUUID()] }),
      /未获授权/,
    );
  } finally {
    t.db.close();
  }
});
