import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { migrateUnified } from "../src/lib/foundation/schema.ts";
import { createTask, beginRun, finishRun, getTask, recordOutcome, resolveTaskContext, amendOutcome, assertRunCurrent } from "../src/lib/foundation/tasks.ts";
import { saveMemory, forgetMemory, epoch } from "../src/lib/memory/store.ts";
import { mirrorItemGrant } from "../src/lib/foundation/policy.ts";

function setup() {
  mkdirSync(".runtime", { recursive: true });
  const f = validationFixture(mkdtempSync(path.join(process.cwd(), ".runtime", "experience-")));
  migrateUnified(f.db);
  const headset = f.add("[合成持有]耳机", "电子设备", "Sony", "WH-CH520");
  const lamp = f.add("[合成持有]台灯", "电子设备", "小米", "MJTD01SYL");
  const task = (items: string[], goal: string) => createTask(f.db, f.read, "lin", { requestId: crypto.randomUUID(), goal, intent: "guide", itemInstanceIds: items });
  const complete = (items: string[], notes: string) => {
    const t = task(items, "[合成]使用帮助");
    const run = beginRun(f.db, f.read, "lin", { requestId: crypto.randomUUID(), taskId: t.taskId, itemIds: items, entryPoint: "test", executor: "offline", input: {} });
    finishRun(f.db, f.read, run, "waiting_user");
    return recordOutcome(f.db, f.read, "lin", { taskId: t.taskId, runId: run.runId, requestId: crypto.randomUUID(), expectedRevision: getTask(f.db, f.read(), "lin", t.taskId).revision, goalStatus: "achieved", notes, confirmed: true, reuse: true, allowCloud: false });
  };
  return { ...f, headset, lamp, task, complete };
}

test("长期经验复现：完成台灯任务B后，耳机任务A的经验仍可供新任务C参考", () => {
  const f = setup();
  try {
    const a = f.complete([f.headset], "[用户报告]耳机重新配对后可用");
    f.complete([f.lamp], "[用户报告]台灯已整理好");
    const c = f.task([f.headset], "[合成]下次连接耳机");
    const reports = resolveTaskContext(f.db, f.read(), "lin", c.taskId).previousOutcomes;
    assert.ok(reports.some(o => o.outcomeId === a.outcomeId), "正常新增经验不应让无关旧经验消失");
  } finally { f.db.close(); }
});

test("新增经验不清理无关在途任务；纠正或忘记经验立即使旧在途语境失效",()=>{
 const f=setup();try{
   const t=f.task([f.headset],"耳机配对"), run=beginRun(f.db,f.read,"lin",{requestId:crypto.randomUUID(),taskId:t.taskId,itemIds:[f.headset],entryPoint:"test",executor:"offline",input:{}});
   const before=epoch(f.db,"lin"); const b=f.complete([f.lamp],"台灯已整理");
   assert.equal(epoch(f.db,"lin"),before);assert.doesNotThrow(()=>assertRunCurrent(f.db,f.read(),run));
   amendOutcome(f.db,f.read,"lin",{outcomeId:b.outcomeId,requestId:crypto.randomUUID(),expectedRevision:1,operation:"forget",confirmed:true});
   assert.throws(()=>assertRunCurrent(f.db,f.read(),run));
 }finally{f.db.close();}
});

