import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { seed, mutate, type State } from "../src/lib/domain.ts";
import { migrate } from "../src/lib/migrations.ts";
import { respond } from "../src/lib/agent/service.ts";
import type { TurnResult } from "../src/lib/agent/contracts.ts";
import { saveMemory, forgetMemory } from "../src/lib/memory/store.ts";
import { ProviderError, type Provider } from "../src/lib/ai/provider.ts";
import { installHouseholdCases } from "../src/lib/demo/install.ts";
import { isStoryNarration } from "../src/lib/memory/ambient.ts";

function fixture() {
  const filename = path.join(
    mkdtempSync(path.join(tmpdir(), "wujian-story-skill-")),
    "test.sqlite",
  );
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE workspace(id INTEGER PRIMARY KEY,body TEXT NOT NULL)",
  );
  const initial = mutate(seed(), "lin", "createItem", {
    name: "小边桌",
    category: "家具",
    location: "客厅",
  });
  const item = initial.items.at(-1)!;
  db.prepare("INSERT INTO workspace VALUES(1,?)").run(JSON.stringify(initial));
  migrate(db, filename);
  const read = () =>
    JSON.parse(
      (db.prepare("SELECT body FROM workspace").get() as { body: string }).body,
    ) as State;
  const offline: Provider = {
    model: "offline",
    async generate() {
      throw new ProviderError("payment_not_authorized", "offline");
    },
  };
  const save = (
    text: string,
    allowCloud = false,
    itemId = item.id,
    kind: "story" | "relationship" | "preference" = "story",
  ) => saveMemory(db, read, "lin", { kind, text, itemId, allowCloud });
  const turn = (
    question: string,
    provider = offline,
    previous?: TurnResult,
    itemId = item.id,
    temporary = false,
  ) =>
    respond(
      db,
      read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        question,
        mode: "auto",
        itemId,
        temporary,
        sessionId: previous?.session.id,
        expectedRevision: previous?.session.revision,
      },
      provider,
    );
  return { db, read, item, save, turn, offline };
}

test("用户反馈场景：本地把三条故事串成段落，不再显示原文清单或执行历史提醒", async () => {
  const f = fixture();
  try {
    f.save(
      "我最近跟我弟弟在上面看书，也很有意思，你以后要记得提醒我弟弟学习哦",
    );
    f.save("我喜欢读完一章后写两句感想，再把书放回桌边。");
    f.save("这张小边桌最早放在租来的房间里，上面摆着第一盏台灯。");
    const before = f.read();
    const result = await f.turn("你还记得有什么故事吗");
    assert.equal(result.modelCalls, 0);
    assert.equal(result.reply.memoryIds.length, 3);
    assert.match(result.reply.answer, /你弟弟.*看书/);
    assert.match(result.reply.answer, /租来的房间/);
    assert.match(result.reply.answer, /你们一起读的是什么/);
    assert.doesNotMatch(
      result.reply.answer,
      /案例中记录了|可以接着讲它与你的近况|你以后|我弟弟|我会.*提醒/,
    );
    assert.equal(result.reply.answer.split("\n").filter(Boolean).length, 2);
    assert.deepEqual(f.read().tasks, before.tasks);
    assert.equal(
      f.read().memories.length,
      before.memories.length,
      "回忆请求和助手改写不产生新原故事",
    );
    assert.ok(
      result.trace.some(
        (t) => t.stage === "skill_selected" && t.detail.includes("组织自然"),
      ),
    );
  } finally {
    f.db.close();
  }
});

test("同源关系片段去重，简短要求不硬追问；日常偏好不会挤掉故事", async () => {
  const f = fixture();
  try {
    f.save("毕业那天妈妈送我这张边桌，我一直留着它。");
    f.save("毕业那天妈妈送我这张边桌", false, f.item.id, "relationship");
    for (let i = 0; i < 7; i++)
      f.save("我的整理偏好" + i, false, f.item.id, "preference");
    const r = await f.turn("我想听以前的故事，不用问我问题");
    assert.equal(r.reply.memoryIds.length, 1);
    assert.equal((r.reply.answer.match(/毕业那天妈妈/g) || []).length, 1);
    assert.doesNotMatch(r.reply.answer, /[？?]|整理偏好/);
  } finally {
    f.db.close();
  }
});

