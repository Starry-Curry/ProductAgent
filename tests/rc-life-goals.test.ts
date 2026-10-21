import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { planDiscovery } from "../src/lib/life/planning.ts";
import { saveFragment } from "../src/lib/life/stories.ts";
import { organizeStories } from "../src/lib/life/organization.ts";
import { modelIdea } from "../src/lib/life/ideas.ts";
import { savePersona, effectivePersona } from "../src/lib/memory/store.ts";

test("五种生活目标按真实可用资源提供有限离线规划，缩时/排除继续生效", async () => {
  const t = validationFixture(
    mkdtempSync(path.join(process.cwd(), ".runtime", "life-goals-")),
  );
  try {
    const box = t.add("小收纳盒", "厨房用品", "合成", "BOX");
    const shirt = t.add("棉质衬衣", "服装", "合成", "SHIRT");
    const food = t.add("面粉", "食品", "合成", "FLOUR", {
      lifecycle: "消耗型",
      attributes: { quantity: 1 },
    });
    const bag = t.add("旅行背包", "服装", "合成", "BAG");
    const camera = t.add("便携相机", "电子设备", "合成", "CAM", {
      attributes: { capabilities: ["图像记录"] },
    });
    const never = {
      ready: false,
      model: "offline",
      generate: async () => {
        throw Error("No model request permitted");
      },
    };
    for (const [goal, ids, title] of [
      ["整理桌面", [box], /归位/],
      ["衣物搭配", [shirt], /搭配/],
      ["烹饪准备", [food], /开工前/],
      ["出游准备", [bag, shirt], /试装/],
      ["摄影构图", [camera, shirt], /构图/],
    ] as const) {
      const r = await planDiscovery(
        t.db,
        t.read(),
        "lin",
        {
          goal,
          itemIds: [...ids],
          minutes: 15,
          model: false,
          publicEvidence: false,
        },
        never,
        t.read,
      );
      assert.ok(
        r.ideas.some((i) => title.test(i.title)),
        goal,
      );
      assert.ok(
        r.ideas.every((i) =>
          i.itemIds.every((id) => ids.includes(id as never)),
        ),
      );
      assert.equal(r.modelCalls, 0);
    }
    const r = await planDiscovery(
      t.db,
      t.read(),
      "lin",
      {
        goal: "只用衬衣，五分钟衣物搭配",
        itemIds: [shirt, box],
        excludedItemIds: [box],
        minutes: 5,
        model: false,
        publicEvidence: false,
      },
      never,
      t.read,
    );
    assert.ok(r.ideas.every((i) => i.minutes <= 5 && !i.itemIds.includes(box)));
  } finally {
    t.db.close();
  }
});

test("Persona风格与物品伙伴只影响授权表达；创意模型输入有无个人Context可对照并撤销", async () => {
  const t = validationFixture(
    mkdtempSync(path.join(process.cwd(), ".runtime", "persona-context-")),
  );
  try {
    const bag = t.add("旅行背包", "服装", "合成", "BAG");
    for (const style of ["neutral", "warm", "playful"] as const) {
      savePersona(t.db, t.read(), "lin", {
        enabled: false,
        nickname: "物间",
        style,
        memoryUse: "relevant",
      });
      assert.equal(effectivePersona(t.db, "lin").style, style);
    }
    savePersona(t.db, t.read(), "lin", {
      enabled: true,
      nickname: "小包",
      style: "warm",
      itemId: bag,
      memoryUse: "relevant",
    });
    assert.equal(effectivePersona(t.db, "lin", bag).nickname, "小包");
    savePersona(t.db, t.read(), "lin", {
      enabled: false,
      nickname: "小包",
      style: "warm",
      itemId: bag,
      memoryUse: "relevant",
    });
    assert.equal(effectivePersona(t.db, "lin", bag).enabled, false);
    const f = saveFragment(t.db, t.read, "lin", {
      text: "我喜欢轻装旅行",
      itemIds: [],
      allowRecall: true,
      allowCloud: true,
    });
    const data = organizeStories(t.db, t.read, "lin", { command: "extract" });
    const u = data.understanding[0];
    const captured: string[][] = [];
    const provider = {
      ready: true,
      model: "offline-context-probe",
      generate: async (_s: string, input: any) => {
        captured.push(input.preferences);
        return {
          model: "offline-context-probe",
          tokens: null,
          text: JSON.stringify({
            title: "轻装试装",
            itemIds: [bag],
            minutes: 10,
            steps: ["仅将已选物品试放在背包中，核对尺寸与取用顺序。"],
            limits: ["实际容量、重量与状态待确认"],
            missing: ["路线与天气未知"],
            factIds: [],
          }),
        };
      },
    };
    await modelIdea(t.db, t.read(), "lin", "旅行准备", provider, false, t.read);
    assert.deepEqual(captured[0], []);
    organizeStories(t.db, t.read, "lin", {
      command: "confirm",
      id: u.id,
      scope: "旅行",
      allowCloud: true,
    });
    await modelIdea(t.db, t.read(), "lin", "旅行准备", provider, false, t.read);
    assert.deepEqual(captured[1], [f.text]);
    organizeStories(t.db, t.read, "lin", { command: "forget", id: u.id });
    await modelIdea(t.db, t.read(), "lin", "旅行准备", provider, false, t.read);
    assert.deepEqual(captured[2], []);
  } finally {
    t.db.close();
  }
});
