import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import {
  installVirtualHome,
  refreshHomeKnowledge,
  setVirtualHomeCloud,
  virtualHomeItems,
} from "../src/lib/life/virtual-home.ts";
import {
  homeItemId,
  apartmentProducts,
} from "../src/lib/catalog/virtual-apartment.ts";
import { isProductManual } from "../src/lib/life/manuals.ts";
import { readKnowledge } from "../src/lib/life/acquisition.ts";
import { compileTaskContext } from "../src/lib/context/compiler.ts";
import { AgentError, type ServiceSession } from "../src/lib/agent/contracts.ts";
import {
  listMemories,
  forgetMemory,
  saveMemory,
  savePersona,
} from "../src/lib/memory/store.ts";
import { respond } from "../src/lib/agent/service.ts";
import type { Provider, ModelMessage } from "../src/lib/ai/provider.ts";
const fixture = () => {
  mkdirSync(".runtime", { recursive: true });
  return validationFixture(mkdtempSync(path.resolve(".runtime/home-test-")));
};
const input = (extra: Record<string, unknown> = {}) => ({
  requestId: crypto.randomUUID(),
  question: "这幅画是谁送的？和新书桌怎么一起安排？",
  mode: "auto",
  memoryPolicy: "read",
  uiContext: { page: "assistant", homeId: "young-apartment-v1" },
  ...extra,
});
/** Offline provider substitute: verifies the shared production protocol, not Qwen quality. */
function model(options: {
  beforeAnswer?: () => void;
  foreign?: boolean;
  inspect?: (messages: ModelMessage[]) => void;
} = {}): Provider {
  return {
    ready: true, model: "offline-home-substitute",
    generate: async () => { throw Error("retired_home_generate_must_not_run"); },
    complete: async () => { throw Error("retired_home_complete_must_not_run"); },
    converse: async (messages) => {
      options.inspect?.(messages);
      const tools=messages.filter(m=>m.role==='tool');
      const itemIds=options.foreign?[homeItemId("dad","painting")]:[homeItemId("lin","painting"),homeItemId("lin","desk")];
      if(tools.length<2)return {text:'',model:'offline-home-substitute',tokens:{input:10,output:10},finishReason:'tool_calls',toolCalls:[{id:'read-'+tools.length,type:'function',function:{name:tools.length?'get_relevant_experiences':'get_item_context',arguments:JSON.stringify({itemIds})}}]};
      options.beforeAnswer?.();
      return {text:'赠送者来自获准关系记忆；完整目标仍需核对支撑结构。',model:'offline-home-substitute',tokens:{input:20,output:20},finishReason:'stop',toolCalls:[]};
    },
  };
}
function homeContext(t: ReturnType<typeof fixture>, question: string, itemIds: string[], options: {
  temporary?: boolean; memoryPolicy?: string; useItemMemories?: boolean; query?: string;
  known?: Record<string,string>; actor?: 'lin'|'dad';
} = {}) {
  const now=new Date().toISOString();
  const session: ServiceSession={id:'offline-context',owner:options.actor||'lin',mode:'auto',revision:0,status:'active',messages:[],tried:[],memoryEpoch:0,createdAt:now,updatedAt:now,expiresAt:new Date(Date.now()+60000).toISOString(),known:{homeId:'young-apartment-v1',memoryPolicy:options.memoryPolicy||'read',useItemMemories:options.useItemMemories===false?'no':'yes',...options.known}};
  return compileTaskContext(t.db,t.read(),options.actor||'lin',session,question,options.temporary,options.query?[options.query]:[],itemIds,18000);
}
test("固定家庭八件物品保持精确SKU，单次显式许可且重复加载不复活遗忘记忆", () => {
  const t = fixture();
  try {
    const before = t.read().items.length;
    installVirtualHome(t.db, t.read, "lin", true);
    const items = virtualHomeItems(t.read(), "lin");
    assert.equal(items.length, 8);
    assert.equal(t.read().items.length, before + 8);
    assert.deepEqual(
      items.slice(0, 7).map((i) => i.model),
      apartmentProducts.map((p) => p.model),
    );
    assert.ok(items.every((i) => i.synthetic && !i.shared));
    const memory = listMemories(t.db, t.read(), "lin").find(
      (m) => m.kind === "relationship",
    )!;
    forgetMemory(t.db, "lin", memory.id);
    assert.equal(installVirtualHome(t.db, t.read, "lin", true).replayed, true);
    assert.equal(
      listMemories(t.db, t.read(), "lin").filter(
        (m) => m.kind === "relationship" && m.status === "active",
      ).length,
      0,
    );
    assert.equal(virtualHomeItems(t.read(), "dad").length, 0);
  } finally {
    t.db.close();
  }
});
test("PDF格式不是说明书：算法备案、合规文件、营销PDF被排除", () => {
  for (const title of [
    "算法备案说明.pdf",
    "Declaration of Conformity.pdf",
    "隐私政策.pdf",
    "营销产品手册.pdf",
    "Algorithm filing manual.pdf",
  ])
    assert.equal(
      isProductManual({ title, url: "https://www.mi.com/public.pdf" }),
      false,
    );
  for (const url of [
    "https://resources.ikea.cn/assembly_instructions/micke.pdf",
    "https://www.lego.com/product.bi.core.pdf/123.pdf",
    "https://support.jbl.com/GO_4_QSG_Global.pdf",
  ])
    assert.equal(isProductManual({ title: "", url }), true);
  assert.equal(
    isProductManual({ title: "其他文档", url: "https://www.mi.com/a.pdf" }),
    false,
  );
  assert.doesNotThrow(() =>
    isProductManual({ title: "其他文档", url: "https://www.mi.com/%bad" }),
  );
});
test("商品页只跟随明确说明书，法务PDF在前也不会误入；备用产品页也能取得说明书", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", false);
    const visited: string[] = [];
    const fetcher = async (url: string) => {
      visited.push(url);
      if (url === apartmentProducts.find((p) => p.key === "roses")!.url)
        throw Error("page inaccessible");
      if (url.includes("building-instructions"))
        return {
          url,
          title: "LEGO 10328",
          text: "10328 Bouquet of Roses",
          links: [
            { title: "Legal PDF", url: "https://www.lego.com/legal.pdf" },
            {
              title: "Building instructions",
              url: "https://www.lego.com/product.bi.core.pdf/123.pdf",
            },
          ],
        };
      return {
        url,
        title: "Building instructions",
        text: "Assembly diagrams",
        links: [],
      };
    };
    const r = await refreshHomeKnowledge(t.db, t.read, "lin", "roses", fetcher);
    assert.equal(r.status, "live-read");
    assert.ok(visited.length >= 3);
    assert.ok(!visited.some((v) => v.endsWith("legal.pdf")));
    assert.ok(
      readKnowledge(t.db, t.read(), "lin", homeItemId("lin", "roses")).some(
        (d) => d.role === "manual" && d.url.endsWith("123.pdf"),
      ),
    );
  } finally {
    t.db.close();
  }
});
test("联网期间物品所有权变化后不写入官方缓存", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", false);
    const r = await refreshHomeKnowledge(
      t.db,
      t.read,
      "lin",
      "desk",
      async (url) => {
        const s = t.read();
        s.items.find((i) => i.id === homeItemId("lin", "desk"))!.owner = "dad";
        t.write(s);
        return {
          url,
          title: "MICKE 803.542.81",
          text: "803.542.81 width 73 cm",
          links: [],
        };
      },
    );
    assert.equal(r.status, "unavailable");
    assert.equal(
      t.db.prepare("SELECT count(*) AS n FROM life_knowledge_documents").get()!
        .n,
      0,
    );
  } finally {
    t.db.close();
  }
});
test("授权、临时模式、另一个用户及显式分身记忆策略不能被工具query绕过", () => {
  const t=fixture();try{
    installVirtualHome(t.db,t.read,'lin',true);
    const ids=[homeItemId('lin','painting')];
    const privateFacts=(c:ReturnType<typeof homeContext>)=>c.evidence.filter(e=>e.basis==='user_report'&&e.id!=='user:current-turn');
    assert(privateFacts(homeContext(t,'布局',ids)).some(m=>m.text.includes('小夏')));
    assert.equal(privateFacts(homeContext(t,'布局',ids,{temporary:true})).length,0);
    assert.equal(privateFacts(homeContext(t,'布局',ids,{memoryPolicy:'off'})).length,0);
    assert.equal(privateFacts(homeContext(t,'布局',ids,{useItemMemories:false})).length,0);
    assert.equal(homeContext(t,'回忆',ids,{actor:'dad'}).items.length,0);
    savePersona(t.db,t.read(),'lin',{enabled:true,nickname:'山山',style:'warm',memoryUse:'explicit',itemId:ids[0]});
    assert(!privateFacts(homeContext(t,'如何布置',ids,{query:'回忆谁送的'})).some(m=>m.text.includes('小夏')));
  }finally{t.db.close();}
});

