/** RC authorization: maximum 40 HTTP model requests, including <=10 native search and <=5 vision. Synthetic database only. */
import fs from "node:fs";
import path from "node:path";
import { createProvider, ProviderError } from "../src/lib/ai/provider.ts";
import { cloudStatus } from "../src/lib/life/provider.ts";
import { respond } from "../src/lib/agent/service.ts";
import { planDiscovery } from "../src/lib/life/planning.ts";
import { importCreativeEvidence } from "../src/lib/life/creative-evidence.ts";
import { validationFixture } from "./life-validation-fixture.ts";
import { saveFragment } from "../src/lib/life/stories.ts";

const directory = path.join(process.cwd(), ".runtime", "rc-20261020");
fs.mkdirSync(directory, { recursive: true });
const file = path.join(directory, "live-ledger.json");
const ledger: { requests: any[]; cases: any[] } = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8"))
  : { requests: [], cases: [] };
const save = () => fs.writeFileSync(file, JSON.stringify(ledger, null, 2));
const lock = path.join(directory, "live.lock"),
  fd = fs.openSync(lock, "wx");
const t = validationFixture(directory);
const name =
  process.argv.find((a) => a.startsWith("--case="))?.slice(7) || "A1";
let caseStart = ledger.requests.length;
const request: typeof fetch = async (url, init) => {
  const body = JSON.parse(String(init?.body || "{}"));
  const search = new URL(String(url)).pathname.includes(
    "text-generation/generation",
  );
  const vision = JSON.stringify(body.messages || []).includes('"image_url"');
  if (
    ledger.requests.length >= 40 ||
    (search && ledger.requests.filter((r) => r.search).length >= 10) ||
    (vision && ledger.requests.filter((r) => r.vision).length >= 5) ||
    ledger.requests.length - caseStart >= 4
  )
    throw new ProviderError("budget_exhausted", "RC请求预算已到，未发送");
  const entry: any = {
    number: ledger.requests.length + 1,
    case: name,
    purpose: `固定验收${name}的最终用户回答/反馈`,
    model: body.model,
    search,
    vision,
    at: new Date().toISOString(),
    inputCharacters: JSON.stringify(body.input || body.messages || []).length,
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
    entry.usage = data?.usage;
    entry.output = data?.choices?.[0]?.message || data?.output;
    return response;
  } catch {
    entry.status = "network_failed";
    throw new ProviderError("network", "网络失败，未自动重试");
  } finally {
    entry.elapsedMs = Date.now() - start;
    save();
  }
};
try {
  if (!process.argv.includes("--run")) {
    console.log(
      JSON.stringify({ used: ledger.requests.length, limit: 40, sent: 0 }),
    );
  } else {
    if (ledger.cases.some((c) => c.name === name))
      throw Error("此案例已记录；改动后用新的明确回归编号，禁止默默重复");
    if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
    const env: Record<string, string | undefined> = {
      ...process.env,
      AI_ALLOW_PAID_CALLS: "true",
      WUJIAN_ALLOW_PAID_CALLS: "true",
      WUJIAN_ALLOW_SEARCH: "true",
      AI_ENABLE_THINKING: "false",
    };
    if (
      !cloudStatus(env).ready ||
      env.AI_MODEL !== "qwen-plus" ||
      new URL(env.AI_BASE_URL!).hostname !== "dashscope.aliyuncs.com"
    )
      throw Error("北京qwen-plus配置不符，未发送；仅在本机修改配置");
    process.env.WUJIAN_ALLOW_PUBLIC_FETCH = "true";
    process.env.WUJIAN_ALLOW_SEARCH = "true";
    process.env.LANGSMITH_TRACING = "false";
    process.env.LANGCHAIN_TRACING_V2 = "false";
    const provider = createProvider(env, request);
    const maf = t.add("RC 空气炸锅", "厨房用品", "Xiaomi", "MAF10", {
      region: "uk",
    });
    const sony = t.add("RC 耳机", "电子设备", "Sony", "WH-CH520", {
      supportUrl:
        "https://helpguide.sony.net/mdr/2958/v1/en/contents/TP1000776814.html",
    });
    const ikea = t.add("RC 书架", "家具", "宜家", "305.976.49", {
      region: "cn",
    });
    const fresh = t.add(
      "RC 新型号空气炸锅",
      "厨房用品",
      "Philips",
      "HD9252/90",
    );
    const lego = t.add("RC 拼搭套装", "玩具", "LEGO", "11036");
    const unknown = t.add(
      "RC 未知电器",
      "电子设备",
      "合成品牌",
      "ZZ-NOT-REAL-RC",
    );
    const light = t.add("RC 手电筒", "电子设备", "合成", "LIGHT", {
      attributes: { quantity: 1, capabilities: ["照明"] },
    });
    const cup = t.add("RC 透明玻璃杯", "厨房用品", "合成", "CUP", {
      attributes: { quantity: 1, material: "玻璃", capabilities: ["容纳"] },
    });
    const paper = t.add("RC 纸笔", "文具", "合成", "PAPER", {
      attributes: { quantity: 1, capabilities: ["书写", "绘画"] },
    });
    const turn = (question: string, itemId?: string, sessionId?: string) =>
      respond(
        t.db,
        t.read,
        "lin",
        {
          question,
          itemId,
          sessionId,
          requestId: crypto.randomUUID(),
          mode: "auto",
          memoryPolicy: "off",
          uiContext: { page: itemId ? "item" : "assistant" },
        },
        provider,
      );
    const start = Date.now();
    let result: any;
    const previous = ledger.cases.find((c) => c.name === "A1")?.result;
    const before = ledger.requests.length;
    try {
      if (name.startsWith("A1"))
        result = await turn(
          "我是第一次使用，想烹饪食物，能带我从首次清洗、准备到完成吗？不要自拟食材参数。",
          maf,
        );
      else if (name.startsWith("A2"))
        result = await turn(
          "第一次如何给耳机充电？怎么知道充完，有什么注意事项？",
          sony,
        );
      else if (name.startsWith("A3"))
        result = await turn(
          "这件家具怎么清洁？它的装配是否有可用的图解？不要猜安装细节。",
          ikea,
        );
      else if (name.startsWith("A4-samla"))
        result = await turn(
          "这件收纳用品怎么使用和清洁？有哪些重要限制？",
          t.add("RC 新收纳用品", "家具", "宜家", "394.407.67", {
            region: "cn",
          }),
        );
      else if (name.startsWith("A4"))
        result = await turn(
          "第一次使用怎么准备、怎么清洁？请先按品牌型号找官方资料。",
          fresh,
        );
      else if (name.startsWith("A5"))
        result = await turn(
          "我已经做过第一步了，接下来呢？",
          maf,
          previous?.session?.id,
        );
      else if (name.startsWith("A6"))
        result = await turn(
          "这个第一次怎么用？型号已经确认，请不要猜。",
          unknown,
        );
      else if (name.startsWith("LEGO"))
        result = await turn(
          "这个型号的官方拼搭图解在哪里？能从说明书带我拼第一步吗？",
          lego,
        );
      else if (name.startsWith("D4"))
        result = await turn(
          "今天忙完终于有空坐一会儿，想随便聊聊，不用给我安排任务。",
        );
      else if (name.startsWith("C6")) {
        const story = saveFragment(t.db, t.read, "lin", {
          text: "合成测试：周六在阳台画杯子的轮廓，画歪了也觉得轻松。",
          itemIds: [],
          allowRecall: true,
          allowCloud: true,
        });
        result = await turn(
          "回忆我保存的阳台画画故事，陪我聊聊，不要补编人物、地点或其他经历。",
        );
        if (name.includes("revoke"))
          saveFragment(t.db, t.read, "lin", {
            id: story.id,
            revision: story.revision,
            text: story.text,
            itemIds: [],
            allowRecall: false,
            allowCloud: false,
          });
      } else if (name.startsWith("B")) {
        const old = ledger.cases.find((c) => c.name === "B1")?.result;
        let experience: string[] = [];
        if (name.startsWith("B5"))
          experience = [
            (
              await importCreativeEvidence(t.db, "lin", {
                url: "https://www.first8studios.org/nicoandnor/guide/shadows/lesson8/shoebox-shadow-theater.html",
              })
            ).id,
          ];
        const goals: Record<string, string> = {
          B1: "只用手电筒、玻璃杯和纸笔，给娱乐、生活改善、创作三个不同方案。不做科学观察实验，不假定有其他材料。",
          B2: "我想整理书桌，不花钱，请从我已有的可用物品挑合适的组合。",
          B3: "不要用玻璃杯，缩短到十分钟，换个更有趣的方向",
          B4: "我想用剪刀和胶带做手工，但没确认是否有这些材料，能怎么做？",
          B5: "参考给出的影子游戏经验，改成只用手电筒和纸笔，10分钟猜谜游戏，不用纸箱胶带剪刀。",
        };
        const key = name.slice(0, 2);
        result = await planDiscovery(
          t.db,
          t.read(),
          "lin",
          {
            goal: goals[key] || goals.B1,
            itemIds: key === "B2" ? [] : [light, cup, paper],
            model: true,
            review: false,
            publicEvidence: key === "B5",
            creativeEvidenceIds: experience,
            ...(key === "B3" && old
              ? {
                  previousIdeaIds: old.ideas.map((i: any) => i.id),
                  continuation: old.continuation,
                }
              : {}),
          },
          provider,
          t.read,
        );
      } else throw Error("Unknown fixed case");
      ledger.cases.push({
        name,
        elapsedMs: Date.now() - start,
        calls: ledger.requests.length - before,
        result,
      });
      console.log(
        JSON.stringify({
          name,
          used: ledger.requests.length,
          calls: ledger.requests.length - before,
          reply: result.reply || {
            ideas: result.ideas?.map((i: any) => ({
              title: i.title,
              steps: i.steps,
              source: i.source,
              limits: i.limits,
              sources: i.creativeEvidenceSources,
            })),
            missing: result.missing,
          },
        }),
      );
    } catch (e) {
      ledger.cases.push({
        name,
        calls: ledger.requests.length - before,
        error: (e as Error).message,
      });
      console.log(
        JSON.stringify({
          name,
          error: (e as Error).message,
          used: ledger.requests.length,
        }),
      );
    }
    save();
  }
} finally {
  t.db.close();
  process.env.AI_ALLOW_PAID_CALLS = "false";
  process.env.WUJIAN_ALLOW_PAID_CALLS = "false";
  process.env.WUJIAN_ALLOW_SEARCH = "false";
  fs.closeSync(fd);
  fs.unlinkSync(lock);
}
