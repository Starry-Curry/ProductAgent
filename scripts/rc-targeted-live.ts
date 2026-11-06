/** Current task authorization: at most 6 text + 2 vision HTTP requests. No secrets or private workspace input. */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createProvider, ProviderError } from "../src/lib/ai/provider.ts";
import { validationFixture } from "./life-validation-fixture.ts";
import { saveSource } from "../src/lib/life/sources.ts";
import { indexOfficialSource } from "../src/lib/life/acquisition.ts";
import { respond } from "../src/lib/agent/service.ts";
import { planDiscovery } from "../src/lib/life/planning.ts";
import { organizeStories } from "../src/lib/life/organization.ts";
import { saveFragment } from "../src/lib/life/stories.ts";
const dir = path.join(process.cwd(), ".runtime", "rc-targeted-20261020");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, "ledger.json");
const ledger: { requests: any[]; cases: any[] } = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8"))
  : { requests: [], cases: [] };
const save = () => fs.writeFileSync(file, JSON.stringify(ledger, null, 2));
if (!process.argv.includes("--run")) {
  console.log(
    JSON.stringify({ used: ledger.requests.length, limit: 8, sent: 0 }),
  );
  process.exit(0);
}
const lock = path.join(dir, "live.lock"),
  fd = fs.openSync(lock, "wx");
