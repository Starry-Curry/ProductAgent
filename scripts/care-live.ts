/** Real-provider scenarios use isolated, synthetic data. No credentials or headers in evidence. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createProvider, ProviderError } from "../src/lib/ai/provider.ts";
import { validationFixture } from "./life-validation-fixture.ts";
import { respond } from "../src/lib/agent/service.ts";
import { acquireKnowledge } from "../src/lib/life/acquisition.ts";
import { mutate } from "../src/lib/domain.ts";

const definition = JSON.parse(
  fs.readFileSync("tests/fixtures/care-real-cases.json", "utf8"),
);
if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const run = process.argv.includes("--run");
const selected = process.argv
  .find((v) => v.startsWith("--cases="))
  ?.slice(8)
  .split(",");
const cases = definition.cases.filter(
  (c: any) => !selected || selected.includes(c.id),
);
if (
  !cases.length ||
  selected?.some((id) => !cases.some((c: any) => c.id === id))
)
  throw Error("Unknown case ID");
const configured = !!process.env.AI_API_KEY?.trim() && !!process.env.AI_MODEL;
if (!run) {
  console.log(
    JSON.stringify(
      {
        mode: "plan-only",
        configured,
        maxRequests: 30,
        scenarios: cases.length,
        turns: cases.reduce((n: number, c: any) => n + c.questions.length, 0),
        cases: cases.map((c: any) => ({ id: c.id, criteria: c.criteria })),
        realRequests: 0,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (!process.argv.includes("--authorized=30"))
  throw Error("Explicit current-task authorization required; no requests sent");
if (!configured) throw Error("API credential not configured; no requests sent");
const base = new URL(process.env.AI_BASE_URL || "https://invalid.invalid");
if (
  base.origin !== "https://dashscope.aliyuncs.com" ||
  base.username ||
  base.password
)
  throw Error(
    "Use the intended Beijing provider configuration; no requests sent",
  );
const directory = path.resolve(".runtime/care-live-20261021");
fs.mkdirSync(directory, { recursive: true });
const file = path.join(directory, "ledger.json");
const ledger: any = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8"))
  : {
      kind: "real-provider-synthetic-fixtures",
      maxRequests: 30,
      requests: [],
      cases: [],
      physicalDeviceTests: 0,
      authorization:
        "Current user asked to connect API and test multiple realistic scenarios; capped at 30 attempted HTTP model requests including retries.",
    };
if (ledger.maxRequests !== 30) throw Error("Unexpected ledger budget");
const lock = path.join(directory, "live.lock");
const fd = fs.openSync(lock, "wx");
const save = () =>
  fs.writeFileSync(file, JSON.stringify(ledger, null, 2), { mode: 0o600 });
const env = {
  ...process.env,
  AI_ALLOW_PAID_CALLS: "true",
  WUJIAN_ALLOW_PAID_CALLS: "true",
  AI_JSON_MODE: "true",
  AI_ENABLE_THINKING: "false",
  AI_REQUEST_TIMEOUT_MS: "60000",
};
Object.assign(process.env, {
  WUJIAN_ALLOW_PUBLIC_FETCH: "true",
  WUJIAN_ALLOW_SEARCH: "false",
  LANGSMITH_TRACING: "false",
  LANGCHAIN_TRACING_V2: "false",
});
let current = "";
const provider = createProvider(env, async (url, init) => {
  if (new URL(String(url)).origin !== base.origin)
    throw new ProviderError("configuration", "Credential forwarding denied");
  if (ledger.requests.length >= 30)
    throw new ProviderError(
      "budget_exhausted",
      "本轮30次请求上限已到，未继续发送",
    );
  const body = JSON.parse(String(init?.body || "{}"));
  const row: any = {
    number: ledger.requests.length + 1,
    case: current,
    at: new Date().toISOString(),
    model: body.model,
    status: "pending",
  };
  ledger.requests.push(row);
  save();
  const started = Date.now();
  try {
    const response = await fetch(url, init);
    const data = await response
      .clone()
      .json()
      .catch(() => null);
    row.status = response.status;
    row.tokens = data?.usage || null;
    // Synthetic evaluation inputs only; raw output stays in the ignored local ledger.
    row.output = data?.choices?.[0]?.message || null;
    row.errorCode = /^[a-z0-9._-]{1,80}$/i.test(data?.error?.code || "")
      ? data.error.code
      : undefined;
    return response;
  } catch (e) {
    row.status = "transport-failed";
    row.errorType = (e as Error).name;
    throw e;
  } finally {
    row.elapsedMs = Date.now() - started;
    save();
    console.log(
      JSON.stringify({
        request: row.number,
        case: current,
        status: row.status,
        elapsedMs: row.elapsedMs,
      }),
    );
  }
});
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
try {
  for (const c of cases) {
    if (ledger.requests.length >= 30) break;
    const t = validationFixture(
      fs.mkdtempSync(path.join(directory, c.id + "-")),
    );
    const attempt =
      ledger.cases.filter((v: any) => v.scenario === c.id).length + 1;
    const result: any = {
      scenario: c.id,
      attempt,
      head,
      at: new Date().toISOString(),
      criteria: c.criteria,
      interfaceMode: c.interfaceMode,
      turns: [],
      evaluation: "pending-human-review",
    };
    ledger.cases.push(result);
    save();
    try {
      let itemId: string | undefined;
      if (c.item) {
        const { name, category, brand, model, packId, ...extra } = c.item;
        itemId = t.add(name, category, brand, model, extra);
        if (packId)
          t.write(
            mutate(t.read(), "lin", "bindProduct", {
              itemId,
              packId,
              confirmed: true,
            }),
          );
        if (c.acquireOfficial) {
          const knowledge = await acquireKnowledge(t.db, t.read, "lin", itemId);
          result.knowledge = {
            acquisition: knowledge.acquisition,
            issues: knowledge.issues,
            documents: knowledge.documents.map((d) => ({
              url: d.url,
              hash: d.hash,
              model: d.model,
              region: d.region,
              chunks: d.chunks,
            })),
          };
        }
      }
      for (const i of c.items || [])
        t.add(i.name, i.category, "", "", { attributes: { quantity: 1 } });
      result.inventory = t.read().items.filter((i) => i.source === "用户录入");
      let sessionId: string | undefined;
      for (const question of c.questions) {
        if (ledger.requests.length >= 30) break;
        current = `${c.id}/${attempt}/${result.turns.length + 1}`;
        const begin = ledger.requests.length,
          started = Date.now();
        const input = {
          requestId: crypto.randomUUID(),
          sessionId,
          itemId,
          question,
          mode: "auto",
          memoryPolicy: "off",
          uiContext: {
            page: itemId ? "item" : "assistant",
            interfaceMode: c.interfaceMode,
          },
        };
        const before = t.read();
        const r = await respond(t.db, t.read, "lin", input, provider);
        result.turns.push({
          question,
          reply: r.reply,
          requestIds: ledger.requests.slice(begin).map((v: any) => v.number),
          modelCalls: r.modelCalls,
          elapsedMs: Date.now() - started,
          trace: r.trace,
          inventoryUnchanged:
            JSON.stringify(before.items) === JSON.stringify(t.read().items),
          tasksUnchanged:
            JSON.stringify(before.tasks) === JSON.stringify(t.read().tasks),
          plansUnchanged:
            JSON.stringify(before.plans) === JSON.stringify(t.read().plans),
        });
        sessionId = r.session.id;
        save();
        console.log(
          JSON.stringify({
            case: current,
            outcome: r.reply.outcome,
            source: r.reply.source,
            errorCode: r.reply.errorCode || null,
            requests: ledger.requests.length - begin,
          }),
        );
        if (
          ["authentication", "permission", "rate_limited"].includes(
            r.reply.errorCode || "",
          )
        )
          throw Error(
            "Provider access failed; stop instead of consuming further requests",
          );
      }
    } catch (e) {
      result.error = {
        type: (e as Error).name,
        message: (e as Error).message
          .replaceAll(process.env.AI_API_KEY!, "[REDACTED]")
          .replace(/sk-[A-Za-z0-9_.-]+/g, "[REDACTED]"),
      };
      throw e;
    } finally {
      t.db.close();
      save();
    }
  }
} finally {
  fs.closeSync(fd);
  fs.unlinkSync(lock);
  console.log(
    JSON.stringify({
      attemptedRequests: ledger.requests.length,
      maxRequests: 30,
      cases: ledger.cases.length,
      evidence: ".runtime/care-live-20261021/ledger.json",
      quality: "requires answer-by-answer review; not an HTTP success count",
      cost: "check provider bill; token usage recorded",
    }),
  );
}
