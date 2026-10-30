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
        complete: async (messages, tools) => {
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
          t.stage === "tool_completed" && t.detail === "explore_owned_software",
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
    const replay = await executeSoftware(f.db, f.read, "lin", input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.observed.revision, result.observed.revision);
    await assert.rejects(
      () => executeSoftware(f.db, f.read, "lin", { ...input, brightness: 38 }),
      /内容变化/,
    );
    const observed = await readSoftware(f.db, f.read, "lin", id);
    assert.equal(observed.observed.brightness, 37);
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
