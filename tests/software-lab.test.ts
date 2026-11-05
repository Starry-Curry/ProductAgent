import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import {
  analyzeOwnedLamp,
  grantSoftware,
  executeSoftware,
  readSoftware,
  closeSoftwareLab,
} from "../src/lib/devices/software-lab.ts";
import { respond } from "../src/lib/agent/service.ts";
import { registeredCapabilities } from "../src/lib/foundation/capabilities.ts";
import {createTask,resolveTaskContext,taskOutcomes} from '../src/lib/foundation/tasks.ts';
test("自有软件灯：真实REA→静态候选→授权→执行回读；坏参数、重放、撤权", async (t) => {
  if (
    !fs.existsSync(".runtime/rea-tools/node_modules/rea-agents/scripts/rea.mjs")
  ) {
    t.skip(
      "REA is an optional pinned local experiment, not an offline CI dependency",
    );
    return;
  }
  const f = validationFixture(
    fs.mkdtempSync(path.join(process.cwd(), ".runtime", "software-test-")),
  );
  const previous = process.env.WUJIAN_ENABLE_DEVICE_LAB;
  process.env.WUJIAN_ENABLE_DEVICE_LAB = "true";
  try {
    const id = f.add(
      "[合成]自有软件灯",
      "电子设备",
      "Wujian",
      "WUJIAN-SOFTWARE-LAMP-1",
    );
    const state = f.read();
    state.items.find((i) => i.id === id)!.synthetic = true;
    f.write(state);
    const a = await analyzeOwnedLamp(f.db, f.read, "lin", id);
    assert.match(a.evidenceId, /^ev_/);
    assert.equal(a.reaVersion, "6.8.0");
    assert.ok(a.candidates.length >= 2);
    let rounds = 0;
    const task = await respond(
      f.db,
      f.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        itemId: id,
        mode: "service",
        question: "请分析这盏自有软件灯的接口，暂时不控制它",
        memoryPolicy: "off",
        uiContext: { page: "item" },
      },
      {
        ready: true,
        model: "tool-routing-substitute",
        generate: async () => {
          throw Error("unexpected generate");
        },
        converse: async (messages, tools) => {
          rounds++;
          if (rounds === 1) {
            assert.ok(
              tools.some((t) => t.function.name === "explore_owned_software"),
            );
            return {
              text: "",
              model: "tool-routing-substitute",
              tokens: null,
              finishReason: "tool_calls",
              toolCalls: [
                {
                  id: "rea-1",
                  type: "function",
                  function: {
                    name: "explore_owned_software",
                    arguments: JSON.stringify({ itemId: id }),
                  },
                },
              ],
            };
          }
          assert.ok(
            messages.some(
              (m) => m.role === "tool" && m.content?.includes("reaVersion"),
            ),
          );
          return {
            text: JSON.stringify({
              kind: "general",
              answer:
                "已取得自有软件灯的静态接口候选。只有你授权并确认后，才能在软件模拟器进一步验证；当前没有控制真实设备。",
              factIds: [],
              questions: [],
            }),
            model: "tool-routing-substitute",
            tokens: null,
            finishReason: "stop",
            toolCalls: [],
          };
        },
      },
    );
    assert.equal(rounds, 2);
    assert.ok(
      task.trace.some(
        (t) =>
          t.stage === "practical_tool" && t.detail === "explore_owned_software completed",
      ),
    );
    const input = {
      itemId: id,
      requestId: crypto.randomUUID(),
      brightness: 37,
      confirmed: true,
    };
    await assert.rejects(
      () => executeSoftware(f.db, f.read, "lin", input),
      /授权/,
    );
    grantSoftware(f.db, f.read, "lin", id, true);
    await assert.rejects(
      () => executeSoftware(f.db, f.read, "lin", { ...input, brightness: 300 }),
      /0—100/,
    );
    const result = await executeSoftware(f.db, f.read, "lin", input);
    assert.equal(result.status, "verified");
    assert.equal(result.observed.brightness, 37);
    assert.equal(registeredCapabilities(f.db,f.read(),"lin",id)[0].sourceState,"software_verified");
    assert.equal(registeredCapabilities(f.db,f.read(),"lin",id)[0].targetType,"software_simulator");
    assert.deepEqual(registeredCapabilities(f.db,f.read(),"friend",id),[]);
    const replay = await executeSoftware(f.db, f.read, "lin", input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.observed.revision, result.observed.revision);
    await assert.rejects(
      () => executeSoftware(f.db, f.read, "lin", { ...input, brightness: 38 }),
      /内容变化/,
    );
    const observed = await readSoftware(f.db, f.read, "lin", id);
    assert.equal(observed.observed.brightness, 37);
    const livingTask=createTask(f.db,f.read,'lin',{requestId:crypto.randomUUID(),goal:'合成生活任务：用软件灯选择适合自己的设置',intent:'explore',itemInstanceIds:[id]});
    const taskCount=(f.db.prepare('SELECT count(*) AS n FROM foundation_tasks').get() as {n:number}).n;
    const connected=await executeSoftware(f.db,f.read,'lin',{...input,requestId:crypto.randomUUID(),brightness:37,taskId:livingTask.taskId});
    assert.equal(connected.taskId,livingTask.taskId);assert.equal((f.db.prepare('SELECT count(*) AS n FROM foundation_tasks').get() as {n:number}).n,taskCount,'专业软件动作不能另建平行任务');
    assert.ok(taskOutcomes(f.db,f.read(),'lin',livingTask.taskId).some(o=>o.basis==='software_simulator_readback'));
    assert.ok(!resolveTaskContext(f.db,f.read(),'lin',livingTask.taskId).previousOutcomes.some(o=>o.basis==='software_simulator_readback'),'没有长期复用同意时，当前结果不自动成为云端经历');
    async function readThroughAgent(revokeDuringFinal=false){
      let calls=0;
      return respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,taskId:livingTask.taskId,mode:'auto',question:'读取当前自有软件灯的实际亮度，不调光，不操作任何真实设备',memoryPolicy:'off'},{
        ready:true,structuredOutput:'json_schema',model:'offline-readback-protocol',generate:async()=>{throw Error('no_second_reviewer');},converse:async(messages,tools,options)=>{
          calls++;
          if(calls===1){const packet=JSON.parse(messages.find(m=>m.role==='user')!.content!);assert.ok(packet.softwareCapabilities.some((c:any)=>c.targetType==='software_simulator'));assert.notDeepEqual(options?.toolChoice,{type:'function',function:{name:'search_product_knowledge'}},'真实软件适配器不应被迫搜索虚构商品官网');assert.ok(tools.some(t=>t.function.name==='read_owned_software'));
            return {model:'offline-readback-protocol',text:'',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'read',type:'function',function:{name:'read_owned_software',arguments:JSON.stringify({itemId:id})}}]};}
          assert.ok(messages.some(m=>m.role==='tool'&&m.content?.includes('"brightness":37')),'主模型确实读到实际本机HTTP回读');
          if(revokeDuringFinal)grantSoftware(f.db,f.read,'lin',id,false);
          return {model:'offline-readback-protocol',text:'',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'final',type:'function',function:{name:'complete_answer',arguments:JSON.stringify({message:'当前本机软件灯回读亮度37；不是硬件状态，未调光。',guidance:null})}}]};
        },
      });
    }
    const agentRead=await readThroughAgent();assert.equal(agentRead.modelCalls,2);assert.match(agentRead.reply.answer,/软件灯回读亮度37/);assert.equal(agentRead.foundation?.taskId,livingTask.taskId);
    await assert.rejects(()=>readThroughAgent(true),/软件回读授权或版本已变化/);grantSoftware(f.db,f.read,'lin',id,true);
    const unrelated=f.add('[合成]另一个账号的物品','其他','','');const foreignState=f.read();foreignState.items.find(i=>i.id===unrelated)!.owner='dad';f.write(foreignState);
    const foreignTask=createTask(f.db,f.read,'dad',{requestId:crypto.randomUUID(),goal:'不可借用的私人任务',intent:'plan',itemInstanceIds:[unrelated]});
    await assert.rejects(()=>executeSoftware(f.db,f.read,'lin',{...input,requestId:crypto.randomUUID(),brightness:99,taskId:foreignTask.taskId}),/任务不存在或未获授权/);
    assert.equal((await readSoftware(f.db,f.read,'lin',id)).observed.brightness,37,'跨账号任务ID不得触发写入');
    const guardedFetch=globalThis.fetch;let dispatched=0;
    try{globalThis.fetch=async(url,init)=>{if(init?.method==="POST")dispatched++;return guardedFetch(url,init);};
      const delayed=executeSoftware(f.db,f.read,"lin",{...input,requestId:crypto.randomUUID(),brightness:39});
      grantSoftware(f.db,f.read,"lin",id,false);
      grantSoftware(f.db,f.read,"lin",id,true);
      await assert.rejects(()=>delayed,/授权|变化/);assert.equal(dispatched,0);
    }finally{globalThis.fetch=guardedFetch;}
    const otherId=f.add("[合成]第二盏独立软件灯","电子设备","Wujian","WUJIAN-SOFTWARE-LAMP-1");
    const another=f.read();another.items.find(i=>i.id===otherId)!.synthetic=true;f.write(another);
    await analyzeOwnedLamp(f.db,f.read,"lin",otherId);
    grantSoftware(f.db,f.read,"lin",otherId,true);
    assert.equal((await readSoftware(f.db,f.read,"lin",otherId)).observed.brightness,40);
    assert.equal((await readSoftware(f.db,f.read,"lin",id)).observed.brightness,37);
    // Real local HTTP write with an injected concurrent revocation. The write may
    // have happened, so never convert this into a claimed successful result.
    const originalFetch=globalThis.fetch;
    let writes=0;
    try {
      globalThis.fetch=async (url,init)=>{
        const response=await originalFetch(url,init);
        if(init?.method==="POST"&&String(url).endsWith("/brightness")){
          writes++;
          grantSoftware(f.db,f.read,"lin",id,false);
        }
        return response;
      };
      await assert.rejects(()=>executeSoftware(f.db,f.read,"lin",{...input,requestId:crypto.randomUUID(),brightness:42}),/授权已撤销/);
      assert.equal(writes,1);
    } finally {globalThis.fetch=originalFetch;}
    grantSoftware(f.db,f.read,"lin",id,true);
    const interrupted={...input,requestId:crypto.randomUUID(),brightness:25};
    f.db.prepare("INSERT INTO software_operations VALUES(?,?,?,?)").run("lin",interrupted.requestId,JSON.stringify(interrupted),JSON.stringify({status:"pending-verification",simulated:true}));
    const beforePending=await readSoftware(f.db,f.read,"lin",id);
    assert.equal((await executeSoftware(f.db,f.read,"lin",interrupted)).status,"pending-verification");
    const afterPending=await readSoftware(f.db,f.read,"lin",id);
    assert.equal(afterPending.observed.revision,beforePending.observed.revision);
    const transferred=f.read();transferred.items.find(i=>i.id===otherId)!.availability="gifted";f.write(transferred);
    await assert.rejects(()=>executeSoftware(f.db,f.read,"lin",{...input,itemId:otherId,requestId:crypto.randomUUID()}),/流转|持有/);
    assert.deepEqual(registeredCapabilities(f.db,f.read(),"lin",otherId),[]);
    grantSoftware(f.db, f.read, "lin", id, false);
    await assert.rejects(() => readSoftware(f.db, f.read, "lin", id), /授权/);
    await assert.rejects(
      () => executeSoftware(f.db, f.read, "friend", input),
      /自有软件/,
    );
  } finally {
    await closeSoftwareLab();
    f.db.close();
    process.env.WUJIAN_ENABLE_DEVICE_LAB = previous;
  }
});
