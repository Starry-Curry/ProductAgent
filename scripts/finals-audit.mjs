// Audit-only harness. No production data, device operations, or implicit paid calls.
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { seed, mutate } from "../src/lib/domain.ts";
import { migrate } from "../src/lib/migrations.ts";
import { migrateLife } from "../src/lib/life/schema.ts";
import { respond } from "../src/lib/agent/service.ts";
import { createProvider, ProviderError } from "../src/lib/ai/provider.ts";
import { cloudStatus } from "../src/lib/life/provider.ts";
import { boundPack } from "../src/lib/ai/harness.ts";
import {
  makeKnowledgeDocument,
  knowledgeIdentity,
} from "../src/lib/life/acquisition.ts";

const root = process.cwd();
const out = path.join(root, ".runtime/audit-20261029");
mkdirSync(out, { recursive: true });
const live = process.argv.includes("--live");
const followup = process.argv.includes("--followup");
const reportPath = path.join(
  out,
  live
    ? followup
      ? "live-followup.json"
      : "live-results.json"
    : "offline-probes.json",
);
const ledgerPath = path.join(out, "paid-ledger.json");
const keyPath = process.argv.find((a) => a.startsWith("--config="))?.slice(9);
if (live && !process.argv.includes("--authorize-paid-max=40"))
  throw Error("Explicit per-task paid authorization argument required");
if (live && keyPath) {
  if (path.basename(keyPath) !== ".env.local")
    throw Error("Only an explicitly selected project .env.local is accepted");
  process.loadEnvFile(path.resolve(keyPath)); // Never print, copy, or serialize this file.
}
const env = {
  ...process.env,
  AUTH_MODE: "local-demo",
  AI_ALLOW_PAID_CALLS: live ? "true" : "false",
  WUJIAN_ALLOW_PAID_CALLS: live ? "true" : "false",
};
for (const [name, value] of Object.entries({
  AUTH_MODE: "local-demo",
  AI_ALLOW_PAID_CALLS: env.AI_ALLOW_PAID_CALLS,
  WUJIAN_ALLOW_PAID_CALLS: env.WUJIAN_ALLOW_PAID_CALLS,
  WUJIAN_ALLOW_PUBLIC_FETCH: "false",
  WUJIAN_ALLOW_SEARCH: "false",
  LANGSMITH_TRACING: "false",
  LANGCHAIN_TRACING_V2: "false",
}))
  process.env[name] = value;
const secrets = [env.AI_API_KEY].filter(Boolean);
const clean = (value) =>
  JSON.parse(
    JSON.stringify(value, (_k, v) =>
      typeof v === "string"
        ? secrets.reduce((s, k) => s.split(k).join("[REDACTED]"), v)
        : v,
    ),
  );
const save = (file, value) =>
  writeFileSync(file, JSON.stringify(clean(value), null, 2) + "\n");
const ledger = existsSync(ledgerPath)
  ? JSON.parse(readFileSync(ledgerPath, "utf8"))
  : [];
