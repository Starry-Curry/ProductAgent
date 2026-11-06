/** Current user authorization: <=15 real HTTP model requests for this round. No visual/embedding calls. */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createProvider, ProviderError } from "../src/lib/ai/provider.ts";
import { cloudStatus } from "../src/lib/life/provider.ts";
import { validationFixture } from "./life-validation-fixture.ts";
import {
  acquireKnowledge,
  retrieveKnowledge,
} from "../src/lib/life/acquisition.ts";
import { respond } from "../src/lib/agent/service.ts";
import { planDiscovery } from "../src/lib/life/planning.ts";

const directory = path.join(process.cwd(), ".runtime", "intelligence-20261020"),
  ledgerFile = path.join(directory, "model-ledger.json");
mkdirSync(directory, { recursive: true });
type Entry = {
  number: number;
  test: string;
  model: string;
  startedAt: string;
  elapsedMs?: number;
  status?: number | string;
  tokens?: unknown;
  inputSummary?: unknown;
  outputSummary?: string;
  outputPacket?: string;
};
const ledger: { limit: number; requests: Entry[]; cases: any[] } = existsSync(
  ledgerFile,
)
  ? JSON.parse(readFileSync(ledgerFile, "utf8"))
  : { limit: 15, requests: [], cases: [] };