test("没有模拟家庭云端许可时绝不调用模型；许可开关不会扩大单条记忆许可", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", false);
    let calls = 0;
    const provider = model({ inspect: () => calls++ });
    const r = await respond(t.db, t.read, "lin", input(), provider);
    assert.equal(r.modelCalls, 0);
    assert.equal(calls, 0);
    assert.equal(r.reply.outcome, "blocked");
    setVirtualHomeCloud(t.db, t.read, "lin", true);
    assert.ok(listMemories(t.db, t.read(), "lin").every((m) => !m.allowCloud));
  } finally {
    t.db.close();
  }
});
test("家庭薄桥实际使用共享converse与语义工具，保存会话目标但不伪造子任务完成", async () => {
  const t=fixture();try{
    installVirtualHome(t.db,t.read,'lin',true);let sawItems=false,sawRelationship=false;
    const r=await respond(t.db,t.read,'lin',input(),model({inspect:messages=>{
      for(const m of messages.filter(m=>m.role==='tool')){const c=JSON.parse(m.content||'{}');
        if(c.items){sawItems=true;assert(c.items.some((i:any)=>JSON.stringify(i.facts).includes('40×30')));}
        if(c.privateFacts){sawRelationship=true;assert(c.privateFacts.some((m:any)=>m.text.includes('小夏')));}
      }
    }}));
    assert.equal(r.modelCalls,3);assert(sawItems&&sawRelationship);
    assert(r.trace.some(t=>t.stage==='practical_model'));assert.equal(r.reply.task,undefined);
    assert.equal(r.session.known.homeTaskGoal,input().question);
    assert.equal(t.db.prepare('SELECT count(*) AS n FROM graph_checkpoints').get()!.n,0);
    let packet:any;
    await respond(t.db,t.read,'lin',input({sessionId:r.session.id,question:'那我想改成平放'}),model({inspect:messages=>{packet=JSON.parse(messages.find(m=>m.role==='user')!.content!);}}));
    assert.equal(packet.currentTask.goal,input().question);
    assert.equal(packet.currentTask.basis,'previous_conversation_goal_not_verified_result');
  }finally{t.db.close();}
});