test("经验纠正、撤销复用、忘记有版本和幂等；旧正文不从重试恢复",()=>{
 const f=setup();try{
   const a=f.complete([f.headset],"最初错误经验"), b=f.complete([f.lamp],"无关的台灯经验");
   const c=f.task([f.headset],"再问耳机");
   const edit={outcomeId:a.outcomeId,requestId:crypto.randomUUID(),expectedRevision:1,operation:"correct",notes:"更正：只在原手机有效",reuse:true,allowCloud:false,confirmed:true};
   const edited=amendOutcome(f.db,f.read,"lin",edit);assert.equal(edited.revision,2);assert.equal(amendOutcome(f.db,f.read,"lin",edit).revision,2);
   const recalled=resolveTaskContext(f.db,f.read(),"lin",c.taskId).previousOutcomes;assert.equal(recalled[0].notes,edit.notes);assert.equal(recalled[0].allowCloud,false);
   assert.throws(()=>amendOutcome(f.db,f.read,"friend",edit));
   assert.throws(()=>amendOutcome(f.db,f.read,"lin",{...edit,requestId:crypto.randomUUID()}));
   const revoke=amendOutcome(f.db,f.read,"lin",{outcomeId:a.outcomeId,requestId:crypto.randomUUID(),expectedRevision:2,operation:"revoke_reuse",confirmed:true});assert.equal(revoke.canReuseForFutureTasks,false);
   assert.equal(resolveTaskContext(f.db,f.read(),"lin",c.taskId).previousOutcomes.length,0);
   amendOutcome(f.db,f.read,"lin",{outcomeId:a.outcomeId,requestId:crypto.randomUUID(),expectedRevision:3,operation:"forget",confirmed:true});
   const stored=f.db.prepare("SELECT body,payload FROM foundation_outcomes WHERE id=?").get(a.outcomeId)!;assert.ok(!JSON.stringify(stored).includes("最初错误经验"));assert.ok(!JSON.stringify(stored).includes(edit.notes));
   const lc=f.task([f.lamp],"再问台灯");assert.ok(resolveTaskContext(f.db,f.read(),"lin",lc.taskId).previousOutcomes.some(o=>o.outcomeId===b.outcomeId));
 }finally{f.db.close();}
});

test("普通新增记忆不使长期经验失效；物品记忆纠正只影响相关物品，遗忘不复活旧关系",()=>{
 const f=setup();try{
   const m=saveMemory(f.db,f.read,"lin",{itemId:f.headset,kind:"relationship",text:"合成：小周送的",allowCloud:false});
   const a=f.complete([f.headset],"耳机经历"), b=f.complete([f.lamp],"台灯经历");
   saveMemory(f.db,f.read,"lin",{itemId:f.lamp,kind:"preference",text:"合成：喜欢柔和光线",allowCloud:false});
   const c=f.task([f.headset],"下次耳机");assert.equal(resolveTaskContext(f.db,f.read(),"lin",c.taskId).previousOutcomes[0].outcomeId,a.outcomeId);
   saveMemory(f.db,f.read,"lin",{itemId:f.headset,kind:"relationship",text:"更正：小李送的",allowCloud:false},m.id);
   assert.equal(resolveTaskContext(f.db,f.read(),"lin",c.taskId).previousOutcomes.length,0);
   const lc=f.task([f.lamp],"台灯下次");assert.equal(resolveTaskContext(f.db,f.read(),"lin",lc.taskId).previousOutcomes[0].outcomeId,b.outcomeId);
   forgetMemory(f.db,"lin",m.id);assert.equal(resolveTaskContext(f.db,f.read(),"lin",c.taskId).previousOutcomes.length,0);
 }finally{f.db.close();}
});

test("撤权后，多物品历史经验不能借另一件仍获准物品泄露",()=>{
 const f=setup();try{
   const s=f.read(), i=s.items.find(i=>i.id===f.lamp)!;i.owner="u_owner";i.shared=true;i.sharedWith=["lin"];f.write(s);
   mirrorItemGrant(f.db,s,"u_owner","lin",i.id,true);f.complete([f.headset,f.lamp],"涉及家人的私密台灯说明");
   const c=f.task([f.headset],"只问耳机");assert.equal(resolveTaskContext(f.db,f.read(),"lin",c.taskId).previousOutcomes.length,1);
   mirrorItemGrant(f.db,s,"u_owner","lin",i.id,false);
   assert.equal(resolveTaskContext(f.db,f.read(),"lin",c.taskId).previousOutcomes.length,0);
 }finally{f.db.close();}
});

test("纠正被引用的经验后，派生经验不再自动复用",()=>{
 const f=setup();try{
   const a=f.complete([f.headset],"基础经验"), b=f.complete([f.headset,f.lamp],"引用基础经验的后续结果");
   const c=f.task([f.lamp],"下次台灯");assert.equal(resolveTaskContext(f.db,f.read(),"lin",c.taskId).previousOutcomes[0].outcomeId,b.outcomeId);
   amendOutcome(f.db,f.read,"lin",{outcomeId:a.outcomeId,requestId:crypto.randomUUID(),expectedRevision:1,operation:"forget",confirmed:true});
   assert.equal(resolveTaskContext(f.db,f.read(),"lin",c.taskId).previousOutcomes.length,0);
 }finally{f.db.close();}
});