const save = () => writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
const fixture = validationFixture(directory);
const items = {
  maf: fixture.add(
    "Xiaomi Smart Air Fryer 6.5L",
    "厨房用品",
    "Xiaomi",
    "MAF10",
    { region: "uk" },
  ),
  ikea: fixture.add("FÄRJKARL 书架", "家具", "宜家", "305.976.49", {
    region: "cn",
  }),
  sony: fixture.add("WH-CH520 耳机", "电子设备", "Sony", "WH-CH520", {
    supportUrl:
      "https://helpguide.sony.net/mdr/2958/v1/en/contents/TP1000776814.html",
  }),
  unknown: fixture.add(
    "合成未知样机",
    "电子设备",
    "合成未登记品牌",
    "ZZ-UNKNOWN-73",
  ),
  light: fixture.add("低温手电筒", "电子设备", "合成灯具", "SYN-LIGHT", {
    attributes: {
      material: "塑料",
      quantity: 1,
      capabilities: ["普通低温照明"],
    },
  }),
  cup: fixture.add("透明玻璃杯", "厨房用品", "合成杯子", "SYN-CUP", {
    attributes: {
      material: "玻璃",
      quantity: 1,
      capabilities: ["容纳", "透光"],
    },
  }),
  paper: fixture.add("纸笔套装", "文具", "合成文具", "SYN-NOTE", {
    attributes: { material: "纸", quantity: 1, capabilities: ["记录", "书写"] },
  }),
};
let currentCase = "preflight";
const request: typeof fetch = async (url, options) => {
  if (
    currentCase.startsWith("R-") &&
    ledger.requests.some((r) => r.test === currentCase)
  )
    throw new ProviderError(
      "budget_exhausted",
      "本次修复验证仅允许1次请求；未发送重试",
    );
  if (ledger.requests.length >= 15)
    throw new ProviderError(
      "budget_exhausted",
      "本轮15次真实请求额度已达到，本次未发送",
    );
  const body = JSON.parse(String(options?.body || "{}"));
  const entry: Entry = {
    number: ledger.requests.length + 1,
    test: currentCase,
    model: body.model,
    startedAt: new Date().toISOString(),
    inputSummary: {
      test: currentCase,
      roles: body.messages?.map((m: any) => m.role),
      characters: JSON.stringify(body.messages).length,
      tools: body.tools?.map((t: any) => t.function.name),
    },
  };
  ledger.requests.push(entry);
  save();
  const start = Date.now();
  try {
    const response = await fetch(url, options);
    entry.status = response.status;
    const result = await response
      .clone()
      .json()
      .catch(() => null);
    entry.tokens = result?.usage || null;
    entry.outputPacket = result?.choices?.[0]?.message?.content?.slice(
      0,
      12000,
    );
    entry.outputSummary =
      entry.outputPacket?.slice(0, 700) ||
      result?.choices?.[0]?.message?.tool_calls
        ?.map((t: any) => t.function?.name)
        .join(",") ||
      "no text";
    return response;
  } catch {
    entry.status = "network_or_timeout";
    throw new ProviderError("network", "真实请求网络失败；不自动无限重试");
  } finally {
    entry.elapsedMs = Date.now() - start;
    save();
  }
};
async function runCase(name: string, input: unknown, work: () => Promise<any>) {
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  if (only && !name.startsWith(only)) return;
  if (ledger.cases.some((c) => c.name === name)) return;
  currentCase = name;
  const start = Date.now(),
    before = ledger.requests.length;
  try {
    const result = await work();
    const reply = result.reply;
    const summary = reply
      ? {
          outcome: reply.outcome,
          answer: reply.answer,
          steps: reply.steps,
          questions: reply.questions,
          source: reply.source,
          citations: reply.citations,
          trace: result.trace?.map((t: any) => ({
            stage: t.stage,
            detail: t.detail,
          })),
        }
      : result;
    ledger.cases.push({
      name,
      input,
      elapsedMs: Date.now() - start,
      calls: ledger.requests.length - before,
      result: summary,
      sessionId: result.session?.id,
    });
    console.log(
      JSON.stringify({
        name,
        calls: ledger.requests.length - before,
        result: reply?.outcome || "returned",
        answer: reply?.answer?.slice(0, 180),
        steps: reply?.steps?.length,
        questions: reply?.questions,
        totalCalls: ledger.requests.length,
      }),
    );
  } catch (e) {
    ledger.cases.push({
      name,
      input,
      calls: ledger.requests.length - before,
      error:
        e instanceof ProviderError
          ? e.code
          : e instanceof Error
            ? e.message
            : "failed",
    });
    console.log(
      JSON.stringify({
        name,
        error: "validation_or_request_failed",
        totalCalls: ledger.requests.length,
      }),
    );
  }
  save();
}
try {
  if (process.argv.includes("--probe")) {
    for (const key of ["maf", "ikea", "sony"] as const) {
      const result = await acquireKnowledge(
        fixture.db,
        fixture.read,
        "lin",
        items[key],
        { force: true },
      );
      console.log(
        JSON.stringify({
          key,
          documents: result.documents.length,
          issues: result.issues,
          chunks: retrieveKnowledge(
            fixture.db,
            fixture.read(),
            "lin",
            items[key],
            key === "sony" ? "如何充电" : "第一次怎么用",
          )
            .map((c) => ({
              id: c.id,
              category: c.category,
              length: c.text.length,
            }))
            .slice(0, 5),
        }),
      );
    }
  } else if (process.argv.includes("--run")) {
    const config = path.join(process.cwd(), ".env.local");
    if (existsSync(config)) process.loadEnvFile(config);
    const env: Record<string, string | undefined> = {
      ...process.env,
      AI_ALLOW_PAID_CALLS: "true",
      WUJIAN_ALLOW_PAID_CALLS: "true",
      AI_ENABLE_THINKING: "false",
      AI_JSON_MODE: "true",
    };
    const status = cloudStatus(env),
      endpoint = env.AI_BASE_URL ? new URL(env.AI_BASE_URL) : null;
    console.log(
      JSON.stringify({
        preflight: status.state,
        defaultConfiguredState: cloudStatus(process.env).state,
        currentTaskLimit: 15,
        model: env.AI_MODEL,
        endpoint: endpoint?.origin,
        remaining: 15 - ledger.requests.length,
      }),
    );
    if (!status.ready || endpoint?.hostname !== "dashscope.aliyuncs.com")
      throw Error("当前项目北京百炼配置不齐备；没有发出模型请求");
    process.env.LANGSMITH_TRACING = "false";
    process.env.LANGCHAIN_TRACING_V2 = "false";
    process.env.WUJIAN_ALLOW_PUBLIC_FETCH = "true";
    const provider = createProvider(env, request);
    const turn = (question: string, itemId?: string, sessionId?: string) =>
      respond(
        fixture.db,
        fixture.read,
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
        provider,
      );
    if (process.argv.includes("--repair-sony")) {
      await runCase(
        "R-Sony-grounding",
        { question: "如何给这件耳机充电？", model: "WH-CH520" },
        () => turn("如何给这件耳机充电？", items.sony),
      );
    }
    if (process.argv.includes("--final-cases")) {
      await runCase(
        "R-unknown-gap",
        {
          question: "这个型号第一次怎么用，长按哪个键？",
          model: "ZZ-UNKNOWN-73",
        },
        () => turn("这个型号第一次怎么用，长按哪个键？", items.unknown),
      );
      await runCase(
        "R-unified-plan",
        {
          goal: "我有半小时，不想花钱，只用手电筒、透明玻璃杯和纸笔，帮我设计一个有趣的活动",
        },
        () =>
          turn(
            "我有半小时，不想花钱，只用手电筒、透明玻璃杯和纸笔，帮我设计一个有趣的活动",
          ),
      );
      const session = ledger.cases.find(
        (c) => c.name === "R-unified-plan",
      )?.sessionId;
      if (session)
        await runCase(
          "R-unified-followup",
          { goal: "不用玻璃杯，缩短到10分钟，换个更简单的方向" },
          () =>
            turn(
              "不用玻璃杯，缩短到10分钟，换个更简单的方向",
              undefined,
              session,
            ),
        );
    }
    if (process.argv.includes("--final-followup")) {
      const first = ledger.cases.find(
        (c) => c.name === "D-open-combination",
      )?.result;
      if (first?.continuation)
        await runCase(
          "R-discovery-to-unified-followup",
          {
            goal: "不用玻璃杯，缩短到10分钟，换个更简单的方向",
            transfer: "previous owned discovery plan",
          },
          () =>
            respond(
              fixture.db,
              fixture.read,
              "lin",
              {
                requestId: crypto.randomUUID(),
                mode: "auto",
                question: "不用玻璃杯，缩短到10分钟，换个更简单的方向",
                memoryPolicy: "off",
                uiContext: {
                  page: "discover",
                  goal: first.continuation.goal,
                  planContext: {
                    previousIdeaIds: first.ideas.map((i: any) => i.id),
                    continuation: first.continuation,
                  },
                },
              },
              provider,
            ),
        );
    }
    await runCase(
      "A-MAF10-first-use",
      { question: "第一次怎么用？", model: "MAF10", region: "uk" },
      () => turn("第一次怎么用？", items.maf),
    );
    await runCase(
      "B-new-IKEA-model",
      { question: "怎么清洁保养这件书架？", model: "305.976.49", region: "cn" },
      () => turn("怎么清洁保养这件书架？", items.ikea),
    );
    await runCase(
      "B-new-Sony-model",
      {
        question: "如何给这件耳机充电？",
        model: "WH-CH520",
        sourceHint: "official user provided URL",
      },
      () => turn("如何给这件耳机充电？", items.sony),
    );
    await runCase(
      "C-unknown-model",
      {
        question: "这个型号第一次怎么用，长按哪个键？",
        model: "ZZ-UNKNOWN-73",
      },
      () => turn("这个型号第一次怎么用，长按哪个键？", items.unknown),
    );
    await runCase(
      "D-open-combination",
      {
        goal: "我有半小时，不想花钱，用手电筒、透明玻璃杯和纸笔，设计一个有趣的观察活动",
      },
      () =>
        planDiscovery(
          fixture.db,
          fixture.read(),
          "lin",
          {
            goal: "我有半小时，不想花钱，用手电筒、透明玻璃杯和纸笔，设计一个有趣的观察活动",
            itemIds: [items.light, items.cup, items.paper],
            model: true,
          },
          provider,
          fixture.read,
        ),
    );
    const first = ledger.cases.find(
      (c) => c.name === "D-open-combination",
    )?.result;
    if (first?.ideas?.length)
      await runCase(
        "E-change-constraints",
        { goal: "不用玻璃杯，缩短到10分钟，换一种更有趣的方式" },
        () =>
          planDiscovery(
            fixture.db,
            fixture.read(),
            "lin",
            {
              goal: "不用玻璃杯，缩短到10分钟，换一种更有趣的方式",
              previousIdeaIds: first.ideas.map((i: any) => i.id),
              continuation: first.continuation,
              model: true,
            },
            provider,
            fixture.read,
          ),
      );
    await runCase(
      "F-natural-chat",
      { question: "今天工作有点累，不想解决什么问题，就想随便聊聊。" },
      () => turn("今天工作有点累，不想解决什么问题，就想随便聊聊。"),
    );
  } else
    console.log(
      "Use --probe for public source retrieval only; --run consumes the current round's explicitly authorized <=15 HTTP model requests. Ledger persists and prevents accidental reruns.",
    );
} finally {
  fixture.db.close();
  process.env.AI_ALLOW_PAID_CALLS = "false";
  process.env.WUJIAN_ALLOW_PAID_CALLS = "false";
}
