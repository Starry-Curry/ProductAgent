import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { migrateUnified } from "../src/lib/foundation/schema.ts";
import { productModel, itemInstance } from "../src/lib/foundation/legacy.ts";
import { authorize, mirrorItemGrant } from "../src/lib/foundation/policy.ts";
import {
  createTask,
  getTask,
  listTasks,
  beginRun,
  finishRun,
  resolveTaskContext,
  recordOutcome,
  taskOutcomes,
  recoverRun,
  assertRunCurrent,
} from "../src/lib/foundation/tasks.ts";
import {
  adjudicateClaim,
  checkNumericRange,
} from "../src/lib/foundation/evidence.ts";
import { type Person, type State } from "../src/lib/domain.ts";
import { respond } from "../src/lib/agent/service.ts";
import type { Provider } from "../src/lib/ai/provider.ts";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { saveMemory,forgetMemory } from "../src/lib/memory/store.ts";
import { linkTask } from "../src/lib/foundation/tasks.ts";
test("纠正或遗忘后，旧任务目标不作为模型事实再注入",()=>{
 const f=fixture();try{const memory=saveMemory(f.db,f.read,'lin',{itemId:f.id,kind:'relationship',text:'合成：朋友小周送的',allowCloud:false});
 const t=createTask(f.db,f.read,'lin',{requestId:crypto.randomUUID(),goal:'朋友小周赠送的耳机要配对',intent:'guide',itemInstanceIds:[f.id]});
 assert.ok(resolveTaskContext(f.db,f.read(),'lin',t.taskId).modelGoal.includes('小周'));
 forgetMemory(f.db,'lin',memory.id);assert.ok(!resolveTaskContext(f.db,f.read(),'lin',t.taskId).modelGoal.includes('小周'));
 }finally{f.db.close();}
});
test("同一任务跨人只给批准摘要与获准物品，不复制原始目标和私人对象",()=>{
 const f=fixture();try{const s=f.read(),i=s.items.find(i=>i.id===f.id)!;i.owner='u_owner';i.shared=true;i.sharedWith=['u_peer'];f.write(s);
 const privateId=f.add('私有相机','其他','Canon','EOS R50');const s2=f.read();s2.items.find(i=>i.id===privateId)!.owner='u_owner';f.write(s2);
 const t=createTask(f.db,f.read,'u_owner',{requestId:crypto.randomUUID(),goal:'秘密原始目标',intent:'plan',itemInstanceIds:[i.id,privateId]});
 linkTask(f.db,f.read(),'u_owner',{kind:'family',refId:crypto.randomUUID(),taskId:t.taskId,goal:'批准的耳机协助摘要',intent:'collaborate',itemIds:[i.id],participants:['u_peer']});
 const view=getTask(f.db,f.read(),'u_peer',t.taskId);assert.equal(view.goal,'批准的耳机协助摘要');assert.deepEqual(view.itemInstanceIds,[i.id]);assert.ok(!JSON.stringify(view).includes(privateId));assert.ok(!JSON.stringify(view).includes('秘密原始目标'));
 }finally{f.db.close();}
});
function fixture() {
  const dir = mkdtempSync(path.join(process.cwd(), ".runtime", "unified-"));
  const f = validationFixture(dir);
  const id = f.add("合成耳机", "电子设备", "Sony", "WH-CH520");
  migrateUnified(f.db, path.join(dir, "test.sqlite"));
  return { ...f, dir, id };
}
test("G1 无损迁移、SQLite备份、重启和两件同款独立身份", () => {
  const f = fixture();
  try {
    const body = (
      f.db.prepare("SELECT body FROM workspace").get() as { body: string }
    ).body;
    migrateUnified(f.db);
    assert.equal(
      (f.db.prepare("SELECT body FROM workspace").get() as { body: string })
        .body,
      body,
    );
    assert.ok(
      existsSync(path.join(f.dir, "test.sqlite.before-unified-v1.sqlite")),
    );
    const backup=new DatabaseSync(path.join(f.dir,"test.sqlite.before-unified-v1.sqlite"),{readOnly:true});
    assert.equal((backup.prepare("SELECT body FROM workspace").get() as {body:string}).body,body);backup.close();
    const i = f.read().items.find((i) => i.id === f.id)!;
    assert.equal(
      productModel(i)?.modelKey,
      productModel({ ...i, id: "other" })?.modelKey,
    );
    assert.notEqual(
      itemInstance(i).itemInstanceId,
      itemInstance({ ...i, id: "other" }).itemInstanceId,
    );
    assert.notEqual(
      productModel(i)?.modelKey,
      productModel({ ...i, model: "WH-CH720N" })?.modelKey,
    );
    const other = new DatabaseSync(path.join(f.dir, "test.sqlite"));
    migrateUnified(other);
    other.close();
  } finally {
    f.db.close();
  }
});
test("G1 关系不授予权限，逐件共享与撤权，读写分离", () => {
  const f = fixture();
  try {
    const a = "u_test-a" as Person,
      b = "u_test-b" as Person,
      s = f.read(),
      i = s.items.find((i) => i.id === f.id)!;
    i.owner = a;
    f.write(s);
    assert.equal(authorize(f.db, s, b, i.id).allowed, false);
    i.shared = true;
    i.sharedWith = [b];
    mirrorItemGrant(f.db, s, a, b, i.id, true);
    assert.equal(authorize(f.db, s, b, i.id).allowed, true);
    assert.equal(authorize(f.db, s, b, i.id, "execute").allowed, false);
    mirrorItemGrant(f.db, s, a, b, i.id, false);
    assert.equal(authorize(f.db, s, b, i.id).allowed, false);
  } finally {
    f.db.close();
  }
});
test("G3 任务刷新、幂等、反馈revision与非硬件结果", () => {
  const f = fixture();
  try {
    const v = {
      requestId: crypto.randomUUID(),
      goal: "耳机连接新手机",
      intent: "guide",
      itemInstanceIds: [f.id],
    };
    const t = createTask(f.db, f.read, "lin", v);
    assert.equal(createTask(f.db, f.read, "lin", v).taskId, t.taskId);
    assert.throws(() =>
      createTask(f.db, f.read, "lin", { ...v, goal: "其他目标" }),
    );
    const r = beginRun(f.db, f.read, "lin", {
      taskId: t.taskId,
      requestId: crypto.randomUUID(),
      itemIds: [f.id],
      entryPoint: "item",
      executor: "offline-fixture",
      input: v,
    });
    finishRun(f.db, f.read, r, "waiting_user");
    const current = getTask(f.db, f.read(), "lin", t.taskId);
    assert.equal(current.currentStage, "waiting_user");
    const out = {
      taskId: t.taskId,
      runId: r.runId,
      requestId: crypto.randomUUID(),
      expectedRevision: current.revision,
      goalStatus: "achieved",
      notes: "合成用户报告已配对",
      confirmed: true,
      reuse: true,
    };
    assert.equal(recordOutcome(f.db, f.read, "lin", out).basis, "user_report");
    assert.equal(recordOutcome(f.db, f.read, "lin", out).basis, "user_report");
    assert.equal(taskOutcomes(f.db, f.read(), "lin", t.taskId).length, 1);
    assert.throws(() =>
      recordOutcome(f.db, f.read, "lin", {
        ...out,
        requestId: crypto.randomUUID(),
      }),
    );
    assert.equal(
      resolveTaskContext(f.db, f.read(), "lin", t.taskId).items.length,
      1,
    );
    assert.throws(() => getTask(f.db, f.read(), "friend", t.taskId));
  } finally {
    f.db.close();
  }
});
test("G3 中断结果不明，不自动重新执行；运行中撤权阻止返回", () => {
  const f = fixture();
  try {
    const s = f.read(),
      i = s.items.find((i) => i.id === f.id)!;
    i.owner = "u_owner";
    i.shared = true;
    i.sharedWith = ["u_member"];
    f.write(s);
    const v = {
      requestId: crypto.randomUUID(),
      goal: "只读帮助",
      intent: "guide",
      itemInstanceIds: [i.id],
    };
    const t = createTask(f.db, f.read, "u_member", v),
      input = {
        taskId: t.taskId,
        requestId: crypto.randomUUID(),
        itemIds: [i.id],
        entryPoint: "family",
        executor: "fixture",
        input: v,
      };
    const r = beginRun(f.db, f.read, "u_member", input);
    assert.equal(
      recoverRun(f.db, f.read(), "u_member", r.runId).status,
      "unknown",
    );
    assert.throws(() => beginRun(f.db, f.read, "u_member", input));
    i.sharedWith = [];
    f.write(s);
    assert.throws(() => assertRunCurrent(f.db, f.read(), r));
    assert.deepEqual(listTasks(f.db, f.read(), "u_member"), []);
  } finally {
    f.db.close();
  }
});
test("G2 缺证不等于否定，近似型号、推断及未引原文不能获准", () => {
  const chunk = {
    id: "p",
    documentId: "doc",
    model: "WH-CH520",
    region: "CN",
    text: "按电源按钮约2秒。",
    start: 0,
    end: 10,
    category: "operation",
    url: "https://helpguide.sony.net/",
    title: "测试片段",
  };
  const base = {
    modelKey: "m",
    model: "WH-CH520",
    region: "CN",
    predicate: "power",
    value: chunk.text,
    supports: [
      {
        chunk,
        quote: chunk.text,
        fetchedAt: "2026-10-30",
        stance: "supports" as const,
      },
    ],
  };
  assert.equal(adjudicateClaim(base).verdict, "supported");
  assert.equal(
    adjudicateClaim({ ...base, value: "不支持ANC" }).verdict,
    "not_found",
  );
  assert.equal(
    adjudicateClaim({ ...base, model: "WH-CH720N" }).verdict,
    "not_found",
  );
  assert.equal(
    adjudicateClaim({ ...base, inference: true }).verdict,
    "not_found",
  );
  assert.equal(adjudicateClaim({ ...base, supports: [] }).verdict, "not_found");
  assert.equal(checkNumericRange(310, 170, 290).verdict, "refuted");
});
test("G3 陌生实物共用任务检索，不依赖八件模拟家庭；替身只验证工具协议", async () => {
  const f = fixture();
  try {
    const prior=createTask(f.db,f.read,"lin",{requestId:crypto.randomUUID(),goal:"之前的耳机问题",intent:"guide",itemInstanceIds:[f.id]});
    const previousRun=beginRun(f.db,f.read,"lin",{requestId:crypto.randomUUID(),taskId:prior.taskId,itemIds:[f.id],entryPoint:"item",executor:"offline-read",input:{}});
    finishRun(f.db,f.read,previousRun,"waiting_user");
    recordOutcome(f.db,f.read,"lin",{requestId:crypto.randomUUID(),taskId:prior.taskId,runId:previousRun.runId,expectedRevision:getTask(f.db,f.read(),"lin",prior.taskId).revision,goalStatus:"partial",notes:"PRIVATE-OUTCOME-NO-CLOUD",confirmed:true,reuse:true,allowCloud:false});
    const t = createTask(f.db, f.read, "lin", {
      requestId: crypto.randomUUID(),
      goal: "了解耳机并留待家人协助",
      intent: "plan",
      itemInstanceIds: [f.id],
    });
    let toolsRead = 0;
    const p: Provider = {
      ready: true,
      model: "offline-contract-fixture",
      complete: async (messages) => {
        assert.ok(!JSON.stringify(messages).includes("PRIVATE-OUTCOME-NO-CLOUD"));
        if (!messages.some((m) => m.role === "tool"))
          return {
            text: "",
            model: "fixture",
            tokens: null,
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "read",
                type: "function",
                function: {
                  name: "read_home_items",
                  arguments: JSON.stringify({
                    itemIds: ["item1"],
                    query: "当前状态",
                    topics: ["型号"],
                  }),
                },
              },
            ],
          };
        toolsRead++;
        return {
          text: '{"ready":true}',
          model: "fixture",
          tokens: null,
          finishReason: "stop",
          toolCalls: [],
        };
      },
      generate: async (system, input) => {
        const v = input as any;
        if (system.startsWith("SOURCE_REVIEW"))
          return {
            text: JSON.stringify({
              keepSentenceIds: v.sentences.map((s: any) => s.id),
              keepStepIds: v.steps.map((s: any) => s.id),
              issues: [],
            }),
            model: "fixture",
            tokens: null,
          };
        assert.equal(v.readResults[0].items[0].model, "WH-CH520");
        return {
          text: JSON.stringify({
            answer: "型号已登记，实际连接状态仍未知；请先核对目前的状态。",
            goal: t.goal,
            tasks: [{ title: "了解状态", status: "needs_info" }],
            usedItemIds: ["item1"],
            memoryIds: [],
            sourceIds: [],
            questions: ["目前是否已开机？"],
            steps: [],
          }),
          model: "fixture",
          tokens: null,
        };
      },
    };
    const r = await respond(
      f.db,
      f.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        taskId: t.taskId,
        itemId: f.id,
        question: t.goal,
        uiContext: { page: "assistant", useItemMemories: false },
      },
      p,
    );
    assert.equal(toolsRead, 1);
    assert.equal(r.foundation?.taskId, t.taskId);
    assert.equal(r.reply.usedItems?.[0].id, f.id);
    assert.equal(
      getTask(f.db, f.read(), "lin", t.taskId).currentStage,
      "waiting_user",
    );
  } finally {
    f.db.close();
  }
});
test("G1 两个真实Node进程并发新增任务，无丢更新且旧正文不变", async () => {
  const f = fixture();
  try {
    const body = (
      f.db.prepare("SELECT body FROM workspace").get() as { body: string }
    ).body;
    const mod = pathToFileURL(path.resolve("src/lib/foundation/tasks.ts")).href;
    const code = `import {DatabaseSync} from 'node:sqlite';import {createTask} from ${JSON.stringify(mod)};const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA busy_timeout=5000');const read=()=>JSON.parse(db.prepare('SELECT body FROM workspace').get().body);createTask(db,read,'lin',{requestId:crypto.randomUUID(),goal:'parallel-'+process.argv[2],intent:'plan',itemInstanceIds:[]});db.close();`;
    const run = (n: string) =>
      new Promise<void>((resolve, reject) => {
        const c = spawn(
          process.execPath,
          [
            "--experimental-strip-types",
            "--input-type=module",
            "-e",
            code,
            path.join(f.dir, "test.sqlite"),
            n,
          ],
          { windowsHide: true },
        );
        let err = "";
        c.stderr.on("data", (b) => (err += b));
        c.on("error", reject);
        c.on("exit", (code) => (code === 0 ? resolve() : reject(Error(err))));
      });
    await Promise.all([run("a"), run("b")]);
    assert.equal(listTasks(f.db, f.read(), "lin").length, 2);
    assert.equal(
      (f.db.prepare("SELECT body FROM workspace").get() as { body: string })
        .body,
      body,
    );
  } finally {
    f.db.close();
  }
});
