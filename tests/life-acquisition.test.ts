import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, existsSync } from "node:fs";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import {
  acquireKnowledge,
  readKnowledge,
  retrieveKnowledge,
  indexOfficialSource,
  makeKnowledgeDocument,
  knowledgeConflicts,
} from "../src/lib/life/acquisition.ts";
import { saveSource } from "../src/lib/life/sources.ts";
import { groundedReply } from "../src/lib/skills/document-help.ts";
import { respond } from "../src/lib/agent/service.ts";
import { mutate } from "../src/lib/domain.ts";
function fixture() {
  const directory = mkdtempSync(
    path.join(process.cwd(), ".runtime", "acquisition-test-"),
  );
  return { ...validationFixture(directory), directory };
}
test("普通新型号经官方目录定位PDF，按型号/地区缓存与原文定位，更新留旧版本和迁移备份", async () => {
  const t = fixture();
  try {
    const id = t.add("Xiaomi Test Tool", "电子设备", "Xiaomi", "TEST99", {
      region: "uk",
    });
    let reads = 0,
      revision = 1;
    const fetchDocument = async (url: string) => {
      reads++;
      return url.includes("user-guide")
        ? {
            url,
            title: "Official catalog",
            text: "Official guide catalog for products",
            links: [
              {
                title: "Xiaomi Test Tool",
                url: "https://cdn.example.mi-img.com/test.pdf",
              },
            ],
          }
        : {
            url,
            title: "Test manual",
            text: `Model TEST99. Before first use, place on a stable surface. Press the start button to begin. Clean with a soft cloth. Version ${revision}.`,
            links: [],
          };
    };
    const first = await acquireKnowledge(t.db, t.read, "lin", id, {
      fetchDocument,
    });
    assert.equal(first.documents.length, 1);
    assert.equal(reads, 2);
    const cached = await acquireKnowledge(t.db, t.read, "lin", id, {
      fetchDocument,
    });
    assert.equal(cached.cached, true);
    assert.equal(reads, 2);
    const chunks = retrieveKnowledge(t.db, t.read(), "lin", id, "第一次怎么用");
    assert.ok(chunks.length);
    for (const c of chunks)
      assert.equal(first.documents[0].text.slice(c.start, c.end), c.text);
    revision = 2;
    await acquireKnowledge(t.db, t.read, "lin", id, {
      force: true,
      fetchDocument,
    });
    assert.equal(
      (
        t.db
          .prepare(
            "SELECT count(*) n FROM life_knowledge_documents WHERE status='superseded'",
          )
          .get() as { n: number }
      ).n,
      1,
    );
    assert.ok(
      existsSync(path.join(t.directory, "test.sqlite.before-life-v3.sqlite")),
    );
    assert.equal(readKnowledge(t.db, t.read(), "dad", id).length, 0);
  } finally {
    t.db.close();
  }
});