let label = "";
async function meteredFetch(url, init) {
  if (!live) throw Error("Offline harness forbids network");
  if (ledger.length >= 40)
    throw new ProviderError("audit_budget", "Audit request cap reached");
  const endpoint = new URL(url);
  if (
    endpoint.origin !== "https://dashscope.aliyuncs.com" ||
    endpoint.pathname !== "/compatible-mode/v1/chat/completions"
  )
    throw new ProviderError(
      "audit_endpoint",
      "Audit only allows the existing Beijing compatible endpoint",
    );
  const body = JSON.parse(init.body);
  const row = {
    number: ledger.length + 1,
    label,
    at: new Date().toISOString(),
    endpoint: endpoint.href,
    model: body.model,
    maxTokens: body.max_tokens,
    thinking: body.enable_thinking,
    jsonMode: body.response_format ?? null,
    tools: body.tools?.map((t) => t.function.name) || [],
    messageChars: body.messages.map((m) => ({
      role: m.role,
      chars: JSON.stringify(m.content).length,
    })),
    toolResults: body.messages
      .filter((m) => m.role === "tool")
      .map((m) => ({ id: m.tool_call_id, content: m.content })),
    status: "reserved-before-dispatch",
  };
  ledger.push(row);
  save(ledgerPath, ledger);
  const started = Date.now();
  try {
    const response = await fetch(url, init);
    row.http = response.status;
    const data = await response
      .clone()
      .json()
      .catch(() => null);
    row.usage = data?.usage ?? null;
    row.response = data?.choices?.[0] ?? null;
    row.upstreamCode = data?.error?.code ?? null;
    row.status = "returned";
    return response;
  } catch (error) {
    row.status = "transport-error";
    row.error = {
      name: error.name,
      code: error.cause?.code || error.code || null,
    };
    throw error;
  } finally {
    row.elapsedMs = Date.now() - started;
    save(ledgerPath, ledger);
  }
}
const config = {
  keyPresent: !!env.AI_API_KEY?.trim(),
  model: env.AI_MODEL || null,
  baseUrl:
    env.AI_BASE_URL === "https://dashscope.aliyuncs.com/compatible-mode/v1"
      ? env.AI_BASE_URL
      : "other-or-missing",
  jsonMode: env.AI_JSON_MODE === "true",
  thinking: env.AI_ENABLE_THINKING === "true",
  timeoutMs: Number(env.AI_REQUEST_TIMEOUT_MS) || 60000,
  status: cloudStatus(env),
};
const report = {
  kind: live
    ? "real-provider-on-synthetic-registered-items"
    : "offline-deterministic-probes",
  fixtureVersion: "care-v2",
  at: new Date().toISOString(),
  baseline: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  config,
  cases: [],
  limitations: [
    "Synthetic registered inventory, not the owner's private data or physical-device verification",
    "Direct and Agent share model, goal and fixture facts; prompts, tools, output schema and budgets differ",
    "Single samples diagnose paths, not statistical quality or framework superiority",
  ],
};
save(reportPath, report);
if (
  live &&
  (!config.keyPresent || !env.AI_MODEL || config.baseUrl === "other-or-missing")
) {
  report.blocked =
    "Missing credential/model or endpoint differs from allowed existing Beijing configuration";
  save(reportPath, report);
  console.log(JSON.stringify({ blocked: report.blocked, config }));
  process.exit(0);
}
function fixture() {
  const directory = mkdtempSync(path.join(out, "fixture-"));
  process.env.PRODUCT_AGENT_DATA_DIR = directory;
  const filename = path.join(directory, "audit.sqlite");
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE workspace(id INTEGER PRIMARY KEY,body TEXT NOT NULL)",
  );
  const state = seed();
  state.items = [];
  state.tasks = [];
  state.memories = [];
  state.gifts = [];
  state.contexts = [];
  state.plans = [];
  function add(name, extra = {}) {
    mutate(state, "lin", "createItem", { name });
    const item = state.items.at(-1);
    Object.assign(item, {
      source: "用户录入",
      state: "在用",
      availability: "available",
      demo: false,
      shared: false,
      ...extra,
    });
    return item;
  }
  const cup = add("无盖不锈钢水杯", {
    brand: "未知",
    model: "未知",
    category: "水杯",
    attributes: {
      material: "不锈钢，单层，无杯盖",
      quantity: 1,
      capabilities: ["容纳常温物品"],
      care: "没有刻度；未确认食品接触与耐热认证",
    },
  });
  add("空白纸质笔记本", {
    category: "纸品",
    attributes: { material: "纸", quantity: 1, capabilities: ["书写记录"] },
  });
  add("黑色圆珠笔", {
    category: "文具",
    attributes: { quantity: 1, capabilities: ["书写"], material: "单色黑色笔" },
  });
  const mouse = add("无线鼠标", {
    brand: "Logitech",
    model: "M-R0061",
    category: "电子设备",
  });
  mutate(state, "lin", "bindProduct", {
    itemId: mouse.id,
    packId: "logitech-m185-m-r0061",
    confirmed: true,
  });
  const box = followup
    ? add("测试收纳盒", {
        brand: "Audit",
        model: "AUDIT-BOX1",
        category: "收纳容器",
      })
    : null;
  db.prepare("INSERT INTO workspace VALUES(1,?)").run(JSON.stringify(state));
  migrate(db, filename);
  migrateLife(db, filename);
  let manual = null;
  if (box) {
    manual = {
      url: "https://example.org/audit-manual",
      title: "Synthetic audit fixture, NOT a fetched manufacturer manual",
      text: "AUDIT-BOX1. Cleaning and maintenance: Wipe with a soft dry cloth. Do not immerse in water.",
      links: [],
    };
    const doc = makeKnowledgeDocument(manual, box, []);
    db.prepare(
      "INSERT INTO life_knowledge_documents(id,owner,item_id,identity,url,hash,body,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      doc.id,
      "lin",
      box.id,
      knowledgeIdentity(box),
      doc.url,
      doc.hash,
      JSON.stringify(doc),
      "active",
      doc.fetchedAt,
    );
  }
  const read = () =>
    JSON.parse(db.prepare("SELECT body FROM workspace WHERE id=1").get().body);
  return { db, read, cup, mouse, box, manual, directory };
}
const f = fixture();
const baseProvider = createProvider(env, meteredFetch);
const direct = createProvider({ ...env, AI_JSON_MODE: "false" }, meteredFetch);
const inventory = f
  .read()
  .items.map((i) => ({
    id: i.id,
    name: i.name,
    brand: i.brand,
    model: i.model,
    category: i.category,
    attributes: i.attributes,
    state: i.state,
    availability: i.availability,
    facts: boundPack(i)?.claims || [],
  }));
