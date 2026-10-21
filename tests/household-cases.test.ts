import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { seed, mutate, type State } from "../src/lib/domain.ts";
import { migrate } from "../src/lib/migrations.ts";
import {
  installHouseholdCases,
  demoMemoryId,
} from "../src/lib/demo/install.ts";
import { householdCases } from "../src/lib/demo/household-cases.ts";
import { householdProductPacks } from "../src/lib/catalog/household-products.ts";
import { productPacks, findPack } from "../src/lib/products.ts";
import {
  introductionStatus,
  completeIntroduction,
} from "../src/lib/memory/introduction.ts";
import {
  listMemories,
  recallMemories,
  saveMemory,
  forgetMemory,
} from "../src/lib/memory/store.ts";
import {
  captureWorkspace,
  reconcileMemories,
} from "../src/lib/memory/ambient.ts";
import { buildContext } from "../src/lib/context/builder.ts";
import { pruneExpired } from "../src/lib/repositories/retention.ts";
import { readSession, closeSession } from "../src/lib/repositories/sessions.ts";
import { respond } from "../src/lib/agent/service.ts";
import { prepareActivity } from "../src/lib/planning.ts";
import type { Provider } from "../src/lib/ai/provider.ts";
function setup() {
  const filename = path.join(
    mkdtempSync(path.join(tmpdir(), "wujian-cases-")),
    "test.sqlite",
  );
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE workspace(id INTEGER PRIMARY KEY,body TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO workspace VALUES(1,?)").run(JSON.stringify(seed()));
  migrate(db, filename);
  const read = () =>
    JSON.parse(
      (
        db.prepare("SELECT body FROM workspace WHERE id=1").get() as {
          body: string;
        }
      ).body,
    ) as State;
  const provider: Provider = {
    model: "offline",
    async generate() {
      throw Error("Unexpected paid/provider call");
    },
  };
  return { db, filename, read, provider };
}
test("官方资料扩充为十一包三十三事实，案例绑定明确地区型号，演示记忆 ID 可由 API 使用", () => {
  assert.equal(productPacks.length, 11);
  assert.equal(
    productPacks.reduce((n, p) => n + p.claims.length, 0),
    33,
  );
  assert.equal(householdProductPacks.length, 7);
  assert.equal(householdCases.length, 8);
  assert.equal(
    new Set(productPacks.flatMap((p) => p.claims.map((c) => c.id))).size,
    33,
  );
  for (const p of householdProductPacks) {
    assert.ok(
      ["www.mi.com", "www.ikea.cn"].includes(new URL(p.source.url).hostname),
    );
    assert.equal(p.source.kind, "official");
    assert.ok(p.limits.length);
  }
  for (const c of householdCases) {
    assert.ok(findPack(c.packId));
    for (let i = 0; i < 3; i++)
      assert.ok(z.string().uuid().safeParse(demoMemoryId(c.id, i)).success);
  }
  assert.match(findPack("ikea-kallax-79384057")!.claims[0].text, /76.5/);
});
test("案例安装只追加一次，保留用户档案、修改和已遗忘记录，具有升级前备份", () => {
  const f = setup();
  try {
    const before = mutate(f.read(), "lin", "createItem", {
      name: "自己原有的杯子",
    });
    f.db
      .prepare("UPDATE workspace SET body=? WHERE id=1")
      .run(JSON.stringify(before));
    installHouseholdCases(f.db);
    assert.equal(f.read().items.length, before.items.length + 8);
    assert.equal(f.read().memories.filter((m) => m.demo).length, 16);
    assert.equal(
      listMemories(f.db, f.read(), "lin").filter((m) => m.demo).length,
      24,
    );
    const state = f.read();
    state.items.find((i) => i.demo)!.location = "用户调整的位置";
    f.db
      .prepare("UPDATE workspace SET body=? WHERE id=1")
      .run(JSON.stringify(state));
    const memory = listMemories(f.db, f.read(), "lin")[0];
    forgetMemory(f.db, "lin", memory.id);
    installHouseholdCases(f.db);
    reconcileMemories(f.db, f.read(), "lin");
    assert.equal(f.read().items.length, before.items.length + 8);
    assert.equal(
      f.read().items.find((i) => i.demo)!.location,
      "用户调整的位置",
    );
    assert.ok(f.read().items.some((i) => i.name === "自己原有的杯子"));
    assert.ok(
      !listMemories(f.db, f.read(), "lin").some((m) => m.id === memory.id),
    );
    assert.ok(existsSync(f.filename + ".before-v4-to-v5.sqlite"));
  } finally {
    f.db.close();
  }
});
test("案例记忆只在该演示物品召回，不生成真实画像、不进入真实清单或云端", () => {
  const f = setup();
  try {
    installHouseholdCases(f.db);
    captureWorkspace(f.db, f.read(), "lin");
    assert.equal(
      listMemories(f.db, f.read(), "lin").filter((m) => !m.demo).length,
      0,
    );
    assert.equal(
      recallMemories(f.db, f.read(), "lin", "以前的故事", "companion").length,
      0,
    );
    const demo = householdCases[0];
    const bound = recallMemories(
      f.db,
      f.read(),
      "lin",
      "以前的故事",
      "story",
      demo.id,
    );
    assert.ok(bound.length);
    assert.ok(bound.every((m) => m.itemId === demo.id && m.demo));
    assert.equal(listMemories(f.db, f.read(), "dad").length, 0);
    const edited = saveMemory(
      f.db,
      f.read,
      "lin",
      {
        kind: bound[0].kind,
        text: "仍然是案例中的故事",
        itemId: demo.id,
        allowCloud: true,
      },
      bound[0].id,
    );
    assert.equal(edited.demo, true);
    assert.equal(edited.allowCloud, false);
    // Even an incorrectly persisted flag cannot bypass the Context Builder's demo boundary.
    const row = f.db
      .prepare("SELECT body FROM personal_memories WHERE id=?")
      .get(edited.id) as { body: string };
    const body = JSON.parse(row.body);
    body.allowCloud = true;
    f.db
      .prepare("UPDATE personal_memories SET body=? WHERE id=?")
      .run(JSON.stringify(body), edited.id);
    assert.equal(
      buildContext(f.db, f.read(), "lin", {
        question: "以前的故事",
        mode: "companion",
        itemId: demo.id,
      }).cloudMemories.length,
      0,
    );
    const resources = buildContext(f.db, f.read(), "lin", {
      question: "准备出门",
      mode: "ideas",
    }).resources;
    assert.ok(resources.every((r) => !r.id.startsWith("demo-household")));
    assert.ok(
      prepareActivity("野餐", f.read().items, "lin")!.every((r) =>
        r.items.every((i) => !i.demo),
      ),
    );
  } finally {
    f.db.close();
  }
});
test("演示物品对话可以增加案例记忆，但喜好不会升级为全局用户偏好", async () => {
  const f = setup();
  try {
    installHouseholdCases(f.db);
    const itemId = householdCases[0].id;
    const result = await respond(
      f.db,
      f.read,
      "lin",
      {
        itemId,
        mode: "story",
        question: "我喜欢园艺",
        requestId: crypto.randomUUID(),
      },
      f.provider,
    );
    assert.equal(result.modelCalls, 0);
    const memories = listMemories(f.db, f.read(), "lin");
    assert.ok(
      memories.some(
        (m) =>
          m.text === "我喜欢园艺" &&
          m.kind === "interest" &&
          m.demo &&
          m.itemId === itemId,
      ),
    );
    assert.equal(memories.filter((m) => !m.demo).length, 0);
    const recalled = await respond(
      f.db,
      f.read,
      "lin",
      {
        sessionId: result.session.id,
        itemId,
        mode: "story",
        question: "聊聊以前的故事",
        requestId: crypto.randomUUID(),
      },
      f.provider,
    );
    assert.match(recalled.reply.answer, /你喜欢园艺/);
    assert.match(recalled.reply.caveat || "", /案例/);
  } finally {
    f.db.close();
  }
});
test("八个案例的公开规格都可离线检索并给官方引用，不靠填充模型回答", async () => {
  const f = setup();
  try {
    installHouseholdCases(f.db);
    for (const c of householdCases) {
      const r = await respond(
        f.db,
        f.read,
        "lin",
        {
          itemId: c.id,
          question: c.questions[0],
          requestId: crypto.randomUUID(),
        },
        f.provider,
      );
      assert.equal(r.reply.outcome, "answered", c.id + ":" + r.reply.answer);
      assert.equal(r.modelCalls, 0, c.id);
      assert.ok(
        r.reply.citations.some((x) => x.kind === "official"),
        c.id,
      );
    }
  } finally {
    f.db.close();
  }
});
test("首次介绍可保存且幂等，遗忘后不重新出现，合成记忆不占用这次机会", () => {
  const f = setup();
  try {
    installHouseholdCases(f.db);
    assert.equal(introductionStatus(f.db, f.read(), "lin").available, true);
    const input = { requestId: crypto.randomUUID(), text: "我喜欢摄影" };
    completeIntroduction(f.db, f.read(), "lin", input);
    const count = listMemories(f.db, f.read(), "lin").length;
    completeIntroduction(f.db, f.read(), "lin", input);
    assert.equal(listMemories(f.db, f.read(), "lin").length, count);
    assert.equal(introductionStatus(f.db, f.read(), "lin").available, false);
    assert.throws(
      () =>
        completeIntroduction(f.db, f.read(), "lin", {
          requestId: crypto.randomUUID(),
          text: "第二次介绍",
        }),
      /首次介绍已结束/,
    );
    for (const m of listMemories(f.db, f.read(), "lin").filter((m) => !m.demo))
      forgetMemory(f.db, "lin", m.id);
    assert.equal(introductionStatus(f.db, f.read(), "lin").available, false);
  } finally {
    f.db.close();
  }
});
test("首次介绍可跳过并跨进程持久化，按人隔离；已有自然记忆不再催促介绍", () => {
  const f = setup();
  try {
    completeIntroduction(f.db, f.read(), "lin", {
      requestId: crypto.randomUUID(),
      skip: true,
    });
    const second = new DatabaseSync(f.filename);
    assert.equal(introductionStatus(second, f.read(), "lin").available, false);
    assert.equal(introductionStatus(second, f.read(), "dad").available, true);
    second.close();
    saveMemory(f.db, f.read, "dad", { kind: "story", text: "已有自己的故事" });
    assert.equal(introductionStatus(f.db, f.read(), "dad").available, false);
  } finally {
    f.db.close();
  }
});

test("纠正和忘记演示记忆不清空真实物品会话", async () => {
  const f = setup();
  try {
    installHouseholdCases(f.db);
    const real = await respond(
      f.db,
      f.read,
      "lin",
      {
        itemId: "lamp",
        question: "Windows 11 双击速度怎么调",
        requestId: crypto.randomUUID(),
      },
      f.provider,
    );
    const before = readSession(f.db, f.read(), "lin", real.session.id);
    const demo = listMemories(f.db, f.read(), "lin").find((m) => m.demo)!;
    saveMemory(
      f.db,
      f.read,
      "lin",
      { kind: demo.kind, text: "纠正案例内容", itemId: demo.itemId },
      demo.id,
    );
    assert.deepEqual(
      readSession(f.db, f.read(), "lin", real.session.id),
      before,
    );
    forgetMemory(f.db, "lin", demo.id);
    forgetMemory(f.db, "lin", demo.id);
    const another = listMemories(f.db, f.read(), "lin").find((m) => m.demo)!;
    const expiring = {
      ...another,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    f.db
      .prepare("UPDATE personal_memories SET body=? WHERE id=?")
      .run(JSON.stringify(expiring), another.id);
    pruneExpired(f.db, "lin");
    const example = await respond(
      f.db,
      f.read,
      "lin",
      {
        itemId: householdCases[0].id,
        mode: "story",
        question: "我喜欢园艺",
        requestId: crypto.randomUUID(),
      },
      f.provider,
    );
    closeSession(f.db, f.read(), "lin", example.session.id);
    assert.deepEqual(
      readSession(f.db, f.read(), "lin", real.session.id),
      before,
    );
  } finally {
    f.db.close();
  }
});