test("共享工具不能读其他用户家庭，未读取的伪造物品引用不扩大权限", async () => {
 const t=fixture();try{
  installVirtualHome(t.db,t.read,'lin',true);installVirtualHome(t.db,t.read,'dad',true);
  await assert.rejects(respond(t.db,t.read,'lin',input(),model({foreign:true})),/未获授权/);
 }finally{t.db.close();}
});

test("多轮推理期间遗忘记忆，丢弃在途草稿而不提交旧关系", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    const m = listMemories(t.db, t.read(), "lin").find(
      (m) => m.kind === "relationship",
    )!;
    await assert.rejects(
      respond(
        t.db,
        t.read,
        "lin",
        input(),
        model({ beforeAnswer: () => forgetMemory(t.db, "lin", m.id) }),
      ),
      (e: unknown) => e instanceof AgentError && e.status === 409,
    );
  } finally {
    t.db.close();
  }
});
test("纠正/遗忘后共享上下文仅保留新关系；旧私人片段不作为第二来源", () => {
 const t=fixture();try{
  installVirtualHome(t.db,t.read,'lin',true);
  const m=listMemories(t.db,t.read(),'lin').find(m=>m.kind==='relationship')!;
  forgetMemory(t.db,'lin',m.id);
  saveMemory(t.db,t.read,'lin',{kind:'relationship',text:'这幅画是小林送的',itemId:m.itemId,allowCloud:true});
  let c=homeContext(t,'画的来历和布置',[m.itemId!]);
  assert(JSON.stringify(c.evidence).includes('小林'));assert(!JSON.stringify(c.evidence).includes('小夏'));
  const corrected=listMemories(t.db,t.read(),'lin').find(m=>m.status==='active'&&m.text.includes('小林'))!;
  forgetMemory(t.db,'lin',corrected.id);c=homeContext(t,'画的来历',[m.itemId!]);
  assert(!JSON.stringify(c.evidence).includes('小林'));assert(!JSON.stringify(c.evidence).includes('小夏'));
 }finally{t.db.close();}
});