test("连续追问还有呢保留故事路由，耗尽后坦诚，不循环复读或新增故事", async () => {
  const f = fixture();
  try {
    const storyCount = f.read().memories.length;
    for (let i = 0; i < 5; i++) f.save("第" + i + "次搬家留下的片段");
    const first = await f.turn("聊聊以前的故事");
    const next = await f.turn("还有呢", f.offline, first);
    assert.equal(next.reply.route?.intent, "story");
    assert.equal(next.reply.memoryIds.length, 2);
    assert.ok(
      next.reply.memoryIds.every((id) => !first.reply.memoryIds.includes(id)),
    );
    const exhausted = await f.turn("再讲一段", f.offline, next);
    assert.equal(exhausted.reply.memoryIds.length, 0);
    assert.match(exhausted.reply.answer, /这次找到的片段/);
    const again = await f.turn("还有呢", f.offline, exhausted);
    assert.equal(again.reply.memoryIds.length, 0);
    assert.equal(f.read().memories.length, storyCount);
    assert.equal(isStoryNarration("再讲一段"), false);
  } finally {
    f.db.close();
  }
});

test("所有选中片段授权上云后实际进入表达 Skill，模型仅报告使用过的来源", async () => {
  const f = fixture();
  try {
    const m = f.save("我和弟弟在桌边一起读书。", true);
    let system = "",
      input = "";
    const provider: Provider = {
      model: "offline-narrative-double",
      async generate(s, payload) {
        system = s;
        input = JSON.stringify(payload);
        return {
          text: JSON.stringify({
            answer:
              "记得，你提过和弟弟一起在桌边读书。那张小桌，也就多了你们相处的故事。你们读的是什么？",
            memoryIds: [m.id],
          }),
          model: "offline-narrative-double",
          tokens: { input: 50, output: 30 },
        };
      },
    };
    const r = await f.turn("你还记得有什么故事吗", provider);
    assert.equal(r.modelCalls, 1);
    assert.equal(r.reply.source, "model-general");
    assert.deepEqual(r.reply.memoryIds, [m.id]);
    assert.match(system, /不要编号、逐条罗列/);
    assert.match(system, /历史记录里的提醒/);
    assert.match(input, /亲切、松弛/);
    assert.match(r.reply.answer, /你们相处的故事/);
  } finally {
    f.db.close();
  }
});

test("原生 complete 路径传入表达 Prompt 且不开放任何工具", async () => {
  const f = fixture();
  try {
    const m = f.save("搬家时我留下了这张小桌。", true);
    const provider: Provider = {
      model: "offline-native-double",
      async generate() {
        throw Error("must use complete");
      },
      async complete(messages, tools) {
        assert.equal(tools.length, 0);
        assert.match(messages[0].content!, /把检索到的记忆讲成自然的对话/);
        return {
          text: JSON.stringify({
            answer: "你说过，搬家时留下了这张小桌。这是你与它的一段故事。",
            memoryIds: [m.id],
          }),
          model: "offline-native-double",
          tokens: null,
          toolCalls: [],
          finishReason: "stop",
        };
      },
    };
    assert.equal(
      (await f.turn("聊聊以前的故事", provider)).reply.source,
      "model-general",
    );
  } finally {
    f.db.close();
  }
});

test("混合授权记忆整体留在本地，另一物品/他人/临时模式均不泄露", async () => {
  const f = fixture();
  try {
    f.save("只有本地能看见的家人秘密");
    f.save("已授权的读书片段", true);
    let calls = 0;
    const spy: Provider = {
      model: "never",
      async generate() {
        calls++;
        throw Error("private data must stay local");
      },
    };
    const r = await f.turn("聊聊以前的故事", spy);
    assert.match(r.reply.answer, /家人秘密/);
    assert.equal(calls, 0);
    const other = f
      .read()
      .items.find((i) => i.id !== f.item.id && i.owner === "lin")!;
    const separate = await f.turn("聊聊以前的故事", spy, undefined, other.id);
    assert.doesNotMatch(separate.reply.answer, /家人秘密|读书片段/);
    const temporary = await f.turn(
      "聊聊以前的故事",
      spy,
      undefined,
      f.item.id,
      true,
    );
    assert.doesNotMatch(temporary.reply.answer, /家人秘密|读书片段/);
    assert.equal(calls, 0);
    const dad = await respond(
      f.db,
      f.read,
      "dad",
      {
        requestId: crypto.randomUUID(),
        mode: "auto",
        itemId: other.id,
        question: "聊聊以前的故事",
      },
      f.offline,
    );
    assert.doesNotMatch(dad.reply.answer, /家人秘密|读书片段/);
  } finally {
    f.db.close();
  }
});

test("合成案例也使用流畅的本地表达，保留案例标记，不把案例传给模型", async () => {
  const f = fixture();
  try {
    installHouseholdCases(f.db);
    const demo = f.read().items.find((i) => i.demo && i.icon === "table")!;
    const r = await f.turn(
      "你还记得有什么故事吗",
      {
        model: "never",
        async generate() {
          throw Error("demo must stay local");
        },
      },
      undefined,
      demo.id,
    );
    assert.equal(r.modelCalls, 0);
    assert.match(r.reply.answer, /读完一章|第一盏台灯/);
    assert.doesNotMatch(r.reply.answer, /案例中记录了|IKEA|你留下过：/);
    assert.match(r.reply.caveat!, /合成案例/);
  } finally {
    f.db.close();
  }
});

