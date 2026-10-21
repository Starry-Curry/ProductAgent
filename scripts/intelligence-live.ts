/** Current-task authorized real Qwen acceptance. Synthetic fixtures only; historical ledgers untouched. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createProvider } from "../src/lib/ai/provider.ts";
import { validationFixture } from "./life-validation-fixture.ts";
import { respond } from "../src/lib/agent/service.ts";
import { planDiscovery } from "../src/lib/life/planning.ts";
import {
  acquireKnowledge,
  readKnowledge,
} from "../src/lib/life/acquisition.ts";
import { saveFragment } from "../src/lib/life/stories.ts";
import { organizeStories } from "../src/lib/life/organization.ts";
import { savePersona } from "../src/lib/memory/store.ts";
import { feedbackIdea } from "../src/lib/life/ideas.ts";
const group =
  process.argv.find((a) => a.startsWith("--group="))?.slice(8) || "config";
const run = process.argv.includes("--run");
if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const env: Record<string, string | undefined> = {
  ...process.env,
  AI_MODEL: process.env.INTELLIGENCE_MODEL || process.env.AI_MODEL,
  AI_ALLOW_PAID_CALLS: run ? "true" : "false",
  WUJIAN_ALLOW_PAID_CALLS: run ? "true" : "false",
  AI_ENABLE_THINKING: "false",
  AI_JSON_MODE: "true",
  AI_REQUEST_TIMEOUT_MS: "90000",
  WUJIAN_ALLOW_SEARCH: "false",
  AUTH_MODE: "local-demo",
};
console.log(
  JSON.stringify({
    group,
    authorized: run,
    keyPresent: !!env.AI_API_KEY?.trim(),
    model: env.AI_MODEL,
    endpoint: env.AI_BASE_URL ? new URL(env.AI_BASE_URL).origin : null,
    search: false,
  }),
);
if (!run || group === "config") process.exit(0);
if (
  !env.AI_API_KEY?.trim() ||
  new URL(env.AI_BASE_URL || "https://invalid.invalid").origin !==
    "https://dashscope.aliyuncs.com"
)
  throw Error(
    "Current-project Beijing configuration incomplete; no request sent",
  );
process.env.WUJIAN_ALLOW_PUBLIC_FETCH = "true";
process.env.WUJIAN_ALLOW_SEARCH = "false";
const directory = path.resolve(".runtime/intelligence-20261021");
fs.mkdirSync(directory, { recursive: true });
const ledgerPath = path.join(directory, "ledger.json");
const ledger: any = fs.existsSync(ledgerPath)
  ? JSON.parse(fs.readFileSync(ledgerPath, "utf8"))
  : {
      authorization:
        "Current final intelligent capability task: necessary real Qwen requests, synthetic data only; no fixed cap",
      baseline: "d9a343f",
      requests: [],
      cases: [],
    };
const save = () =>
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
const lock = path.join(directory, "live.lock");
const handle = fs.openSync(lock, "wx");
let currentCase = "";
const provider = createProvider(env, async (url, init) => {
  if (new URL(String(url)).hostname !== "dashscope.aliyuncs.com")
    throw Error("Credential forwarding denied");
  const body = JSON.parse(String(init?.body));
  const record: any = {
    id: ledger.requests.length + 1,
    case: currentCase,
    at: new Date().toISOString(),
    model: body.model,
    input: body.messages,
    maxTokens: body.max_tokens,
    status: "pending",
  };
  ledger.requests.push(record);
  save();
  const start = Date.now();
  try {
    const r = await fetch(url, init);
    const d = await r
      .clone()
      .json()
      .catch(() => null);
    record.status = r.status;
    record.usage = d?.usage;
    record.output = d?.choices?.[0]?.message;
    record.errorCode = d?.error?.code;
    record.estimatedCny =
      body.model === "qwen-plus" && d?.usage?.prompt_tokens <= 128000
        ? (d.usage.prompt_tokens * 0.8 + d.usage.completion_tokens * 2) / 1e6
        : null;
    return r;
  } catch (e) {
    record.status = "transport-failed";
    record.errorType = (e as Error).name;
    throw e;
  } finally {
    record.elapsedMs = Date.now() - start;
    save();
    console.log(
      JSON.stringify({
        request: record.id,
        case: currentCase,
        status: record.status,
        ms: record.elapsedMs,
      }),
    );
  }
});
async function record(
  name: string,
  input: unknown,
  fn: () => Promise<unknown>,
) {
  currentCase = name;
  const start = Date.now(),
    begin = ledger.requests.length;
  const c: any = {
    id: ledger.cases.length + 1,
    name,
    input,
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    at: new Date().toISOString(),
    quality: "pending-independent-review",
  };
  ledger.cases.push(c);
  save();
  try {
    c.result = await fn();
  } catch (e) {
    c.error = { message: (e as Error).message, code: (e as any).code };
  } finally {
    c.elapsedMs = Date.now() - start;
    c.requestIds = ledger.requests.slice(begin).map((r: any) => r.id);
    save();
    console.log(
      JSON.stringify({
        case: name,
        requests: c.requestIds.length,
        ms: c.elapsedMs,
        error: c.error?.code || c.error?.message || null,
      }),
    );
  }
  return c.result as any;
}
const products: any = {
  maf: {
    name: "Xiaomi Smart Air Fryer 6.5L",
    category: "厨房电器",
    brand: "Xiaomi",
    model: "MAF10",
    region: "uk",
    question: "我是第一次使用，能不能带我从准备到完成一次烹饪？",
    follow: "第一步已经完成，下一步呢？还没决定食材和份量。",
  },
  ikea: {
    name: "IKEA LACK",
    category: "家具",
    brand: "IKEA",
    model: "404.498.99",
    region: "cn",
    question: "第一次给这件家具做清洁维护，从准备到结束带我做一次。",
    follow: "第一步已经完成，接下来怎么继续？",
  },
  sony: {
    name: "Sony WH-CH720N",
    category: "电子设备",
    brand: "Sony",
    model: "WH-CH720N",
    url: "https://helpguide.sony.net/mdr/2966/v1/en/print.pdf",
    question: "第一次充电，从准备到充完带我做一次。",
    follow: "第一步已经完成，接着呢？",
  },
  textile: {
    name: "IKEA GURLI cushion cover",
    category: "家用纺织品",
    brand: "IKEA",
    model: "905.987.78",
    region: "cn",
    question: "第一次清洗这个垫套，带我从准备到清洗结束，哪些步骤有官方依据？",
    follow: "第一步已经完成，接下来怎么继续？",
  },
  holdout: {
    name: "IKEA VITMOSSA throw",
    category: "家用纺织品",
    brand: "IKEA",
    model: "703.048.90",
    region: "cn",
    question: "第一次清洗这条休闲毯，带我从准备到清洗结束。",
    follow: "第一步已经完成，接下来继续。",
  },
  clothing: {
    name: "Patagonia R1 Fleece Pants",
    category: "服装",
    brand: "Patagonia",
    model: "82157",
    url: "https://www.patagonia.com/product/mens-r1-fleece-pants/82157.html",
    question: "第一次清洗这条裤子，从准备到洗好晾干应该怎么做？",
    follow: "第一步完成了，后面怎么洗和干燥？",
  },
  unknown: {
    name: "未知测试设备",
    category: "电子设备",
    brand: "NoSuchBrand",
    model: "NOT-REAL-85921",
    question: "第一次怎么用？",
    follow: "我已经做过第一步了，继续。",
  },
  region: {
    name: "Xiaomi Smart Air Fryer 6.5L",
    category: "厨房电器",
    brand: "Xiaomi",
    model: "MAF10",
    region: "cn",
    question: "第一次如何使用？",
    follow: "我已经完成第一步，接下来呢？",
  },
};
try {
  if (group.startsWith("product-")) {
    const key = group.slice(8),
      p = products[key];
    if (!p) throw Error("Unknown product case");
    const reuse = process.argv.includes("--reuse-latest")
      ? fs
          .readdirSync(directory)
          .filter(
            (n) =>
              n.startsWith(group + "-") &&
              fs.statSync(path.join(directory, n)).isDirectory(),
          )
          .sort(
            (a, b) =>
              fs.statSync(path.join(directory, b)).birthtimeMs -
              fs.statSync(path.join(directory, a)).birthtimeMs,
          )[0]
      : undefined;
    const t = validationFixture(
      reuse
        ? path.join(directory, reuse)
        : fs.mkdtempSync(path.join(directory, group + "-")),
    );
    try {
      const id = t.add(p.name, p.category, p.brand, p.model, {
        region: p.region || "",
        supportUrl: p.url || "",
      });
      await record(group + "-source", p, async () => {
        const r = await acquireKnowledge(t.db, t.read, "lin", id);
        return {
          acquisition: r.acquisition,
          issues: r.issues,
          cached: r.cached,
          documents: r.documents.map((d) => ({
            url: d.url,
            hash: d.hash,
            model: d.model,
            region: d.region,
            chunks: d.chunks.length,
          })),
        };
      });
      let sessionId: string | undefined;
      for (const [turn, q] of [
        ["first", p.question],
        ["continue", p.follow],
      ]) {
        const input = {
          requestId: crypto.randomUUID(),
          sessionId,
          itemId: id,
          question: q,
          mode: "auto",
          memoryPolicy: "off",
          uiContext: { page: "item" },
        };
        const r = await record(
          group + "-" + turn,
          {
            ...p,
            question: q,
            inventory: [t.read().items.find((i) => i.id === id)],
          },
          () => respond(t.db, t.read, "lin", input, provider),
        );
        if (r) sessionId = r.session.id;
        if (turn === "continue" && r)
          await record(group + "-replay-same-request", input, () =>
            respond(t.db, t.read, "lin", input, provider),
          );
      }
    } finally {
      t.db.close();
    }
  } else {
    const fixtures: any = JSON.parse(
      fs.readFileSync("tests/fixtures/intelligence-goals.json", "utf8"),
    );
    const selected =
      group === "creative"
        ? fixtures.development
        : group === "holdout"
          ? fixtures.holdout
          : group === "personal"
            ? fixtures.personal
            : fixtures.development.filter((x: any) => x.id === group);
    for (const sample of selected) {
      const t = validationFixture(
        fs.mkdtempSync(path.join(directory, sample.id + "-")),
      );
      try {
        const ids = sample.items.map((i: any) =>
          t.add(i.name, i.category, "", "", {
            attributes: { quantity: 1, ...i.attributes },
          }),
        );
        const input = {
          goal: sample.goal,
          itemIds: ids,
          minutes: sample.minutes || 20,
          model: true,
          candidates: sample.candidates || 2,
          publicEvidence: false,
          review: false,
        };
        const inventory = t.read().items.filter((i) => ids.includes(i.id));
        const baseline = await record(
          sample.id + "-base",
          { ...sample, inventory },
          () => planDiscovery(t.db, t.read(), "lin", input, provider, t.read),
        );
        if (sample.preference) {
          const f = saveFragment(t.db, t.read, "lin", {
            text: sample.preference,
            itemIds: [],
            allowRecall: true,
            allowCloud: true,
          });
          let org = organizeStories(t.db, t.read, "lin", {
            command: "extract",
          });
          const candidate = org.understanding.find((u) =>
            u.evidence.some((e) => e.id === f.id),
          )!;
          if (!candidate)
            throw Error("Explicit synthetic preference was not extracted");
          org = organizeStories(t.db, t.read, "lin", {
            command: "confirm",
            id: candidate.id,
            text: sample.preference,
            scope: sample.scope,
            allowCloud: true,
          });
          const confirmed = org.understanding.find(
            (u) => u.id === candidate.id,
          )!;
          const personalized = await record(
            sample.id + "-personal",
            { ...sample, inventory, confirmedContext: sample.preference },
            () => planDiscovery(t.db, t.read(), "lin", input, provider, t.read),
          );
          organizeStories(t.db, t.read, "lin", {
            command: "forget",
            id: confirmed.id,
          });
          await record(
            sample.id + "-revoked",
            { ...sample, inventory, revoked: true },
            () =>
              planDiscovery(
                t.db,
                t.read(),
                "lin",
                { ...input, candidates: 1 },
                provider,
                t.read,
              ),
          );
        } else if (sample.followup && baseline?.ideas?.length) {
          feedbackIdea(t.db, t.read(), "lin", {
            id: baseline.ideas[0].id,
            saved: true,
            outcome: "未成功",
            note: "合成反馈：这轮想换一种方式",
          });
          await record(
            sample.id + "-continue",
            { ...sample, inventory, goal: sample.followup },
            () =>
              planDiscovery(
                t.db,
                t.read(),
                "lin",
                {
                  ...input,
                  goal: sample.followup,
                  continuation: baseline.continuation,
                  previousIdeaIds: baseline.ideas.map((i: any) => i.id),
                },
                provider,
                t.read,
              ),
          );
        }
      } finally {
        t.db.close();
      }
    }
  }
} finally {
  fs.closeSync(handle);
  fs.unlinkSync(lock);
}
