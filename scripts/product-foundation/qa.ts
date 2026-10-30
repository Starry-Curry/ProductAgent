import fs from "node:fs";
import path from "node:path";
import { validationFixture } from "../life-validation-fixture.ts";
import {
  storeOfficialDocument,
  makeKnowledgeDocument,
  retrieveKnowledge,
} from "../../src/lib/life/acquisition.ts";
import { createProvider } from "../../src/lib/ai/provider.ts";
import { respond } from "../../src/lib/agent/service.ts";
import { itemContext } from "../../src/lib/context/items.ts";

const gate = process.argv.find((v) => v.startsWith("--gateway="))?.slice(10);
// Candidate mode is explicit: raw experiments showed semantic hallucinations.
process.env.WUJIAN_EXPERIMENTAL_FACT_QA = "true";
if (!gate || new URL(gate).hostname !== "127.0.0.1")
  throw Error("running isolated task gateway required");
const dir = path.resolve(
  "docs/engineering/product-foundation-2026-10-30/evidence",
);
fs.mkdirSync(dir, { recursive: true });
const f = validationFixture(path.resolve(".runtime/qa-live"));
const request: typeof fetch = (url, init) =>
  fetch(gate + "/qa/v1/chat/completions", init);
const provider = createProvider(
  {
    AI_BASE_URL: "https://fixture.invalid/v1",
    AI_API_KEY: "fixture-only",
    AI_MODEL: "qwen-plus",
    AI_ALLOW_PAID_CALLS: "true",
  },
  request,
);
const specs = [
  {
    file: "jbl-clip5-pdf",
    brand: "JBL",
    model: "CLIP 5",
    name: "[合成持有]陌生CLIP5",
    questions: [
      "尺寸、重量、输出功率分别是多少？",
      "防水等级和最高工作温度各是什么？",
      "充电需要多久，用多大的输入电压电流？",
      "续航多少小时，是固定保证的吗？",
      "蓝牙版本和协议有哪些？",
      "频率响应和信噪比是什么？",
      "包装尺寸和物品尺寸一样吗，分别多大？",
      "电池容量、类型和能量是多少？",
      "这件音箱的挂扣承重多少，能吊住我的水壶吗？",
      "外壳是什么材料，能接触食品吗？",
      "能在45度以上的环境长期使用吗？",
      "它是否支持Wi-Fi，有可靠依据吗？",
      "我登记的这件进过水，现在密封是否完好？",
      "说明书写支持什么App，App有什么用途？",
      "我的USB电源已经坏了，产品规格能说明我当前电源安全吗？",
    ],
  },
  {
    file: "sony-top",
    brand: "Sony",
    model: "WH-CH520",
    name: "[合成持有]陌生CH520",
    questions: [
      "防水吗，淋雨后边湿边充电会怎样？",
      "正常开机需要按哪个键、多久，第一次开机会怎样？",
      "播放暂停和音量控制分别有什么按法？",
      "长按加号和短按加号的区别是什么？",
      "长按减号和短按减号有什么区别？",
      "控制按钮在左边还是右边，有依据吗？",
      "配套App名称是什么，启用全部功能前要注意什么？",
      "型号名称和手册中的内部Model编号分别是什么？",
      "首次配对和以后使用完全一样吗，资料说到哪一步？",
      "这个型号支持降噪吗，当前资料证明了吗？",
      "头梁是什么材料，精确尺寸多少？",
      "电池坏了能由我拆开维修吗？",
      "资料中确定的内容与还未知的操作信息分别有哪些？",
      "我已经把耳机弄湿了，现在应不应该充电？",
      "我手里这件耳机右侧键有故障，你能从官网确认它没问题吗？",
    ],
  },
];
const cases: { id: string; itemId: string; question: string }[] = [];
for (const s of specs) {
  const d = JSON.parse(
    fs.readFileSync(`.runtime/research/${s.file}.json`, "utf8"),
  );
  const itemId = f.add(s.name, "电子设备", s.brand, s.model);
  const state = f.read();
  const item = state.items.find((i) => i.id === itemId)!;
  item.synthetic = true;
  f.write(state);
  storeOfficialDocument(
    f.db,
    "lin",
    item,
    makeKnowledgeDocument(d, item, [d.url]),
  );
  for (const question of s.questions)
    cases.push({
      id: String(cases.length + 1).padStart(2, "0"),
      itemId,
      question,
    });
}
const selected = process.argv
  .find((v) => v.startsWith("--cases="))
  ?.slice(8)
  .split(",");
if (process.argv.includes("--extra")) {
  cases.push({
    id: "31",
    itemId: cases[15].itemId,
    question: "这个耳机的内部编号是什么？厂家资料是否说明了头梁材料？",
  });
  cases.push({
    id: "32",
    itemId: cases[15].itemId,
    question: "我喜欢安静，资料能证明它有主动降噪功能吗？",
  });
}
const round =
  process.argv.find((v) => v.startsWith("--round="))?.slice(8) || "initial";
if (!/^[a-z0-9-]+$/.test(round)) throw Error("invalid round");
const output: any[] = [];
const save = () =>
  fs.writeFileSync(
    path.join(dir, `qa-live-${round}.json`),
    JSON.stringify(
      {
        synthetic: true,
        runtime: process.version,
        model: provider.model,
        concurrency: 1,
        results: output,
      },
      null,
      2,
    ) + "\n",
  );
try {
  for (const c of cases) {
    if (selected && !selected.includes(c.id)) continue;
    if (output.some((r) => r.id === c.id)) continue;
    const started = performance.now();
    let firstMs: number | undefined;
    provider.onText = () => {
      firstMs ??= performance.now() - started;
    };
    try {
      const result = await respond(
        f.db,
        f.read,
        "lin",
        {
          requestId: crypto.randomUUID(),
          itemId: c.itemId,
          mode: "service",
          question: c.question,
          memoryPolicy: "off",
          uiContext: { page: "item" },
        },
        provider,
      );
      output.push({
        ...c,
        source: "app-core",
        firstContentMs: firstMs,
        totalMs: performance.now() - started,
        result,
      });
    } catch (e) {
      output.push({
        ...c,
        source: "app-core",
        totalMs: performance.now() - started,
        error: (e as Error).message,
      });
    }
    save();
    console.log(
      c.id,
      output.at(-1).result?.reply.outcome || "failed",
      Math.round(output.at(-1).totalMs),
    );
  }
  for (const c of selected
    ? []
    : cases.filter((_v, n) => [0, 7, 8, 15, 23, 29].includes(n))) {
    const item = f.read().items.find((i) => i.id === c.itemId)!;
    const input = {
      question: c.question,
      item: itemContext(item),
      evidence: retrieveKnowledge(f.db, f.read(), "lin", c.itemId, c.question),
    };
    const started = performance.now();
    let firstMs: number | undefined;
    try {
      const result = await provider.generate(
        "根据给定物品和资料自然回答全部问题；没有依据明确未知，不能编造或声称控制设备。",
        input,
        {
          json: false,
          temperature: 0.2,
          maxTokens: 1800,
          onText: () => {
            firstMs ??= performance.now() - started;
          },
        },
      );
      output.push({
        ...c,
        source: "direct-same-model",
        firstContentMs: firstMs,
        totalMs: performance.now() - started,
        result,
      });
    } catch (e) {
      output.push({
        ...c,
        source: "direct-same-model",
        totalMs: performance.now() - started,
        error: (e as Error).message,
      });
    }
    save();
  }
} finally {
  f.db.close();
}
