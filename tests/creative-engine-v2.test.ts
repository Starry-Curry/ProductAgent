import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  evidenceInventory,
  boxFits,
  twoRectanglesFit,
  complementGraph,
  type EvidenceInventory,
} from "../src/lib/life/affordances.ts";
import {
  assessMechanism,
  renderActions,
  generateMechanisms,
  type Mechanism,
} from "../src/lib/life/creative-engine-v2.ts";
import { physicalFactSchema } from "../src/lib/life/physical-facts.ts";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { mutate, type Item } from "../src/lib/domain.ts";
import {
  modelIdea,
  listLifeIdeas,
  feedbackIdea,
} from "../src/lib/life/ideas.ts";
import { saveMemory, forgetMemory } from "../src/lib/memory/store.ts";
const fact = (key: string, value: unknown) => ({
  id: randomUUID(),
  key,
  value,
  basis: "user_report",
  component: "本体",
});
function inventory(
  values: Record<string, unknown>[] = [{}, {}],
): EvidenceInventory {
  return {
    items: values.map((data, i) => ({
      ref: "i" + (i + 1),
      id: "id" + i,
      name: "陌生物" + i,
      quantity: 1,
      unknowns: [],
      operations: [],
      facts: Object.entries(data).map(([key, value], j) => ({
        ref: "f" + i + "_" + j,
        item: "i" + (i + 1),
        component: "本体",
        key,
        value,
        basis: "user_report",
        text: key + "=" + JSON.stringify(value),
        sourceRef: "user:" + i + ":" + key,
      })),
    })),
  };
}
const proposal = (
  kind: Mechanism["actions"][number]["kind"] = "group",
): Mechanism => ({
  title: "陌生物品的新作用",
  outcome: "减少出门遗漏",
  mechanism: "假设改变物品组织方式可减少遗漏",
  roles: [
    { item: "i1", function: "提供第一作用", evidence: [] },
    { item: "i2", function: "提供互补作用", evidence: [] },
  ],
  actions: [{ kind, items: ["i1"], target: "i2", component: "本体" }],
  requirements: [],
  assumptions: [],
  extraResources: [],
  preferenceIds: [],
  minutes: 5,
});
test("axis aligned bounds distinguish necessary pass from proof", () => {
  assert.equal(
    boxFits([230, 160, 100], [280, 200, 140]).status,
    "necessary_pass",
  );
  assert.equal(boxFits([400, 300, 20], [280, 200, 140]).status, "impossible");
  assert.equal(boxFits([NaN, 2, 3], [4, 5, 6]).status, "unknown");
  assert.equal(
    twoRectanglesFit([280, 200], [230, 160], [365, 500]).status,
    "necessary_pass",
  ); // rotation can work
  assert.equal(
    twoRectanglesFit([280, 200], [230, 160], [190, 500]).status,
    "impossible",
  );
});
test("material, name and citation do not manufacture elasticity", () => {
  const inv = inventory([{ material: "PP" }, {}]),
    p = proposal("elastic_release");
  const a = assessMechanism(p, inv, "不购买", "goal");
  assert.equal(a.level, "concept");
  assert.equal(renderActions(p, a, inv).length, 0);
  p.requirements = [
    { item: "i1", key: "elastic", evidence: ["f0_0"], why: "需要回弹" },
  ];
  assert.ok(
    assessMechanism(p, inv, "不购买", "goal").checks.some(
      (c) => c.code === "property-binding" && c.status === "contradiction",
    ),
  );
});
test("false traits and nonmagnetic target block unsupported mechanisms", () => {
  const a = assessMechanism(
    proposal("magnetic_hold"),
    inventory([{ magnetic: true }, { magnetic: false }]),
    "不买",
    "goal",
  );
  assert.equal(a.level, "concept");
  assert.ok(a.checks.some((c) => c.status === "contradiction"));
});
test("containment uses internal dimensions, not outer fit as success", () => {
  const p = proposal("contain"),
    inv = inventory([
      { outer_mm: [230, 160, 100] },
      { outer_mm: [280, 200, 140], open_container: true },
    ]);
  const a = assessMechanism(p, inv, "分类", "goal");
  assert.equal(a.level, "conditional");
  assert.ok(a.checks.some((c) => c.detail.includes("只有外尺寸")));
  const bad = assessMechanism(
    p,
    inventory([
      { outer_mm: [400, 300, 20] },
      { inner_mm: [200, 160, 100], open_container: true },
    ]),
    "分类",
    "goal",
  );
  assert.equal(bad.level, "concept");
  assert.equal(renderActions(p, bad, inv).length, 0);
});
test("known load contradiction is not rescued by disclaimer", () => {
  const a = assessMechanism(
    proposal("support"),
    inventory([{ mass_kg: 1.5 }, { flat_surface: true, max_load_kg: 1 }]),
    "架高",
    "goal",
  );
  assert.equal(a.level, "concept");
  assert.ok(
    a.checks.some((c) => c.code === "load" && c.status === "contradiction"),
  );
});
test("nominal tabletop is not available area or stable support", () => {
  const p = proposal("side_by_side");
  p.roles.push({ item: "i3", function: "桌面", evidence: [] });
  p.actions = [
    {
      kind: "side_by_side",
      items: ["i1", "i2"],
      target: "i3",
      component: "本体",
    },
  ];
  const a = assessMechanism(
    p,
    inventory([
      { outer_mm: [280, 200, 140] },
      { outer_mm: [230, 160, 100] },
      { outer_mm: [730, 500, 750] },
    ]),
    "安排",
    "goal",
  );
  assert.equal(a.level, "conditional");
  assert.ok(a.checks.some((c) => c.detail.includes("实际空余")));
});
test("forbidden actions and alien resources cannot become instructions", () => {
  for (const [kind, goal] of [
    ["adhere", "不要粘贴"],
    ["cut", "不裁切"],
    ["purchase", "不买东西"],
  ] as const) {
    const p = proposal(kind),
      inv = inventory(),
      a = assessMechanism(p, inv, goal, "goal");
    assert.equal(a.level, "concept");
    assert.equal(renderActions(p, a, inv).length, 0);
    assert.ok(a.checks.some((c) => c.code === "restriction"));
  }
  const p = proposal();
  p.actions[0].items = ["i9"];
  assert.ok(
    assessMechanism(p, inventory(), "整理", "goal").checks.some(
      (c) => c.code === "action-resource",
    ),
  );
});
test("device operations require the reviewed operation, not a product name", () => {
  const p = proposal("device_operation"),
    a = assessMechanism(
      p,
      inventory([{ light: true }, {}]),
      "旋钮抽签",
      "analogy",
    );
  assert.equal(a.level, "concept");
  assert.ok(a.checks.some((c) => c.code === "device-operation"));
});
test("conflicting reports remain unknown; physical fact data is typed and user-only", () => {
  const inv = inventory([{ elastic: true }, {}]);
  inv.items[0].facts.push({
    ...inv.items[0].facts[0],
    ref: "conflict",
    value: false,
  });
  assert.equal(
    assessMechanism(proposal("elastic_release"), inv, "探索", "goal").level,
    "concept",
  );
  assert.equal(
    physicalFactSchema.safeParse(fact("mass_kg", "heavy")).success,
    false,
  );
  assert.equal(
    physicalFactSchema.safeParse({
      ...fact("elastic", true),
      basis: "official_source",
    }).success,
    false,
  );
  assert.equal(
    physicalFactSchema.safeParse(fact("outer_mm", [1, 2, 3])).success,
    true,
  );
});
test("graph combines only explicit confirmed functions and is not SKU recipes", () => {
  const g = complementGraph(
    inventory([{ clamp: true }, { light: true }, { material: "PP" }]),
  );
  assert.equal(g.combinations.length, 1);
  assert.equal(g.roles.length, 2);
});
test("new fact mutation retains ownership and preserves data on validation failure", () => {
  const f = validationFixture(".runtime/v2-facts-" + randomUUID());
  const id = f.add("测试夹子", "工具", "", "", {});
  const s = mutate(f.read(), "lin", "updateItem", {
    itemId: id,
    attributes: { physicalFacts: [fact("clamp", true)] },
  });
  assert.equal(
    s.items.find((i) => i.id === id)?.attributes?.physicalFacts?.length,
    1,
  );
  assert.throws(() =>
    mutate(s, "dad", "updateItem", {
      itemId: id,
      attributes: { physicalFacts: [] },
    }),
  );
  assert.throws(() =>
    mutate(s, "lin", "updateItem", {
      itemId: id,
      attributes: {
        physicalFacts: [{ ...fact("elastic", true), basis: "official_source" }],
      },
    }),
  );
  assert.equal(
    s.items.find((i) => i.id === id)?.attributes?.physicalFacts?.[0].key,
    "clamp",
  );
  f.db.close();
});
test("model boundary is one call, strict packet, source provenance is not elevated", async () => {
  let calls = 0;
  const inv = inventory(),
    p = proposal();
  const fake: any = {
    generate: async () => {
      calls++;
      return {
        text: JSON.stringify({ ideas: [p] }),
        tokens: null,
        model: "offline-fixture",
      };
    },
  };
  const items = inv.items.map((i) => ({
    id: i.id,
    name: i.name,
    attributes: {},
    availability: "available",
  })) as Item[];
  const g = await generateMechanisms(
    fake,
    items,
    "出门整理",
    { strategy: "analogy", preferences: [], feedback: [], candidates: 1 },
    () => {},
  );
  assert.equal(calls, 1);
  assert.equal(g.candidates[0].assessment.verifiedPhysical, false);
});
test("revocation during generation prevents persistence; feedback dedup is mechanism based", async () => {
  const f = validationFixture(".runtime/v2-auth-" + randomUUID()),
    id = f.add("测试篮", "容器", "", "", {});
  let calls = 0;
  const p = proposal();
  p.roles = p.roles.slice(0, 1);
  p.actions[0].target = undefined;
  const fake: any = {
    generate: async () => {
      calls++;
      return {
        text: JSON.stringify({ ideas: [p] }),
        tokens: null,
        model: "offline-fixture",
      };
    },
  };
  const opts = {
    strategy: "explore" as const,
    engine: "goal" as const,
    itemIds: [id],
    validateOnly: false,
  };
  const first = await modelIdea(
    f.db,
    f.read(),
    "lin",
    "新的用途",
    fake,
    false,
    f.read,
    opts,
  );
  feedbackIdea(f.db, f.read(), "lin", {
    id: first.id,
    outcome: "不感兴趣",
    saved: false,
    note: "换真正不同的作用",
  });
  await assert.rejects(
    () =>
      modelIdea(f.db, f.read(), "lin", "换个方向", fake, false, f.read, opts),
    /没有满足/,
  );
  assert.equal(listLifeIdeas(f.db, f.read(), "lin").length, 1);
  const changing: any = {
    generate: async () => {
      f.write(
        mutate(f.read(), "lin", "updateItem", {
          itemId: id,
          availability: "broken",
        }),
      );
      return fake.generate();
    },
  };
  await assert.rejects(
    () =>
      modelIdea(
        f.db,
        f.read(),
        "lin",
        "探索新用途",
        changing,
        false,
        f.read,
        opts,
      ),
    /已变化/,
  );
  assert.equal(listLifeIdeas(f.db, f.read(), "lin").length, 1);
  f.db.close();
});