test("家庭共享目录只含八件模拟物品；获准家庭偏好可用，真实偏好及未选关系不混入", () => {
 const t=fixture();try{
  installVirtualHome(t.db,t.read,'lin',true);
  const real=t.add('私人杯子','杯子','私人','未知');
  saveMemory(t.db,t.read,'lin',{kind:'preference',text:'GLOBAL_MEMORY_PRIVATE',itemId:real,allowCloud:true});
  const s=t.read();(s.contexts||=[]).push({id:'private-pref',owner:'lin',key:'PRIVATE_CONTEXT',value:'GLOBAL_CONTEXT_PRIVATE',status:'explicit',allowCloud:true} as any);t.write(s);
  const c=homeContext(t,'如何调灯',[homeItemId('lin','lamp')]);
  assert.equal(c.authorizedItemIds.length,8);assert(c.authorizedItemIds.every(id=>id.startsWith('virtual-home:lin:')));
  assert(c.preferences.some(p=>String(p.value).includes('安静')));
  const packet=JSON.stringify({...c,authorizedItemIds:undefined});
  assert(!packet.includes('GLOBAL_'));assert(!packet.includes('小夏'));assert(!packet.includes('模拟私人赠画故事'));
 }finally{t.db.close();}
});

test("家庭共享循环不恢复旧complete/read_home_items协议，所有回合权限范围一致", async () => {
 const t=fixture();try{
  installVirtualHome(t.db,t.read,'lin',true);let calls=0;
  const p=model({inspect:messages=>{calls++;assert(!JSON.stringify(messages).includes('read_home_items'));}});
  await respond(t.db,t.read,'lin',input(),p);assert.equal(calls,3);
  const legacyOnly={...p,converse:undefined};
  const r=await respond(t.db,t.read,'lin',input(),legacyOnly);
  assert.equal(r.reply.outcome,'unavailable');assert.equal(r.modelCalls,0);
 }finally{t.db.close();}
});

test("云端授权在推理期间撤回，拒绝在途回答；提供者不可用时不冒充模型回答", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    const offline = await respond(t.db, t.read, "lin", input(), {
      ready: false,
      model: "offline",
      generate: async () => {
        throw Error("must not call");
      },
    });
    assert.equal(offline.reply.outcome, "unavailable");
    assert.equal(offline.modelCalls, 0);
    await assert.rejects(
      respond(
        t.db,
        t.read,
        "lin",
        input(),
        model({
          beforeAnswer: () => setVirtualHomeCloud(t.db, t.read, "lin", false),
        }),
      ),
      (e: unknown) => e instanceof AgentError && e.status === 409,
    );
  } finally {
    t.db.close();
  }
});

test("模拟家庭与原空间不能复用已有聊天上下文；无关的私人物品不进入家庭模型", async () => {
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    const r = await respond(t.db, t.read, "lin", input(), model());
    await assert.rejects(
      respond(
        t.db,
        t.read,
        "lin",
        input({ sessionId: r.session.id, uiContext: { page: "assistant" } }),
        model(),
      ),
      /开始新问题/,
    );
  } finally {
    t.db.close();
  }
});

test("多主题原文交错选取，后一个问题不会被前一个问题挤掉", async () => {
  const { homeTaskPassages } = await import("../src/lib/context/home-task.ts");
  const passages = homeTaskPassages(
    (topic) => Array.from({ length: 8 }, (_, i) => ({ id: topic + i })),
    ["尺寸", "材质", "限制"],
  );
  assert.deepEqual(
    passages.map((p) => p.id),
    ["尺寸0", "材质0", "限制0", "尺寸1", "材质1", "限制1"],
  );
});

test("未请求的家庭资源仅可发现，不附带无关说明书、关系与私人状态", () => {
 const t=fixture();try{
  installVirtualHome(t.db,t.read,'lin',true);
  const c=homeContext(t,'台灯调光',[homeItemId('lin','lamp')]);
  assert.equal(c.items.length,1);assert.equal(c.items[0].id,homeItemId('lin','lamp'));
  assert(c.evidence.filter(e=>e.basis==='official').every(e=>e.itemId===homeItemId('lin','lamp')));
  assert(c.catalogue.every(i=>!('note' in i)&&!('location' in i)&&!('owner' in i)));
  assert(!JSON.stringify(c.evidence).includes('小夏'));
 }finally{t.db.close();}
});