test("模型不可用只尝试一次，保留有来源的自然本地回复", async () => {
  const f = fixture();
  try {
    f.save("毕业那天妈妈送我小桌。", true);
    const r = await f.turn("聊聊以前的故事");
    assert.equal(r.modelCalls, 1);
    assert.equal(r.reply.source, "local-memory");
    assert.match(r.reply.answer, /毕业那天妈妈/);
    assert.equal(r.reply.errorCode, "payment_not_authorized");
    assert.ok(r.trace.some((t) => t.stage === "memory_story_fallback"));
  } finally {
    f.db.close();
  }
});

test("非法引用、罗列、伪造提醒与异常工具调用均回退，不产生领域写入", async () => {
  for (const issue of ["foreign-id", "list", "action", "tools"]) {
    const f = fixture();
    try {
      const m = f.save("我和弟弟在桌边读书。", true);
      const before = f.read().tasks.length;
      const provider: Provider = {
        model: "offline-invalid-double",
        async generate() {
          throw Error("complete only");
        },
        async complete() {
          return {
            text: JSON.stringify({
              answer:
                issue === "list"
                  ? "- 我和弟弟在桌边读书。"
                  : issue === "action"
                    ? "我会在明天提醒弟弟学习，已经安排好了。"
                    : "你提过和弟弟读书，这是小桌旁的一段故事。",
              memoryIds: [issue === "foreign-id" ? "someone-else" : m.id],
            }),
            model: "offline-invalid-double",
            tokens: null,
            toolCalls:
              issue === "tools"
                ? [
                    {
                      id: "bad",
                      type: "function",
                      function: { name: "create_task", arguments: "{}" },
                    },
                  ]
                : [],
            finishReason: "stop",
          };
        },
      };
      const r = await f.turn("聊聊以前的故事", provider);
      assert.equal(r.modelCalls, 1, issue);
      assert.equal(r.reply.source, "local-memory", issue);
      assert.match(r.reply.answer, /弟弟/);
      assert.equal(f.read().tasks.length, before);
    } finally {
      f.db.close();
    }
  }
});

test("忘记后旧片段不再进入表达或复述", async () => {
  const f = fixture();
  try {
    const m = f.save("红松果是毕业时妈妈送的。");
    const old = await f.turn("聊聊以前的故事");
    assert.match(old.reply.answer, /红松果/);
    forgetMemory(f.db, "lin", m.id);
    const r = await f.turn("聊聊以前的故事");
    assert.doesNotMatch(r.reply.answer, /红松果|毕业时/);
    assert.equal(r.reply.memoryIds.length, 0);
  } finally {
    f.db.close();
  }
});

test("展开刚才的片段仍讲同一来源，直接引语不误改人物人称", async () => {
  const f = fixture();
  try {
    const m = f.save("妈妈对我说：‘慢慢来’。我读得很忘我。");
    const first = await f.turn("聊聊以前的故事");
    const expanded = await f.turn("展开讲讲", f.offline, first);
    assert.deepEqual(expanded.reply.memoryIds, [m.id]);
    assert.match(expanded.reply.answer, /刚才那一段/);
    assert.match(expanded.reply.answer, /忘我/);
    assert.doesNotMatch(expanded.reply.answer, /忘你/);
    assert.equal(isStoryNarration("展开讲讲"), false);
  } finally {
    f.db.close();
  }
});

test("无来源时不虚构故事；物品角色和用户风格只影响语气", async () => {
  const f = fixture();
  try {
    const empty = await f.turn("你还记得有什么故事吗");
    assert.equal(empty.modelCalls, 0);
    assert.equal(empty.reply.memoryIds.length, 0);
    assert.match(empty.reply.answer, /还没找到/);
    assert.doesNotMatch(empty.reply.answer, /我们一起|我亲眼|妈妈|弟弟/);
  } finally {
    f.db.close();
  }
});

test("家人赠送和阅读不能拼成共同读书；否定的共同经历也不当真", async () => {
  for (const story of [
    "毕业时妈妈送我小桌，我喜欢阅读。",
    "我没有和弟弟一起看书。",
  ]) {
    const f = fixture();
    try {
      f.save(story);
      f.save("读完一章后我会写两句感想。");
      const r = await f.turn("聊聊以前的故事");
      assert.doesNotMatch(r.reply.answer, /你们一起读的是什么/);
      assert.match(r.reply.answer, /哪一页/);
      if (story.includes("没有")) assert.match(r.reply.answer, /没有和弟弟/);
    } finally {
      f.db.close();
    }
  }
});