test("本人核对的官方导入无需再次联网即可成为可追溯操作知识，用户文字不冒充官方", () => {
  const t = fixture();
  try {
    const id = t.add("普通新书架", "家具", "宜家", "305.976.49", {
      region: "cn",
    });
    const source = saveSource(t.db, t.read(), "lin", {
      itemId: id,
      title: "305.976.49 官方摘录",
      url: "https://www.ikea.cn/cn/zh/p/30597649/",
      kind: "official-public",
      text: "305.976.49。清洁时使用干燥软布擦拭，避免研磨性清洁剂。",
    });
    indexOfficialSource(t.db, t.read(), "lin", id, source);
    assert.ok(retrieveKnowledge(t.db, t.read(), "lin", id, "如何清洁").length);
    const fake = saveSource(t.db, t.read(), "lin", {
      itemId: id,
      title: "用户文字",
      kind: "user-text",
      text: "305.976.49 这只是我自己输入的观察",
    });
    assert.throws(
      () => indexOfficialSource(t.db, t.read(), "lin", id, fake),
      /官方来源/,
    );
    assert.equal(readKnowledge(t.db, t.read(), "dad", id).length, 0);
    const item = t.read().items.find((i) => i.id === id)!;
    const a = makeKnowledgeDocument(
      {
        url: "https://www.ikea.cn/a",
        title: "a",
        text: "Model 305.976.49. Rated power: 100 W. Before first use, press start.",
        links: [],
      },
      item,
      [],
    );
    const b = makeKnowledgeDocument(
      {
        url: "https://www.ikea.cn/b",
        title: "b",
        text: "Model 305.976.49. Rated power: 200 W. Before first use, press start.",
        links: [],
      },
      item,
      [],
    );
    assert.equal(knowledgeConflicts([a, b]).length, 1);
    assert.equal(knowledgeConflicts([a, { ...b, text: a.text }]).length, 0);
  } finally {
    t.db.close();
  }
});
test("跨型号拒绝；读取期间改型号不保存；临时获取不持久化；失败短暂负缓存避免反复联网", async () => {
  const t = fixture();
  try {
    const id = t.add("未知书架", "家具", "宜家", "305.976.49", {
      region: "cn",
    });
    let count = 0;
    const wrong = async (url: string) => {
      count++;
      return {
        url,
        title: "Other model",
        text: "Model 305.976.48. Use a dry cloth to clean.",
        links: [],
      };
    };
    assert.equal(
      (
        await acquireKnowledge(t.db, t.read, "lin", id, {
          fetchDocument: wrong,
        })
      ).documents.length,
      0,
    );
    await acquireKnowledge(t.db, t.read, "lin", id, { fetchDocument: wrong });
    assert.equal(count, 1);
    const good = async (url: string) => ({
      url,
      title: "305.976.49",
      text: "Model 305.976.49. Use a dry cloth to clean and follow the assembly guide.",
      links: [],
    });
    const ephemeral = await acquireKnowledge(t.db, t.read, "lin", id, {
      force: true,
      persist: false,
      fetchDocument: good,
    });
    assert.equal(ephemeral.documents.length, 1);
    assert.equal(readKnowledge(t.db, t.read(), "lin", id).length, 0);
    await assert.rejects(
      acquireKnowledge(t.db, t.read, "lin", id, {
        force: true,
        fetchDocument: async (url) => {
          t.write(
            mutate(t.read(), "lin", "updateItem", {
              itemId: id,
              model: "OTHER-REV",
            }),
          );
          return good(url);
        },
      }),
      /型号已变化/,
    );
    assert.equal(readKnowledge(t.db, t.read(), "lin", id).length, 0);
  } finally {
    t.db.close();
  }
});
test("有规格仍可使用新型号官方操作原文； grounded翻译可读且防止假引用/数字/重复尝试", async () => {
  const t = fixture();
  try {
    const id = t.add("测试收纳架", "家具", "宜家", "305.976.49", {
      region: "cn",
    });
    await acquireKnowledge(t.db, t.read, "lin", id, {
      fetchDocument: async (url) => ({
        url,
        title: "305.976.49",
        text: "Model 305.976.49. Before first use, place it on a stable surface. Clean with a dry cloth. Do not use abrasive cleaners.",
        links: [],
      }),
    });
    const evidence = retrieveKnowledge(t.db, t.read(), "lin", id, "怎么用");
    assert.ok(evidence.length);
    const value = {
      kind: "grounded",
      answer: "先核对摆放条件，再开始使用。",
      steps: [
        {
          text: "放在稳定的表面，再核对实物说明。",
          sourceIds: [evidence[0].id],
        },
      ],
      questions: [],
    };
    const r = groundedReply(value, evidence, { tried: [] });
    assert.equal(r.source, "model-with-evidence");
    assert.ok(r.citations.length);
    assert.equal(
      groundedReply(value, evidence, { tried: [r.steps[0].id] }).steps.length,
      0,
    );
    assert.throws(
      () =>
        groundedReply(
          {
            ...value,
            steps: [{ text: "加热999度", sourceIds: [evidence[0].id] }],
          },
          evidence,
          { tried: [] },
        ),
      /未提供的数字/,
    );
    assert.throws(
      () =>
        groundedReply(
          {
            ...value,
            steps: [{ text: "按步骤使用", sourceIds: ["foreign-model-id"] }],
          },
          evidence,
          { tried: [] },
        ),
      /不属于当前型号/,
    );
    let modelInput = "";
    const result = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        question: "这个怎么用",
        itemId: id,
        mode: "auto",
        memoryPolicy: "off",
        uiContext: { page: "item" },
      },
      {
        ready: true,
        model: "offline-test",
        generate: async (_s, input) => {
          modelInput = JSON.stringify(input);
          return {
            text: JSON.stringify(value),
            model: "offline-test",
            tokens: null,
          };
        },
      },
    );
    assert.equal(result.reply.outcome, "answered");
    assert.match(modelInput, /officialDocuments/);
    assert.equal(result.reply.steps.length, 1);
  } finally {
    t.db.close();
  }
});