test("家庭再创造要求既有显式许可，不能扩大到原有真实空间", async () => {
  const { planDiscovery } = await import("../src/lib/life/planning.ts");
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", false);
    let calls = 0;
    const p = {
      ...model(),
      generate: async () => {
        calls++;
        throw Error("must not call");
      },
    };
    await assert.rejects(
      () =>
        planDiscovery(
          t.db,
          t.read(),
          "lin",
          {
            goal: "新用途",
            homeId: "young-apartment-v1",
            engine: "legacy", model: true,
            includeSynthetic: true,
          },
          p,
          t.read,
        ),
      /授权/,
    );
    setVirtualHomeCloud(t.db, t.read, "lin", true);
    const foreign = t
      .read()
      .items.find((i) => !i.id.startsWith("virtual-home:"))!;
    await assert.rejects(
      () =>
        planDiscovery(
          t.db,
          t.read(),
          "lin",
          {
            goal: "新用途",
            homeId: "young-apartment-v1",
            itemIds: [foreign.id],
            engine: "legacy", model: true,
            includeSynthetic: true,
          },
          p,
          t.read,
        ),
      /未获授权/,
    );
    assert.equal(calls, 0);
  } finally {
    t.db.close();
  }
});

test("再创造途中撤回家庭云端许可，停止后续模型与方案保存", async () => {
  const { planDiscovery } = await import("../src/lib/life/planning.ts");
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    let calls = 0;
    const p = {
      ...model(),
      generate: async () => {
        calls++;
        setVirtualHomeCloud(t.db, t.read, "lin", false);
        return { text: "draft", model: "offline", tokens: null };
      },
    };
    await assert.rejects(
      () =>
        planDiscovery(
          t.db,
          t.read(),
          "lin",
          {
            goal: "探索新用途",
            homeId: "young-apartment-v1",
            engine: "legacy", model: true,
            includeSynthetic: true,
            publicEvidence: false,
          },
          p,
          t.read,
        ),
      /授权|变化/,
    );
    assert.equal(calls, 1);
    assert.equal(
      t.db.prepare("SELECT count(*) as n FROM life_ideas").get()!.n,
      0,
    );
  } finally {
    t.db.close();
  }
});

test("旧助手建议不成为当前事实，用户限制保留且本轮新目标优先", async () => {
 const t=fixture();try{
  installVirtualHome(t.db,t.read,'lin',true);
  const first=await respond(t.db,t.read,'lin',input({question:'先写手账，不购买'}),model());
  let checked=false;
  await respond(t.db,t.read,'lin',input({sessionId:first.session.id,question:'改成收拾桌面，不用画'}),model({inspect:messages=>{
   const packet=JSON.parse(messages.find(m=>m.role==='user')!.content!);checked=true;
   assert(packet.history.some((m:any)=>m.role==='user'&&m.text.includes('不购买')));
   assert.equal(packet.question,'改成收拾桌面，不用画');
   assert(!JSON.stringify(packet.privateFacts).includes('完整目标仍需核对支撑结构'));
  }}));assert(checked);
 }finally{t.db.close();}
});

test("选中创意及反馈可回到原家庭任务，不把草稿当成已验证结果", async () => {
  const { storeLifeIdea, feedbackIdea } =
    await import("../src/lib/life/ideas.ts");
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    const itemId = homeItemId("lin", "samla"),
      id = crypto.randomUUID();
    storeLifeIdea(t.db, "lin", {
      id,
      title: "测试再创造",
      itemIds: [itemId],
      minutes: 10,
      steps: ["先核对实际条件"],
      limits: [],
      source: "model-creative",
      evidence: [],
      tested: false,
      goal: "测试目标",
    });
    feedbackIdea(t.db, t.read(), "lin", {
      id,
      saved: true,
      outcome: "未成功",
      note: "不要占桌面，请换一种作用",
    });
    const first = await respond(t.db, t.read, "lin", input(), model());
    const base = model();
    let seen = false;
    const p = {
      ...base,
      converse: async (...args: Parameters<NonNullable<Provider['converse']>>) => {
        const value=JSON.parse(args[0].find(m=>m.role==='user')!.content!);
        seen = true;
        assert.equal(value.selectedPlans[0].note, "不要占桌面，请换一种作用");
        assert.equal(value.selectedPlans[0].verification, "model-hypothesis-not-physical-verification");
        return base.converse!(...args);
      },
    };
    const next = await respond(
      t.db,
      t.read,
      "lin",
      input({
        sessionId: first.session.id,
        question: "带着方案继续",
        uiContext: {
          page: "assistant",
          homeId: "young-apartment-v1",
          planContext: { previousIdeaIds: [id], feedbackIdeaIds: [id] },
        },
      }),
      p,
    );
    assert.equal(next.session.id, first.session.id);
    assert.ok(seen);
  } finally {
    t.db.close();
  }
});

