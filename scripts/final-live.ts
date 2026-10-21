/** Explicit 2026-10-21 sprint authorization. Synthetic inputs only; no historical request cap. */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createProvider } from "../src/lib/ai/provider.ts";
import { validationFixture } from "./life-validation-fixture.ts";
import { respond } from "../src/lib/agent/service.ts";
import { planDiscovery } from "../src/lib/life/planning.ts";
import { acquireKnowledge } from "../src/lib/life/acquisition.ts";
import { mutate } from "../src/lib/domain.ts";
import { storePhoto } from "../src/lib/life/media.ts";
import { matchStoryPhoto } from "../src/lib/life/story-photo.ts";
import { saveFragment, listFragments } from "../src/lib/life/stories.ts";
import {
  suggestStoryOrganization,
  organizeStories,
} from "../src/lib/life/organization.ts";
import { savePersona } from "../src/lib/memory/store.ts";
export const directory = path.join(process.cwd(), ".runtime", "final-20261021");
fs.mkdirSync(directory, { recursive: true });
const file = path.join(directory, "ledger.json");
export const ledger: any = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8"))
  : {
      authorization:
        "2026-10-21 final sprint; no fixed call cap; synthetic inputs only",
      requests: [],
      cases: [],
    };
const save = () => fs.writeFileSync(file, JSON.stringify(ledger, null, 2));
const caseName =
  process.argv.find((a) => a.startsWith("--case="))?.slice(7) || "basic";
if (!process.argv.includes("--run")) {
  console.log(JSON.stringify({ requests: ledger.requests.length, sent: 0 }));
  process.exit(0);
}
if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
export const env: Record<string, string | undefined> = {
  ...process.env,
  AI_MODEL: process.env.FINAL_TEXT_MODEL || process.env.AI_MODEL,
  AUTH_MODE: "local-demo",
  AI_ALLOW_PAID_CALLS: "true",
  WUJIAN_ALLOW_PAID_CALLS: "true",
  AI_ENABLE_THINKING: "false",
  AI_REQUEST_TIMEOUT_MS: "90000",
  AI_JSON_MODE: "true",
  WUJIAN_ALLOW_SEARCH: "false",
  AI_VISION_MODEL: process.env.AI_VISION_MODEL || "qwen3-vl-plus",
};
if (
  !env.AI_API_KEY?.trim() ||
  new URL(env.AI_BASE_URL || "https://invalid.invalid").origin !==
    "https://dashscope.aliyuncs.com" ||
  !env.AI_MODEL
)
  throw Error(
    "Current project Beijing key/endpoint/model configuration incomplete; no request sent",
  );
