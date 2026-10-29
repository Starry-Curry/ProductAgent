import fs from "node:fs";
import path from "node:path";
import { validationFixture } from "../../scripts/life-validation-fixture.ts";
import { canRead } from "../../src/lib/domain.ts";
import { saveMemory, listMemories } from "../../src/lib/memory/store.ts";

export const root = path.resolve(".runtime/framework-evidence");
export const facts = "朋友小夏送给我这幅画。";
export const preference = "我喜欢安静的手工和讲小故事，不想买新材料。";
export const system =
  "你是物间。必须先调用 read_item 读取当前物品，再仅依据工具结果回答。未知性质必须说未知；用户报告不能升级成实测。朋友送画不证明生日、旅行、亲密程度。不得补充未登记物品。";
export const questions = [
  {
    id: "unknown",
    text: '请调用 read_item，参数 itemId="box"。旧纸盒的材质和承重是什么？只用登记资料。',
    itemId: "box",
  },
  {
    id: "relationship",
    text: '请调用 read_item，参数 itemId="painting"。朋友送的画有什么已明确记录的关系？不要推测日期和其他经历。',
    itemId: "painting",
  },
  {
    id: "failure",
    text: '请调用 read_item，参数 itemId="box"。临时工具失败后最多重试一次，并告诉我未知。',
    itemId: "box",
  },
];
export function fixture(scope = "agent-data-v2") {
  if (!["agent-data-v2", "workflow-data-v2"].includes(scope))
    throw Error("invalid_fixture_scope");
  fs.mkdirSync(root, { recursive: true });
  const t = validationFixture(path.join(root, scope));
  if (!t.read().items.some((i) => i.id === "painting")) {
    const base = {
      category: "其他",
      brand: "",
      model: "未登记",
      region: "",
      location: "",
      owner: "lin",
      shared: false,
      state: "在用",
      icon: "box",
      note: "",
      source: "合成录入",
      availability: "available",
    };
    const state = t.read();
    state.items = [
      { ...base, id: "painting", name: "朋友送的画", attributes: {} },
      {
        ...base,
        id: "box",
        name: "旧纸盒",
        attributes: {
          material: "纸质（用户报告）",
          dimensions: "20×15×10厘米",
        },
      },
      { ...base, id: "hidden", name: "其他人的物品", owner: "dad" },
    ];
    t.write(state);
    saveMemory(
      t.db,
      t.read,
      "lin",
      {
        kind: "relationship",
        text: facts,
        itemId: "painting",
        allowCloud: true,
        status: "active",
      },
      undefined,
      "lab:seed:relation",
    );
    saveMemory(
      t.db,
      t.read,
      "lin",
      {
        kind: "preference",
        text: preference,
        allowCloud: true,
        status: "active",
      },
      undefined,
      "lab:seed:preference",
    );
  }
  t.db.exec(
    "CREATE TABLE IF NOT EXISTS lab_calls(arm TEXT,tool TEXT,request_key TEXT,at INTEGER);CREATE TABLE IF NOT EXISTS lab_gate(run_key TEXT PRIMARY KEY,approved INTEGER NOT NULL DEFAULT 0,revoked INTEGER NOT NULL DEFAULT 0,task_id TEXT);CREATE TABLE IF NOT EXISTS lab_host_runs(run_key TEXT PRIMARY KEY,phase TEXT,body TEXT)",
  );
  return t;
}
export function toolsFor(t, arm, { failOnce = false, actor = "lin" } = {}) {
  let failed = false;
  return {
    read(args) {
      t.db
        .prepare("INSERT INTO lab_calls VALUES(?,?,?,?)")
        .run(arm, "read", args.itemId, Date.now());
      if (failOnce && !failed) {
        failed = true;
        throw Error("temporary_tool_failure");
      }
      const item = t
        .read()
        .items.find((i) => i.id === args.itemId && canRead(i, actor));
      if (!item) throw Error("denied");
      return {
        id: item.id,
        name: item.name,
        brand: item.brand || null,
        model: item.model,
        attributes: item.attributes || {},
        basis: "user_report",
        unknown:
          item.id === "painting"
            ? ["画框材质", "日期", "其他关系细节"]
            : ["承重", "耐热", "食品接触"],
        relationship: listMemories(t.db, t.read(), actor)
          .filter(
            (m) =>
              m.status === "active" &&
              m.kind === "relationship" &&
              m.itemId === item.id &&
              m.allowCloud,
          )
          .map((m) => ({ id: m.id, text: m.text, basis: m.source })),
        preferences: listMemories(t.db, t.read(), actor)
          .filter(
            (m) =>
              m.status === "active" && m.kind === "preference" && m.allowCloud,
          )
          .map((m) => m.text),
      };
    },
    commit(runKey, crash = false) {
      const gate = t.db
        .prepare("SELECT * FROM lab_gate WHERE run_key=?")
        .get(runKey);
      if (!gate?.approved || gate.revoked) throw Error("authorization_denied");
      t.db
        .prepare("INSERT INTO lab_calls VALUES(?,?,?,?)")
        .run(arm, "commit_attempt", runKey, Date.now());
      const before = t.db
        .prepare(
          "SELECT target_id FROM action_receipts WHERE owner=? AND request_id=?",
        )
        .get("lin", runKey);
      const memory = saveMemory(
        t.db,
        t.read,
        "lin",
        {
          kind: "preference",
          text: "我愿意用旧纸盒讲小故事。",
          itemId: "box",
          allowCloud: true,
          status: "active",
        },
        undefined,
        runKey,
      );
      if (!before)
        t.db
          .prepare("INSERT INTO lab_calls VALUES(?,?,?,?)")
          .run(arm, "effect", runKey, Date.now());
      if (crash) process.exit(73); // fault injection after domain commit, before runtime completion
      return { memoryId: memory.id, reused: !!before };
    },
  };
}
export function saveReport(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { flush: true });
}