test("共享语义使用真实规范物品ID，旧短句柄及相似拼写不能模糊解析", async () => {
 const t=fixture();try{
  installVirtualHome(t.db,t.read,'lin',true);
  const r=await respond(t.db,t.read,'lin',input(),model());
  assert(r.reply.usedItems!.every(i=>i.id.startsWith('virtual-home:lin:')));
  for(const forged of ['item8','item8x',homeItemId('lin','painting')+'x']){
   const p=model();p.converse=async()=>({text:'',model:'offline',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'bad',type:'function',function:{name:'get_item_context',arguments:JSON.stringify({itemIds:[forged]})}}]});
   await assert.rejects(respond(t.db,t.read,'lin',input(),p),/未获授权/);
  }
 }finally{t.db.close();}
});

test("单件再创造可使用获准家庭偏好，但不读取全局私人偏好", async () => {
  const { planDiscovery } = await import("../src/lib/life/planning.ts");
  const { ProviderError } = await import("../src/lib/ai/provider.ts");
  const t = fixture();
  try {
    installVirtualHome(t.db, t.read, "lin", true);
    saveMemory(t.db, t.read, "lin", {
      kind: "preference",
      text: "我喜欢旅行与安静 GLOBAL_PRIVATE",
      allowCloud: true,
    });
    let seen: any;
    const p = {
      ...model(),
      generate: async (_system: any, value: any) => {
        seen = value;
        throw new ProviderError("network", "offline-stop");
      },
    };
    await assert.rejects(
      () =>
        planDiscovery(
          t.db,
          t.read(),
          "lin",
          {
            goal: "探索新的创意用法，我喜欢旅行和安静",
            itemId: homeItemId("lin", "samla"),
            itemIds: [homeItemId("lin", "samla")],
            homeId: "young-apartment-v1",
            includeSynthetic: true,
            engine: "legacy", model: true,
            publicEvidence: false,
          },
          p,
          t.read,
        ),
      /offline-stop/,
    );
    assert.equal(seen.creativeFacts.length, 1);
    assert.ok(
      seen.authorizedPreferences.some((m: any) => m.text.includes("安静")),
    );
    assert.ok(!JSON.stringify(seen).includes("GLOBAL_PRIVATE"));
  } finally {
    t.db.close();
  }
});


test("共享家庭运行在memoryPolicy off及临时模式下不把私人记忆或偏好发给云端", async () => {
 const t=fixture();try{
  installVirtualHome(t.db,t.read,'lin',true);
  for(const temporary of [false,true]){
   let inspected=0;
   await respond(t.db,t.read,'lin',input({memoryPolicy:'off',temporary}),model({inspect:messages=>{
    inspected++;const serialized=JSON.stringify(messages);
    assert(!serialized.includes('小夏'));assert(!serialized.includes('喜欢安静'));
    const packet=JSON.parse(messages.find(m=>m.role==='user')!.content!);
    assert.deepEqual(packet.privateFacts,[]);assert.deepEqual(packet.preferences,[]);
   }}));assert(inspected>0);
  }
 }finally{t.db.close();}
});