const scenarios = followup
  ? [
      {
        id: "creative-normalized",
        question:
          "在家想做一个有趣而稍微意外的新玩法，20分钟内，利用现有物品，不买东西，不用水，不拍照，不加热。给出明确规则和结束成果。",
      },
      {
        id: "grounded-task",
        itemId: f.box.id,
        question: "请依据导入资料，带我清洁这个收纳盒，并说明不能做什么。",
        manual: f.manual,
      },
    ]
  : [
      {
        id: "understanding",
        itemId: f.cup.id,
        question:
          "请解释这只水杯档案已经知道什么、尚不能确定什么。没有刻度能当量杯吗？不要把用户登记当官方认证。",
      },
      {
        id: "creative",
        question:
          "在家想做一个有趣而稍微意外的新玩法，20分钟内，只用我已登记的物品，不买东西，不用水，不拍照，不加热。给出明确规则和结束成果。",
      },
      {
        id: "task",
        itemId: f.mouse.id,
        question:
          "这只无线鼠标电源是什么？能直接插线充电吗？请依据已绑定的资料，不猜实物状态。",
      },
    ];
try {
  for (const s of scenarios) {
    if (live) {
      label = s.id + ":direct";
      const before = ledger.length;
      try {
        const answer = await direct.complete(
          [
            {
              role: "system",
              content:
                "你是一个严谨、有创造力的中文生活助手。基于给定登记和资料回答，区分未知与已知，不虚构持有物品或已执行动作。简洁作答，最多400字。",
            },
            {
              role: "user",
              content: JSON.stringify({
                question: s.question,
                currentItemId: s.itemId,
                inventory,
                manual: s.manual,
              }),
            },
          ],
          [],
          { timeoutMs: 45000, maxTokens: 900 },
        );
        report.cases.push({
          id: s.id,
          path: "direct",
          requests: ledger.length - before,
          result: answer,
        });
      } catch (e) {
        report.cases.push({
          id: s.id,
          path: "direct",
          requests: ledger.length - before,
          error: { code: e.code || "internal", message: e.message },
        });
      }
      save(reportPath, report);
    }
    label = s.id + ":agent";
    const before = ledger.length;
    try {
      const result = await respond(
        f.db,
        f.read,
        "lin",
        {
          requestId: crypto.randomUUID(),
          mode: "auto",
          memoryPolicy: "off",
          itemId: s.itemId,
          question: s.question,
          uiContext: { page: s.itemId ? "item" : "assistant" },
        },
        baseProvider,
      );
      report.cases.push({
        id: s.id,
        path: "agent",
        requests: ledger.length - before,
        result,
      });
    } catch (e) {
      report.cases.push({
        id: s.id,
        path: "agent",
        requests: ledger.length - before,
        error: { code: e.code || "internal", message: e.message },
      });
    }
    save(reportPath, report);
  }
  for (const [id, question] of followup
    ? []
    : [
        [
          "tool",
          "今天很累。请先使用物品清单工具核对我的登记，再挑一件适合我休息时使用的物品，明确说出名称。",
        ],
        ["prepare", "明天要去摄影出游，帮我准备清单，不买新的"],
      ]) {
    label = id + ":agent";
    const before = ledger.length;
    try {
      report.cases.push({
        id,
        path: "agent",
        requests: ledger.length - before,
        result: await respond(
          f.db,
          f.read,
          "lin",
          {
            requestId: crypto.randomUUID(),
            mode: "auto",
            memoryPolicy: "off",
            question,
            uiContext: { page: "assistant" },
          },
          baseProvider,
        ),
      });
      report.cases.at(-1).requests = ledger.length - before;
    } catch (e) {
      report.cases.push({
        id,
        path: "agent",
        error: { code: e.code || "internal", message: e.message },
      });
    }
    save(reportPath, report);
  }
  report.database = {
    integrity: f.db.prepare("PRAGMA integrity_check").get(),
    checkpointRows: f.db
      .prepare("SELECT COUNT(*) AS n FROM graph_checkpoints")
      .get(),
    migrationBackups: "Retained in isolated fixture directory",
  };
} finally {
  f.db.close();
  report.requestsThisRun = ledger.filter((r) => r.at >= report.at).length;
  report.totalRequests = ledger.length;
  report.tokens = ledger.reduce(
    (n, r) => ({
      input: n.input + (r.usage?.prompt_tokens || 0),
      output: n.output + (r.usage?.completion_tokens || 0),
    }),
    { input: 0, output: 0 },
  );
  report.cost = {
    actual: null,
    reason:
      "API usage returns tokens, not the account's billed amount; no billing account accessed",
  };
  save(reportPath, report);
  console.log(
    JSON.stringify(
      {
        reportPath,
        requests: ledger.length,
        cases: report.cases.map((c) => ({
          id: c.id,
          path: c.path,
          requests: c.requests,
          outcome: c.result?.reply?.outcome,
          source: c.result?.reply?.source,
          error: c.error?.code,
          trace: c.result?.trace?.map((t) => ({
            stage: t.stage,
            detail: t.detail,
          })),
        })),
      },
      null,
      2,
    ),
  );
}