const t = validationFixture(dir);
let purpose = "";
let thisCase = 0;
try {
  if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
  const env: Record<string, string | undefined> = {
    ...process.env,
    AI_ALLOW_PAID_CALLS: "true",
    WUJIAN_ALLOW_PAID_CALLS: "true",
    AI_MODEL: "qwen-plus",
    AI_ENABLE_THINKING: "false",
    WUJIAN_ALLOW_SEARCH: "false",
  };
  process.env.WUJIAN_ALLOW_PUBLIC_FETCH = "false";
  const send: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)),
      vision = JSON.stringify(body.messages).includes('"image_url"');
    if (
      ledger.requests.length >= 8 ||
      ledger.requests.filter((r) => !r.vision).length >= 6 ||
      thisCase >= 1
    )
      throw new ProviderError(
        "budget_exhausted",
        "本场景1次/文字总6次预算已到，不发送重试",
      );
    if (new URL(String(url)).hostname !== "dashscope.aliyuncs.com" || vision)
      throw new ProviderError(
        "configuration",
        "本脚本只运行北京百炼文字路径，视觉另行配置",
      );
    thisCase++;
    const entry: any = {
      number: ledger.requests.length + 1,
      purpose,
      vision: false,
      model: body.model,
      at: new Date().toISOString(),
      inputCharacters: JSON.stringify(body.messages).length,
    };
    ledger.requests.push(entry);
    save();
    const start = Date.now();
    try {
      const response = await fetch(url, init);
      const data = await response
        .clone()
        .json()
        .catch(() => null);
      entry.status = response.status;
      entry.tokens = data?.usage;
      entry.output = data?.choices?.[0]?.message;
      return response;
    } catch (e) {
      entry.status = "network_failed";
      throw e;
    } finally {
      entry.elapsedMs = Date.now() - start;
      save();
    }
  };
  const provider = createProvider(env, send);
  const directProvider = createProvider(
    { ...env, AI_JSON_MODE: "false" },
    send,
  );
  if (!provider.ready) throw Error("当前项目缺少有效配置，未发送");
  const maf = t.add(
      "Xiaomi Smart Air Fryer 6.5L",
      "厨房用品",
      "Xiaomi",
      "MAF10",
    ),
    sony = t.add("Sony WH-CH520", "电子设备", "Sony", "WH-CH520");
  // Only public official documents from the previous synthetic RC fixture are copied, never its stories/users.
  const oldPath = path.join(
    process.cwd(),
    ".runtime",
    "rc-20261020",
    "test.sqlite",
  );
  if (fs.existsSync(oldPath)) {
    const db = new DatabaseSync(oldPath, { readOnly: true });
    try {
      for (const row of db
        .prepare(
          "SELECT body FROM life_knowledge_documents WHERE status='active'",
        )
        .all() as { body: string }[]) {
        const d = JSON.parse(row.body);
        const id =
          d.model === "MAF10" ? maf : d.model === "WH-CH520" ? sony : null;
        if (!id) continue;
        const sourceId = saveSource(t.db, t.read(), "lin", {
          itemId: id,
          title: d.title,
          text: d.text,
          url: d.url,
          kind: "official-public",
        });
        indexOfficialSource(t.db, t.read(), "lin", id, sourceId);
      }
    } finally {
      db.close();
    }
  }
  async function run(name: string, fn: () => Promise<any>) {
    if (ledger.cases.some((c) => c.name === name)) return;
    purpose = name;
    thisCase = 0;
    const start = Date.now();
    try {
      const result = await fn();
      ledger.cases.push({ name, result, elapsedMs: Date.now() - start });
    } catch (e) {
      ledger.cases.push({
        name,
        error: (e as Error).message,
        elapsedMs: Date.now() - start,
      });
    }
    save();
    console.log(
      JSON.stringify({
        case: name,
        used: ledger.requests.length,
        result: ledger.cases.at(-1).error ? "failed" : "recorded",
      }),
    );
  }
  const turn = (question: string, itemId: string, sessionId?: string) =>
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
        uiContext: { page: "item" },
      },
      provider,
    );
  await run("MAF10-first", () =>
    turn(
      "我是第一次使用，能带我从准备到完成一次烹饪吗？尚未选食材，不要编造食品参数。",
      maf,
    ),
  );
  await run("MAF10-continue", () =>
    turn(
      "我已经做过第一步了，接下来呢？",
      maf,
      ledger.cases.find((c) => c.name === "MAF10-first")?.result?.session.id,
    ),
  );
  if (process.argv.includes("--continue-fix"))
    await run("MAF10-continue-fixed", () =>
      turn(
        "我已经做过第一步了，接下来呢？",
        maf,
        ledger.cases.find((c) => c.name === "MAF10-first")?.result?.session.id,
      ),
    );
  await run("Sony-agent", () =>
    turn("第一次如何给这款耳机充电，怎么知道充完？", sony),
  );
  await run("Sony-direct", () =>
    directProvider.generate(
      "你是自然、诚实的通用助手。直接回答，不虚构来源；不知道则说明。",
      "Sony WH-CH520 第一次如何充电，怎么知道充完？",
      { maxTokens: 1600, timeoutMs: 45000 },
    ),
  );
  const bag = t.add("旅行背包", "服装", "合成", "BAG"),
    camera = t.add("便携相机", "电子设备", "合成", "CAM", {
      attributes: { capabilities: ["图像记录"], quantity: 1 },
    }),
    coat = t.add("棉质外套", "服装", "合成", "COAT");
  const goal =
    "我有半小时准备一次城市出游，不买东西，用已有物品给我一个有趣且实际的计划。";
  const plan = () =>
    planDiscovery(
      t.db,
      t.read(),
      "lin",
      {
        goal,
        itemIds: [bag, camera, coat],
        minutes: 30,
        model: true,
        review: false,
        publicEvidence: false,
        candidates: 1,
      },
      provider,
      t.read,
    );
  await run("creative-without-context", plan);
  const f = saveFragment(t.db, t.read, "lin", {
    text: "我喜欢轻装旅行，喜欢拍建筑细节，不喜欢安排太满。",
    itemIds: [],
    allowRecall: true,
    allowCloud: true,
  });
  const u = organizeStories(t.db, t.read, "lin", {
    command: "extract",
  }).understanding.find((u) => u.status === "candidate");
  if (u)
    organizeStories(t.db, t.read, "lin", {
      command: "confirm",
      id: u.id,
      scope: "出游,旅行",
      allowCloud: true,
    });
  await run("creative-with-context", plan);
  ledger.cases.push({
    name: "vision-not-run",
    reason: env.AI_VISION_MODEL
      ? "本脚本无视觉执行器"
      : "未配置AI_VISION_MODEL，保留2次视觉额度；合成协议不等于真实识别",
  });
  save();
  console.log(
    JSON.stringify({
      used: ledger.requests.length,
      text: ledger.requests.filter((r) => !r.vision).length,
      vision: 0,
      secretPrinted: false,
      fees: "child process only; default unchanged",
      storyEvidence: f.id,
    }),
  );
} finally {
  t.db.close();
  fs.closeSync(fd);
  fs.unlinkSync(lock);
}