test("大量无关物品记录不挤掉旧耳机经验；无损V1到V2升级不恢复历史已失效记录",()=>{
 const f=setup();try{
   const a=f.complete([f.headset],"较早的耳机经验"), b=f.complete([f.lamp],"无关经验");
   for(let n=0;n<105;n++){const id=crypto.randomUUID();f.db.prepare("INSERT INTO foundation_outcomes VALUES(?,?,?,?,?,?)").run(id,crypto.randomUUID(),"lin",crypto.randomUUID(),"{}",JSON.stringify({...b,outcomeId:id,taskId:crypto.randomUUID()}));}
   const c=f.task([f.headset],"很久以后再问耳机");assert.equal(resolveTaskContext(f.db,f.read(),"lin",c.taskId).previousOutcomes[0].outcomeId,a.outcomeId);
   const old={...a,memoryEpoch:-1};delete (old as any).privacyStamp;
   f.db.prepare("UPDATE foundation_outcomes SET body=? WHERE id=?").run(JSON.stringify(old),a.outcomeId);
   const original=f.db.prepare("SELECT body FROM workspace").get()!.body;
   f.db.exec("DELETE FROM foundation_schema WHERE version=2;DROP TABLE memory_privacy_scopes");
   const filename=f.db.location()!;migrateUnified(f.db,filename);
   assert.ok(existsSync(filename+".before-unified-v2.sqlite"));assert.equal(f.db.prepare("SELECT body FROM workspace").get()!.body,original);
   assert.equal(resolveTaskContext(f.db,f.read(),"lin",c.taskId).previousOutcomes.length,0);
 }finally{f.db.close();}
});

test("升级保留当时仍有效的旧经验，之后普通新增记忆不再令其丢失",()=>{
 const f=setup();try{
   const a=f.complete([f.headset],"有效旧经验"),old={...a};delete (old as any).privacyStamp;
   f.db.prepare("UPDATE foundation_outcomes SET body=? WHERE id=?").run(JSON.stringify(old),a.outcomeId);
   f.db.exec("DELETE FROM foundation_schema WHERE version=2;DROP TABLE memory_privacy_scopes");migrateUnified(f.db,f.db.location()!);
   saveMemory(f.db,f.read,"lin",{itemId:f.lamp,kind:"preference",text:"正常新增记忆",allowCloud:false});
   const c=f.task([f.headset],"升级后再问");assert.equal(resolveTaskContext(f.db,f.read(),"lin",c.taskId).previousOutcomes[0].outcomeId,a.outcomeId);
 }finally{f.db.close();}
});

test("已知单物品纠正不删除无关的已跟踪会话；相关会话与检查点仍失效",()=>{
 const f=setup();try{
   const sessions=[f.headset,f.lamp].map(id=>{
     const sessionId=crypto.randomUUID(),expires=new Date(Date.now()+86400000).toISOString();
     f.db.prepare("INSERT INTO agent_sessions VALUES(?,?,?,?,?,?,?)").run(sessionId,"lin",id,1,JSON.stringify({id:sessionId,itemId:id,revision:1,messages:[{role:"user",text:"应保留的独立会话"}],known:{},tried:[],memoryEpoch:epoch(f.db,"lin"),expiresAt:expires}),0,expires);
     const r=beginRun(f.db,f.read,"lin",{requestId:crypto.randomUUID(),itemIds:[id],entryPoint:"test",executor:"offline",input:{}});finishRun(f.db,f.read,r,"waiting_user",sessionId);return sessionId;
   });
   const m=saveMemory(f.db,f.read,"lin",{itemId:f.lamp,kind:"experience",text:"合成台灯经历",allowCloud:false});forgetMemory(f.db,"lin",m.id);
   const readSession=(id:string)=>JSON.parse(f.db.prepare("SELECT body FROM agent_sessions WHERE id=?").get(id)!.body as string);
   assert.equal(readSession(sessions[0]).messages.length,1);assert.equal(readSession(sessions[1]).messages.length,0);
 }finally{f.db.close();}
});