// Process-only authorization: no .env changes and no interaction with the user's 3200 service.
Object.assign(process.env, {
  WUJIAN_ALLOW_PUBLIC_FETCH: "true",
  WUJIAN_ALLOW_SEARCH: "false",
});
console.log(
  JSON.stringify({
    case: caseName,
    keyPresent: true,
    model: env.AI_MODEL,
    visionModel: env.AI_VISION_MODEL,
    endpoint: new URL(env.AI_BASE_URL!).origin,
  }),
);
export const trackedFetch: typeof fetch = async (url, init) => {
  if (new URL(String(url)).hostname !== "dashscope.aliyuncs.com")
    throw Error("Credential forwarding denied");
  const body = JSON.parse(String(init?.body)),
    vision = JSON.stringify(body.messages || body.input || []).includes(
      '"image_url"',
    );
  const entry: any = {
    number: ledger.requests.length + 1,
    case: caseName,
    model: body.model,
    vision,
    toolDefinitions: body.tools?.length || 0,
    at: new Date().toISOString(),
    inputCharacters: JSON.stringify(body.messages || body.input).length,
  };
  try {
    const data = JSON.parse(
      body.messages?.find((m: any) => m.role === "user")?.content || "{}",
    );
    entry.inputSummary = {
      question: data.question,
      goal: data.goal,
      personalContext: data.preferences || data.memories || [],
      completedSteps: data.completedSteps,
    };
  } catch {}
  ledger.requests.push(entry);
  save();
  const started = Date.now();
  try {
    const r = await fetch(url, init);
    const d = await r
      .clone()
      .json()
      .catch(() => null);
    entry.status = r.status;
    entry.usage = d?.usage;
    entry.output = d?.choices?.[0]?.message || d?.output;
    entry.errorCode = d?.error?.code || d?.code;
    // Public price estimate, Beijing <=32K, no cache discount; not an actual account bill.
    const rates =
      vision && body.model === "qwen3-vl-plus"
        ? [1, 10]
        : body.model === "qwen-plus"
          ? [0.8, 2]
          : null;
    entry.estimatedCny =
      rates && d?.usage
        ? ((d.usage.prompt_tokens ?? d.usage.input_tokens) * rates[0] +
            (d.usage.completion_tokens ?? d.usage.output_tokens) * rates[1]) /
          1e6
        : null;
    return r;
  } catch (e) {
    entry.status = "transport-failed";
    entry.errorType = (e as Error).name;
    entry.causeCode = (e as any).cause?.code;
    throw e;
  } finally {
    entry.elapsedMs = Date.now() - started;
    save();
    console.log(
      JSON.stringify({
        request: entry.number,
        status: entry.status,
        ms: entry.elapsedMs,
        tokens: entry.usage,
      }),
    );
  }
};
export const provider = createProvider(env, trackedFetch);
const lock = path.join(directory, "live.lock");
const fd = fs.openSync(lock, "wx");
const t = validationFixture(
  process.argv.includes("--fresh") ? path.join(directory, caseName) : directory,
);
export async function record(name: string, fn: () => Promise<any>) {
  const begin = ledger.requests.length;
  const started = Date.now();
  try {
    const result = await fn();
    ledger.cases.push({
      name,
      result,
      requests: ledger.requests.length - begin,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    ledger.cases.push({
      name,
      error: (e as Error).message,
      code: (e as any).code,
      requests: ledger.requests.length - begin,
      elapsedMs: Date.now() - started,
    });
  }
  save();
  console.log(
    JSON.stringify({
      case: name,
      recorded: true,
      error: ledger.cases.at(-1).error || null,
    }),
  );
}
try {
  if (caseName === "basic") {
    const plain = createProvider(
      { ...env, AI_JSON_MODE: "false" },
      trackedFetch,
    );
    await record("plain", () =>
      plain.generate(
        "自然交流，简短回答，不关联物品。",
        "今天工作有点累，想休息一会儿。",
      ),
    );
    await record("json", () =>
      provider.generate(
        "输出JSON {answer:string}，回答用户的问题。",
        "怎么在十分钟内开始整理桌面？不需要商品参数。",
      ),
    );
    await record("tools", async () => {
      const tools: any = [
        {
          type: "function",
          function: {
            name: "lookup_owned",
            description: "读取已登记测试物品，必须先调用再回答",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ];
      const messages: any = [
        {
          role: "system",
          content: "需要知道用户已有物品时先调用lookup_owned，不能猜测。",
        },
        { role: "user", content: "我登记了哪些东西？" },
      ];
      const first = await provider.complete!(messages, tools, {
        timeoutMs: 90000,
      });
      if (!first.toolCalls.length)
        throw Error("Model did not call the requested read tool");
      messages.push({
        role: "assistant",
        content: first.text || null,
        tool_calls: first.toolCalls,
      });
      for (const call of first.toolCalls)
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ items: ["测试透明杯", "测试纸笔"] }),
        });
      return {
        first,
        final: await provider.complete!(messages, [], { timeoutMs: 90000 }),
      };
    });
    await record("vision-basic", async () => {
      const image = await sharp({
        create: { width: 900, height: 450, channels: 3, background: "#f3efe8" },
      })
        .composite([
          {
            input: await sharp("public/demo/life/mouse.jpg")
              .resize(430, 410, { fit: "contain", background: "#fff" })
              .toBuffer(),
            left: 10,
            top: 20,
          },
          {
            input: await sharp("public/demo/life/camera.jpg")
              .resize(430, 410, { fit: "contain", background: "#fff" })
              .toBuffer(),
            left: 460,
            top: 20,
          },
        ])
        .jpeg()
        .toBuffer();
      fs.writeFileSync(path.join(directory, "two-objects.jpg"), image);
      return createProvider(
        { ...env, AI_MODEL: env.AI_VISION_MODEL },
        trackedFetch,
      ).recognize!(
        "只描述实际可见物品，输出JSON {candidates:[{name,uncertainties}]}。不猜人物身份或型号。",
        `data:image/jpeg;base64,${image.toString("base64")}`,
      );
    });
  } else if (caseName === "search") {
    const search = createProvider(
      { ...env, WUJIAN_ALLOW_SEARCH: "true" },
      trackedFetch,
    );
    await record("native-official-search", () =>
      search.search!("Patagonia R1 Air 40255 care washing official", [
        "patagonia.com",
      ]),
    );
  } else if (caseName === "vision") {
    const mouse = t.add("我的无线鼠标", "电子设备", "", "");
    const camera = t.add("旅行相机", "电子设备", "", "");
    t.add("备用相机", "电子设备", "", "");
    const p = createProvider(
      { ...env, AI_MODEL: env.AI_VISION_MODEL },
      trackedFetch,
    );
    const image = await storePhoto(
      t.db,
      "lin",
      fs.readFileSync(path.join(directory, "two-objects.jpg")),
    );
    await record("vision-owned-two", async () => {
      const r = await matchStoryPhoto(
        t.db,
        t.read,
        "lin",
        { mediaId: image.id, confirmed: true },
        env,
        p,
      );
      const ids = new Set(
        r.matches.flatMap((m) => m.candidates.map((c) => c.itemId)),
      );
      if (!ids.has(mouse) || !ids.has(camera))
        throw Error(
          "Real vision failed to propose registered mouse/camera; inspect ledger observations",
        );
      const event = saveFragment(t.db, t.read, "lin", {
        text: "合成验收：整理旅行相机和鼠标。照片为公开示意照片拼图，并非本人真实经历。",
        itemIds: [mouse, camera],
        mediaIds: [image.id],
        allowRecall: false,
        allowCloud: false,
      });
      return {
        observations: r,
        userConfirmedItemIds: [mouse, camera],
        saved: event,
        fromBothItems: listFragments(t.db, t.read(), "lin").filter(
          (f) => f.id === event.id,
        ),
      };
    });
    const unknown = await storePhoto(
      t.db,
      "lin",
      fs.readFileSync("public/demo/life/plant.jpg"),
    );
    await record("vision-unknown", () =>
      matchStoryPhoto(
        t.db,
        t.read,
        "lin",
        { mediaId: unknown.id, confirmed: true },
        env,
        p,
      ),
    );
  } else if (caseName.startsWith("understanding")) {
    t.add("旅行相机", "电子设备", "", "", {
      attributes: { capabilities: ["拍照"], quantity: 1 },
    });
    t.add("轻便背包", "服装", "", "", {
      attributes: { capabilities: ["携带"], material: "布", quantity: 1 },
    });
    t.add("纸笔", "文具", "", "", {
      attributes: { capabilities: ["书写"], quantity: 1 },
    });
    t.add("玻璃杯", "厨房用品", "", "", {
      attributes: { capabilities: ["容纳"], material: "玻璃", quantity: 1 },
    });
    const photoEvents = [
      "周末沿河拍下桥面的灯光。我喜欢轻装旅行，喜欢拍建筑细节，不喜欢行程太满。",
      "再次背着相机沿河拍桥，专门观察石拱的形状。",
      "周末在旧街拍下门窗细节，没有安排太多景点。",
    ];
    for (let i = 0; i < 30; i++)
      saveFragment(t.db, t.read, "lin", {
        text:
          i < 3
            ? photoEvents[i]
            : i < 10
              ? `合成事件${i}：在厨房准备不同的午餐，记录食材用量。`
              : `合成事件${i}：在家整理书架，归还一本书。`,
        capturedOn: `2026-09-${String(i + 1).padStart(2, "0")}`,
        itemIds: [],
        allowRecall: true,
        allowCloud: true,
      });
    const events = listFragments(t.db, t.read(), "lin")
      .filter((f) => f.allowCloud && f.allowRecall)
      .slice(0, 30);
    await record(caseName + "-semantic-30-events", () =>
      suggestStoryOrganization(
        t.db,
        t.read,
        "lin",
        { confirmed: true, fragmentIds: events.map((f) => f.id) },
        provider,
      ),
    );
    const result = ledger.cases.at(-1).result;
    for (const c of result?.chapterSuggestions || [])
      if (
        c.fragmentIds.every((id: string) =>
          events.find((f) => f.id === id)?.text.includes("拍"),
        )
      )
        organizeStories(t.db, t.read, "lin", {
          command: "chapter",
          id: c.id,
          revision: c.revision,
          name: c.name,
          fragmentIds: c.fragmentIds,
        });
    const goal =
      "我想半小时内准备一次城市出游，不买东西，请用现有物品安排一种有趣的活动。";
    const plan = () =>
      planDiscovery(
        t.db,
        t.read(),
        "lin",
        {
          goal,
          model: true,
          publicEvidence: false,
          candidates: 1,
          minutes: 30,
        },
        provider,
        t.read,
      );
    savePersona(t.db, t.read(), "lin", {
      enabled: false,
      nickname: "",
      style: "neutral",
      memoryUse: "off",
    });
    await record(caseName + "-personalization-without", plan);
    for (const u of result?.understanding || [])
      if (u.status === "candidate" && u.basis === "explicit-statement")
        organizeStories(t.db, t.read, "lin", {
          command: "confirm",
          id: u.id,
          scope: "出游,旅行,摄影",
          allowCloud: true,
        });
    savePersona(t.db, t.read(), "lin", {
      enabled: false,
      nickname: "",
      style: "neutral",
      memoryUse: "relevant",
    });
    await record(caseName + "-personalization-with", plan);
    for (const u of result?.understanding || [])
      if (u.status === "candidate")
        organizeStories(t.db, t.read, "lin", { command: "forget", id: u.id });
    await record(caseName + "-personalization-after-forget", plan);
  } else if (caseName === "direct-sony") {
    await record("Sony-direct-current", () =>
      createProvider({ ...env, AI_JSON_MODE: "false" }, trackedFetch).generate(
        "你是自然、诚实的通用助手。直接回答，不伪造来源；不知道就说明。",
        "Sony WH-CH720N 第一次如何充电，怎么知道充完，有哪些注意事项？",
      ),
    );
  } else if (caseName.startsWith("persona")) {
    for (const style of ["neutral", "playful"] as const) {
      savePersona(t.db, t.read(), "lin", {
        enabled: true,
        nickname: "小物",
        style,
        memoryUse: "off",
      });
      await record("persona-" + style, () =>
        respond(
          t.db,
          t.read,
          "lin",
          {
            requestId: crypto.randomUUID(),
            question: "今天有点累，给我一句轻松的鼓励就好，不用计划任务。",
            mode: "auto",
            memoryPolicy: "off",
            uiContext: { page: "assistant" },
          },
          provider,
        ),
      );
    }
    const id = t.add("我的旅行相机", "电子设备", "", "");
    savePersona(t.db, t.read(), "lin", {
      enabled: true,
      nickname: "小镜",
      style: "playful",
      memoryUse: "relevant",
      itemId: id,
    });
    await record("companion-no-fake-memory", () =>
      respond(
        t.db,
        t.read,
        "lin",
        {
          requestId: crypto.randomUUID(),
          question: "小镜，你记得我们上次去了哪里吗？",
          itemId: id,
          mode: "companion",
          memoryPolicy: "off",
          uiContext: { page: "item", companion: true },
        },
        provider,
      ),
    );
  } else if (caseName.startsWith("product")) {
    const brand = process.env.FINAL_TEST_BRAND || "Xiaomi",
      model = process.env.FINAL_TEST_MODEL || "MAF10",
      name = process.env.FINAL_TEST_NAME || "Xiaomi Smart Air Fryer 6.5L";
    const id = t.add(
      name,
      process.env.FINAL_TEST_CATEGORY || "电子设备",
      brand,
      model,
    );
    t.write(
      mutate(t.read(), "lin", "updateItem", {
        itemId: id,
        region: process.env.FINAL_TEST_REGION || "",
      }),
    );
    if (process.env.FINAL_TEST_URL)
      t.write(
        mutate(t.read(), "lin", "updateItem", {
          itemId: id,
          supportUrl: process.env.FINAL_TEST_URL,
        }),
      );
    await record(`${caseName}-acquire`, () =>
      acquireKnowledge(t.db, t.read, "lin", id, {
        force: process.argv.includes("--refresh"),
      }),
    );
    let sessionId: string | undefined;
    const ask = async (question: string) => {
      const r = await respond(
        t.db,
        t.read,
        "lin",
        {
          requestId: crypto.randomUUID(),
          question,
          itemId: id,
          sessionId,
          mode: "auto",
          memoryPolicy: "off",
          uiContext: { page: "item" },
        },
        provider,
      );
      sessionId = r.session.id;
      return r;
    };
    await record(`${caseName}-first`, () =>
      ask(
        process.env.FINAL_TEST_QUESTION ||
          "我是第一次使用，能带我从准备到完成一次使用吗？尚未选食材，不编造食物参数。",
      ),
    );
    await record(`${caseName}-continue`, () =>
      ask("第一步已经完成了，接下来呢？请不要重新询问已确认的型号。"),
    );
  } else if (caseName.startsWith("creative")) {
    const specs = [
      ["测试手电筒", "电子设备", "塑料", ["照明"]],
      ["测试透明杯", "厨房用品", "玻璃", ["容纳"]],
      ["测试纸笔", "文具", "纸", ["书写"]],
      ["测试相机", "电子设备", "塑料", ["拍照"]],
      ["测试背包", "服装", "布", ["携带"]],
      ["测试衬衫", "服装", "棉", ["穿着"]],
      ["测试保鲜盒", "厨房用品", "食品接触塑料", ["收纳"]],
      ["测试苹果", "食品", "食物", ["食用"]],
    ] as const;
    for (const [n, c, m, capabilities] of specs)
      t.add(n, c, "", "", {
        attributes: {
          material: m,
          capabilities: [...capabilities],
          quantity: n === "测试苹果" ? 3 : 1,
        },
      });
    await record(caseName, () =>
      planDiscovery(
        t.db,
        t.read(),
        "lin",
        {
          goal:
            process.env.FINAL_TEST_GOAL ||
            "我有半小时，不买东西，想用已有物品做点有趣的事情。请给娱乐、创作、生活改善不同方向。",
          model: true,
          publicEvidence: false,
          candidates: Number(process.env.FINAL_TEST_CANDIDATES || 3),
          review: process.argv.includes("--review"),
          minutes: 30,
        },
        provider,
        t.read,
      ),
    );
  }
} finally {
  t.db.close();
  fs.closeSync(fd);
  fs.unlinkSync(lock);
  save();
}
