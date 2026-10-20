/** Current task only: <=30 model HTTP requests INCLUDING native search, retries and failed responses. */
import fs from "node:fs";
import path from "node:path";
import { createProvider, ProviderError } from "../src/lib/ai/provider.ts";
import { cloudStatus } from "../src/lib/life/provider.ts";
import { validationFixture } from "./life-validation-fixture.ts";
import { respond } from "../src/lib/agent/service.ts";
import {
  readKnowledge,
  acquireKnowledge,
} from "../src/lib/life/acquisition.ts";
import { planDiscovery } from "../src/lib/life/planning.ts";
const dir = path.join(process.cwd(), ".runtime", "knowledge-creative-20261020");
fs.mkdirSync(dir, { recursive: true });
const ledgerPath = path.join(dir, "ledger.json");
const ledger: { requests: any[]; cases: any[] } = fs.existsSync(ledgerPath)
  ? JSON.parse(fs.readFileSync(ledgerPath, "utf8"))
  : { requests: [], cases: [] };
const save = () =>
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
const lock = path.join(dir, "live.lock");
const fd = fs.openSync(lock, "wx");
const t = validationFixture(dir);
let test = "preflight";
const group = process.argv.includes("--products") ? "products" : "ideas";
const request: typeof fetch = async (url, options) => {
  const search = new URL(String(url)).pathname.includes(
    "text-generation/generation",
  );
  if (
    ledger.requests.length >= 30 ||
    (search && ledger.requests.filter((r) => r.search).length >= 6) ||
    ledger.requests.filter((r) => r.test === test).length >= 2 ||
    (group === "products" &&
      ledger.requests.filter((r) => r.group === "products").length >= 23)
  )
    throw new ProviderError(
      "budget_exhausted",
      "已到本轮或子任务请求上限；未发送",
    );
  const body = JSON.parse(String(options?.body || "{}"));
  const entry: any = {
    number: ledger.requests.length + 1,
    group,
    test,
    search,
    model: body.model,
    at: new Date().toISOString(),
    inputSummary: search
      ? body.input?.messages?.[0]?.content
      : {
          characters: JSON.stringify(body.messages || []).length,
          tools: body.tools?.map((t: any) => t.function.name),
        },
  };
  ledger.requests.push(entry);
  save();
  const start = Date.now();
  try {
    const r = await fetch(url, options);
    const d = await r
      .clone()
      .json()
      .catch(() => null);
    entry.status = r.status;
    entry.usage = d?.usage;
    entry.output = d?.choices?.[0]?.message || d?.output;
    return r;
  } catch (e) {
    entry.status = "network_failed";
    entry.failure = {
      name: (e as Error).name,
      code: (e as any)?.cause?.code || null,
    };
    throw new ProviderError("network", "网络失败；无自动网络重试");
  } finally {
    entry.elapsedMs = Date.now() - start;
    save();
  }
};
async function run(name: string, input: unknown, work: () => Promise<any>) {
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  if (
    (only && !name.startsWith(only)) ||
    ledger.cases.some((c) => c.name === name)
  )
    return;
  test = name;
  const start = Date.now(),
    before = ledger.requests.length;
  try {
    const result = await work();
    ledger.cases.push({
      name,
      input,
      calls: ledger.requests.length - before,
      elapsedMs: Date.now() - start,
      ...(result.reply
        ? {
            reply: result.reply,
            sessionId: result.session.id,
            tried: result.session.tried,
            trace: result.trace,
          }
        : { result }),
    });
    console.log(
      JSON.stringify({
        name,
        calls: ledger.requests.length - before,
        outcome: result.reply?.outcome || "returned",
        answer: result.reply?.answer,
        steps: result.reply?.steps?.length,
        questions: result.reply?.questions,
        total: ledger.requests.length,
      }),
    );
  } catch (e) {
    ledger.cases.push({
      name,
      input,
      calls: ledger.requests.length - before,
      error: e instanceof Error ? e.message : "failed",
    });
    console.log(
      JSON.stringify({
        name,
        error: e instanceof ProviderError ? e.code : "validation_failed",
        total: ledger.requests.length,
      }),
    );
  }
  save();
}
try {
  if (!process.argv.includes("--run")) {
    console.log(
      "No model calls. --run --products or --run --ideas consumes only the explicitly authorized current-round ledger (30 total / 6 searches max).",
    );
  } else {
    if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
    const env: Record<string, string | undefined> = {
      ...process.env,
      AI_ALLOW_PAID_CALLS: "true",
      WUJIAN_ALLOW_PAID_CALLS: "true",
      WUJIAN_ALLOW_SEARCH: "true",
      AI_ENABLE_THINKING: "false",
      AI_JSON_MODE: "true",
    };
    if (
      !cloudStatus(env).ready ||
      new URL(env.AI_BASE_URL!).hostname !== "dashscope.aliyuncs.com"
    )
      throw Error("当前北京百炼配置不符；未发送请求");
    process.env.WUJIAN_ALLOW_PUBLIC_FETCH = "true";
    process.env.WUJIAN_ALLOW_SEARCH = "true";
    process.env.LANGSMITH_TRACING = "false";
    process.env.LANGCHAIN_TRACING_V2 = "false";
    console.log(
      JSON.stringify({
        model: env.AI_MODEL,
        used: ledger.requests.length,
        limit: 30,
        searchStrategy: "turbo",
        searchMax: 6,
        searchListedRMBPerRequest: 0.003,
      }),
    );
    const p = createProvider(env, request);
    const maf = t.add(
      "Xiaomi Smart Air Fryer 6.5L",
      "厨房用品",
      "Xiaomi",
      "MAF10",
      { region: "uk" },
    );
    const ikea = t.add("新购书架", "家具", "宜家", "305.976.49", {
      region: "cn",
    });
    const lego = t.add("新购拼搭套装", "玩具", "LEGO", "31136");
    const sony = t.add("WH-CH520 耳机", "电子设备", "Sony", "WH-CH520", {
      supportUrl:
        "https://helpguide.sony.net/mdr/2958/v1/en/contents/TP1000776814.html",
    });
    const unknown = t.add(
      "合成未知电器",
      "电子设备",
      "合成品牌",
      "ZZ-NOT-REAL-2026",
    );
    const light = t.add("手电筒", "电子设备", "合成", "LIGHT", {
      attributes: { quantity: 1, quantityUnit: "件", capabilities: ["照明"] },
    });
    const cup = t.add("透明玻璃杯", "厨房用品", "合成", "CUP", {
      attributes: {
        quantity: 1,
        quantityUnit: "件",
        material: "玻璃",
        capabilities: ["透光", "容纳"],
      },
    });
    const paper = t.add("纸笔套装", "文具", "合成", "PAPER", {
      attributes: {
        quantity: 1,
        quantityUnit: "份",
        capabilities: ["书写", "绘画"],
      },
    });
    const turn = (question: string, itemId?: string, sessionId?: string) =>
      respond(
        t.db,
        t.read,
        "lin",
        {
          requestId: crypto.randomUUID(),
          question,
          itemId,
          sessionId,
          mode: "auto",
          memoryPolicy: "off",
          uiContext: { page: itemId ? "item" : "assistant" },
        },
        p,
      );
    if (group === "products") {
      if(process.argv.includes('--last-product'))await run('U2-complete-cooking-final',{model:'MAF10',goal:'首次完整控制流程；按食谱选参数，不自拟食品时温'},()=>turn('我是第一次使用，能不能带我从准备到完成一次烹饪？',maf));
      if (process.argv.includes("--finish-products")) {
        await run("T1-complete-cooking", { model: "MAF10" }, () =>
          turn("我是第一次使用，能不能带我从准备到完成一次烹饪？", maf),
        );
        const s = ledger.cases.find(
          (c) => c.name === "T1-complete-cooking" && c.reply?.steps?.length,
        )?.sessionId;
        if (s)
          await run(
            "T2-completed-first",
            { question: "我已经做过第一步了，接下来呢？" },
            () => turn("我已经做过第一步了，接下来呢？", maf, s),
          );
        await acquireKnowledge(t.db, t.read, "lin", sony, { force: true });
        await run("T3-direct-source", { model: "WH-CH520" }, () =>
          turn("如何给它充电，怎么判断充完？", sony),
        );
        const newer = t.add("新购创意积木套装", "玩具", "LEGO", "11036");
        await acquireKnowledge(t.db, t.read, "lin", newer, { force: true });
        await run("T4-toy-locator", { model: "11036" }, () =>
          turn("第一次怎么组装，要先准备什么，去哪里看对应的拼搭步骤？", newer),
        );
        await run("T5-unknown-no-retry", { model: "ZZ-NOT-REAL-2026" }, () =>
          turn("第一次怎么用，长按哪个按钮？", unknown),
        );
      }
      if (process.argv.includes("--final-products")) {
        await run(
          "S1-complete-cooking",
          {
            model: "MAF10",
            question: "我是第一次使用，能不能带我从准备到完成一次烹饪？",
          },
          () => turn("我是第一次使用，能不能带我从准备到完成一次烹饪？", maf),
        );
        const s = ledger.cases.find(
          (c) => c.name === "S1-complete-cooking" && c.reply?.steps?.length,
        )?.sessionId;
        if (s)
          await run(
            "S2-continue-first-step",
            { question: "我已经做过第一步了，接下来呢？" },
            () => turn("我已经做过第一步了，接下来呢？", maf, s),
          );
        const newer = t.add("新购创意积木套装", "玩具", "LEGO", "11036");
        await run(
          "S4-new-toy-brand-model",
          {
            model: "11036",
            question: "第一次怎么组装，要先准备什么，去哪里看对应的拼搭步骤？",
          },
          () =>
            turn(
              "第一次怎么组装，要先准备什么，去哪里看对应的拼搭步骤？",
              newer,
            ),
        );
        await run("S5-direct-official-link", { model: "WH-CH520" }, () =>
          turn("如何给它充电，怎么判断充完？", sony),
        );
        await run("S6-unknown-gap", { model: "ZZ-NOT-REAL-2026" }, () =>
          turn("第一次怎么用，长按哪个按钮？", unknown),
        );
      }
      if (process.argv.includes("--repair-products")) {
        await run(
          "R1-complete-cooking",
          {
            model: "MAF10",
            question: "我是第一次使用，能不能带我从准备到完成一次烹饪？",
          },
          () => turn("我是第一次使用，能不能带我从准备到完成一次烹饪？", maf),
        );
        const session = ledger.cases.find(
          (c) => c.name === "R1-complete-cooking" && c.reply?.steps?.length,
        )?.sessionId;
        if (session)
          await run(
            "R2-completed-first-step",
            { question: "我已经做过第一步了，接下来呢？" },
            () => turn("我已经做过第一步了，接下来呢？", maf, session),
          );
        await run(
          "R4-new-category-model-search",
          {
            model: "31136",
            question: "第一次怎么组装，要先准备什么，去哪里看对应的拼搭步骤？",
          },
          () =>
            turn(
              "第一次怎么组装，要先准备什么，去哪里看对应的拼搭步骤？",
              lego,
            ),
        );
        await run("R5-direct-official-link", { model: "WH-CH520" }, () =>
          turn("第一次充电，要怎么准备和连接，怎么判断充完？", sony),
        );
        await run("R6-unknown-gap", { model: "ZZ-NOT-REAL-2026" }, () =>
          turn("第一次怎么用，长按哪个按钮？", unknown),
        );
      }
      await run(
        "P1-complete-cooking",
        {
          model: "MAF10",
          question: "我是第一次使用，能不能带我从准备到完成一次烹饪？",
        },
        () => turn("我是第一次使用，能不能带我从准备到完成一次烹饪？", maf),
      );
      const session = ledger.cases.find(
        (c) => c.name === "P1-complete-cooking",
      )?.sessionId;
      if (session)
        await run(
          "P2-completed-first-step",
          { question: "我已经做过第一步了，接下来呢？" },
          () => turn("我已经做过第一步了，接下来呢？", maf, session),
        );
      await run(
        "P3-furniture-brand-model-only",
        {
          model: "305.976.49",
          question: "新书架第一次使用，如何检查摆放和清洁保养？",
        },
        () => turn("新书架第一次使用，如何检查摆放和清洁保养？", ikea),
      );
      await run(
        "P4-new-category-model-search",
        {
          model: "31136",
          question: "第一次怎么组装，要先准备什么，去哪里看对应的拼搭步骤？",
        },
        () =>
          turn("第一次怎么组装，要先准备什么，去哪里看对应的拼搭步骤？", lego),
      );
      await run(
        "P5-direct-official-link",
        {
          model: "WH-CH520",
          question: "第一次充电，要怎么准备和连接，怎么判断充完？",
        },
        () => turn("第一次充电，要怎么准备和连接，怎么判断充完？", sony),
      );
      await run(
        "P6-unknown-gap",
        { model: "ZZ-NOT-REAL-2026", question: "第一次怎么用，长按哪个按钮？" },
        () => turn("第一次怎么用，长按哪个按钮？", unknown),
      );
      const sources = [maf, ikea, lego, sony].map((id) => ({
        model: t.read().items.find((i) => i.id === id)!.model,
        documents: readKnowledge(t.db, t.read(), "lin", id).map((d) => ({
          title: d.title,
          url: d.url,
          region: d.region,
          hash: d.hash,
          chain: d.chain,
        })),
      }));
      fs.writeFileSync(
        path.join(dir, "sources.json"),
        JSON.stringify(sources, null, 2),
      );
    } else {
      await run(
        "I1-three-directions",
        {
          goal: "只用手电筒、透明玻璃杯和纸笔，半小时不花钱，给我娱乐、生活改善、创作三个真正不同的玩法",
        },
        () =>
          planDiscovery(
            t.db,
            t.read(),
            "lin",
            {
              goal: "只用手电筒、透明玻璃杯和纸笔，半小时不花钱，给我娱乐、生活改善、创作三个真正不同的玩法",
              itemIds: [light, cup, paper],
              model: true,
            },
            p,
            t.read,
          ),
      );
    }
  }
} finally {
  t.db.close();
  process.env.AI_ALLOW_PAID_CALLS = "false";
  process.env.WUJIAN_ALLOW_PAID_CALLS = "false";
  process.env.WUJIAN_ALLOW_SEARCH = "false";
  fs.closeSync(fd);
  fs.unlinkSync(lock);
}