test("即使另一个账号主动共享了模拟物品，家庭工具也不能越过本家庭隔离", async () => {
 const t=fixture();try{
  installVirtualHome(t.db,t.read,'lin',true);installVirtualHome(t.db,t.read,'dad',true);
  const s=t.read();s.items.find(i=>i.id===homeItemId('dad','painting'))!.sharedWith=['lin'];t.write(s);
  const c=homeContext(t,'这幅画是谁送的',[homeItemId('dad','painting')]);
  assert(!c.authorizedItemIds.includes(homeItemId('dad','painting')));
  assert(!c.semanticItems.some(i=>i.id===homeItemId('dad','painting')));
  await assert.rejects(respond(t.db,t.read,'lin',input(),model({foreign:true})),(e:unknown)=>e instanceof AgentError&&e.status===403);
 }finally{t.db.close();}
});

test("家庭分身仅显式选中当前物品，不把分身名当用户或加载邻近关系", () => {
 const t=fixture();try{
  installVirtualHome(t.db,t.read,'lin',true);
  const c=homeContext(t,'你好',[],{known:{homeVoiceItemId:homeItemId('lin','lamp')}});
  assert.deepEqual(c.items.map(i=>i.id),[homeItemId('lin','lamp')]);
  assert(!JSON.stringify(c.evidence).includes('小夏'));
 }finally{t.db.close();}
});

test("关闭会话及并发版本变化后，在途家庭模型回答不发布", async () => {
 for(const revisionOnly of [false,true]){
  const t=fixture();try{
   installVirtualHome(t.db,t.read,'lin',true);let published='';
   const p=model({beforeAnswer:()=>{
    const row=t.db.prepare('SELECT id,revision,body FROM agent_sessions LIMIT 1').get() as {id:string;revision:number;body:string};
    const body=JSON.parse(row.body);if(revisionOnly)body.revision++;else body.status='closed';
    t.db.prepare('UPDATE agent_sessions SET revision=?,body=? WHERE id=?').run(body.revision,JSON.stringify(body),row.id);
   }});p.onText=text=>{published+=text;};
   await assert.rejects(respond(t.db,t.read,'lin',input(),p),(e:unknown)=>e instanceof AgentError&&e.status===409);
   assert.equal(published,'');
  }finally{t.db.close();}
 }
});


test("家庭只传显式选中创意与反馈，过期epoch或跨范围创意不进模型", async () => {
 const {storeLifeIdea,feedbackIdea}=await import('../src/lib/life/ideas.ts');
 const {epoch}=await import('../src/lib/memory/store.ts');
 const t=fixture();try{
  installVirtualHome(t.db,t.read,'lin',true);installVirtualHome(t.db,t.read,'dad',true);
  const itemId=homeItemId('lin','samla'),id=crypto.randomUUID(),foreignId=crypto.randomUUID(),staleId=crypto.randomUUID();
  const idea={title:'合成候选',itemIds:[itemId],minutes:10,steps:['先确认条件'],limits:[],source:'model-creative' as const,evidence:[],tested:false as const,goal:'合成任务'};
  storeLifeIdea(t.db,'lin',{...idea,id});feedbackIdea(t.db,t.read(),'lin',{id,saved:true,outcome:'未成功',note:'PRIVATE_EXPLICIT_FEEDBACK'});
  storeLifeIdea(t.db,'lin',{...idea,id:foreignId,itemIds:[homeItemId('dad','painting')]});
  storeLifeIdea(t.db,'lin',{...idea,id:staleId,memoryEpoch:epoch(t.db,'lin')-1});
  assert.deepEqual(homeContext(t,'继续',[itemId]).selectedPlans,[]);
  const c=homeContext(t,'继续',[itemId],{known:{lifeIdeaIds:JSON.stringify([id,foreignId,staleId])}});
  assert.deepEqual(c.selectedPlans.map(p=>p.id),[id]);assert(!JSON.stringify(c.selectedPlans).includes('PRIVATE_EXPLICIT_FEEDBACK'));
  const feedback=homeContext(t,'继续',[itemId],{known:{lifeIdeaIds:JSON.stringify([id]),lifeFeedbackIds:JSON.stringify([id])}});
  assert.equal(feedback.selectedPlans[0].note,'PRIVATE_EXPLICIT_FEEDBACK');
  assert.equal(feedback.selectedPlans[0].verification,'model-hypothesis-not-physical-verification');
  assert.deepEqual(homeContext(t,'继续',[itemId],{temporary:true,known:{lifeIdeaIds:JSON.stringify([id]),lifeFeedbackIds:JSON.stringify([id])}}).selectedPlans,[]);
 }finally{t.db.close();}
});
