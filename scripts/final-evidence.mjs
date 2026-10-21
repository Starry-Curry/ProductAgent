/** Assemble synthetic sprint evidence only. Does not load environment secrets or call models. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const dir = ".runtime/final-20261021";
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const hash = (f) =>
  createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const cli = read(dir + "/ledger.json");
const requests = cli.requests.map((r) => ({
  ...r,
  origin: "final-live",
  outputUnchecked: true,
}));
const browsers = [];
for (const name of fs
  .readdirSync(".runtime")
  .filter((n) => n.startsWith("final-browser-"))) {
  const folder = path.join(".runtime", name),
    ledger = path.join(folder, "model-requests.jsonl");
  if (fs.existsSync(ledger)) {
    const rows = fs
      .readFileSync(ledger, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    for (const started of rows.filter((r) => r.state === "started")) {
      const r = rows.find(
        (r) => r.state === "finished" && r.at === started.at,
      ) || { ...started, status: "unfinished" };
      const rates =
        r.model === "qwen-plus"
          ? [0.8, 2]
          : r.model === "qwen3-vl-plus"
            ? [1, 10]
            : null;
      requests.push({
        ...r,
        origin: name,
        outputUnchecked: true,
        estimatedCny:
          rates && r.usage
            ? ((r.usage.prompt_tokens ?? r.usage.input_tokens) * rates[0] +
                (r.usage.completion_tokens ?? r.usage.output_tokens) *
                  rates[1]) /
              1e6
            : null,
      });
    }
  }
  for (const file of [
    "browser-validation.json",
    "browser-resume-validation.json",
  ]) {
    if (fs.existsSync(path.join(folder, file))) {
      const report = read(path.join(folder, file));
      browsers.push({ origin: name + "/" + file, ...report });
    }
  }
}
const latency = requests
  .map((r) => r.elapsedMs)
  .filter(Number.isFinite)
  .sort((a, b) => a - b);
const modelSummary = {};
for (const r of requests) {
  const m = (modelSummary[r.model] ||= {
    requests: 0,
    http200: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCny: 0,
    unpricedAttempts: 0,
  });
  m.requests++;
  m.http200 += Number(r.status === 200);
  m.failed += Number(r.status !== 200);
  m.inputTokens += r.usage?.prompt_tokens ?? r.usage?.input_tokens ?? 0;
  m.outputTokens += r.usage?.completion_tokens ?? r.usage?.output_tokens ?? 0;
  m.estimatedCny += r.estimatedCny || 0;
  m.unpricedAttempts += Number(r.estimatedCny == null);
}
const historicalPath = "docs/engineering/wujian-rc-acceptance.json";
const historical = read(historicalPath);
const compact = (r) => {
  if (r?.reply)
    return {
      reply: r.reply,
      sessionId: r.session?.id,
      tried: r.session?.tried,
      trace: r.trace,
    };
  if (r?.documents)
    return {
      cached: r.cached,
      issues: r.issues,
      acquisition: r.acquisition,
      documents: r.documents.map((d) => ({
        id: d.id,
        url: d.url,
        model: d.model,
        region: d.region,
        hash: d.hash,
        characters: d.text.length,
        chunks: d.chunks.length,
      })),
    };
  return r;
};
const cases = cli.cases.map((c) => ({
  ...c,
  result: compact(c.result),
  evaluation:
    "模型输出/协议结果；具体产品评价见 currentObservations 和新增验收，HTTP200不等于通过",
}));
const observations = {
  A1: "本轮浏览器MAF10首用7步，有原文引用但装料环节仍因证据定位未形成完整指导；无食材/份量和实机烹饪验证，保持partial/L2。",
  A2: "Sony仅品牌型号自动支持页读取受限；提供官方PDF后首轮4步、续接3步，已避免无据接口方位。此前正文假设及引文误拒失败保留。",
  A3: "新IKEA404.498.99自动读取官方正文；最终湿布/擦干与配件紧固两步，续接不重复。家具组装泛化未完全验收。",
  A4: "有限品牌适配与用户官方链接可用；未知品牌不保证自动发现，Kettle地区/完整型号不符拒绝，原生搜索1次无可验证URL。",
  A5: "早期真实浏览器已通过；最终构建首答后网络中断，显式单次重试同一会话成功且不重述已完成清洁。仍有网络不稳定，历史等级不改。",
  B1: "真实云端已生成跨类别方案，但部分光学假设、计时/材料依赖和趣味性不合格；拒绝与局部接受并存，不宣称可靠通用创意。",
  B2: "物品简称与‘只用已有物品’不再阻止模型；整理、穿搭、备菜、摄影、出游均实际测试，有成功、部分及失败。",
  B3: "真实连续修改能排除杯子并缩短至5分钟；结果仍有精确计时工具未确认，完整可执行性不升级。",
  B4: "修复数字照片直接粘纸、普通杯聚焦、未登记供电/性能等；规则是有限防线，并非全面语义证明。",
  B5: "National Archives公开原文真实读取，17词短摘录进入实际老照片整理功能；用户提交经验可用；Wikibooks读取仍失败。",
  B6: "最多一次按实际原因重规划；复核失败只保留先前通过相同规则的草稿，仍会漏检隐含条件。",
  C1: "真实Edge上传合成组合图，真实视觉候选并由人式操作勾选确认，保存照片与一句话。",
  C2: "纯文字故事及阅读布局通过本轮离线API+Edge回归。",
  C3: "单一事件关联相机和鼠标，两个详情均见原ID，刷新后存在。",
  C4: "编辑、追加照片、解除关系与删除通过当前生产构建的API+Edge回归。",
  C5: "赠出后原作者私人事件、照片权限保留，本机角色回归通过；非真实家庭账户。",
  C6: "云端文本授权/撤销与推理中撤权通过回归；真实有/无/忘记后的模型输入分别为[]/明确原话/[]，个性化质量另评。",
  D1: "耗尽/不可用物品不参与推荐，数量、期限、植物与衣物字段及撤销回归通过；无真实库存传感。",
  D2: "家庭确认/交接/负责人权限通过独立生产回归，本机演示身份。",
  D3: "礼物作者/选择分享/一次领取/撤销与赠后私人故事权限回归通过。",
  D4: "真实浏览器自然聊天不强行绑定物品，未使用无关故事ID。",
  D5: "桌面/390px、照片自定义控件、默认阅读、跨物品、家庭/社交与legacy回归通过；另有模型延迟及任务质量限制。",
};
const extra = [
  [
    "R1",
    "故事书默认阅读/轻量写入/图文与双向入口",
    "controlled-pass",
    "L2",
    "真实Edge桌面与390px；照片/文字、弹窗/编辑删除回归；主观愿意翻阅未做用户研究",
  ],
  [
    "V1",
    "真实视觉识别与实例候选",
    "controlled-pass",
    "L2",
    "qwen3-vl-plus合成公开照片组合；鼠标/相机两类候选由用户确认，未知绿植不虚构库存匹配",
  ],
  [
    "V2",
    "相似/同型号不错误合并",
    "controlled-pass",
    "L2",
    "真实相机含备用实例候选，离线同型号歧义测试；按名称/类别检索，未做图片向量比对",
  ],
  [
    "M1",
    "30事件语义章节与个人候选",
    "controlled-pass",
    "L2",
    "最终真实模型3章建议(3/6/6成员)和一条明确原话；不是30条自动全覆盖；确认前不变为事实",
  ],
  [
    "M2",
    "重复、拒绝、纠正、遗忘、赠后保留",
    "controlled-pass",
    "L2",
    "30事件领域回归与跨模块Edge；真实请求输入遗忘后无旧偏好",
  ],
  [
    "M3",
    "有/无Context实质帮助对照",
    "not-passed",
    "L2",
    "建筑细节主题有变化，但有条件遗漏/不当动作/最终拒绝，未证明稳定的实际个性化增益",
  ],
  [
    "P1",
    "称呼/风格/可选伙伴",
    "controlled-pass",
    "L2",
    "真实neutral/playful表达有变化，无记忆时承认没有记录；仍有拟人动作修辞，主观风格验收待用户",
  ],
  [
    "X1",
    "物品→使用→照片→多物品事件→章节→理解",
    "controlled-pass",
    "L2",
    "真实浏览器+API确认章节/明确原话候选；末端个性化增益依M3不算整体完全通过",
  ],
  [
    "Q1",
    "同模型普通Sony问答对照",
    "case-comparison-only",
    "L2",
    "普通请求已HTTP200，包含边充边播等与官方指南冲突内容；Agent最终范围更窄有据。单例不证明普遍优越",
  ],
  [
    "S1",
    "两访客隔离/重启/备份恢复/费用开关",
    "controlled-pass",
    "L2",
    "独立Node生产模拟真实HTTP+Edge，模型仅离线替身；Docker/Linux/公网未实测",
  ],
  [
    "L3-1",
    "CLIP/SigLIP/向量记忆与Neo4j",
    "not-implemented",
    "L3",
    "当前SQLite事件/关系/候选+定向检索；尚无向量评测需求和相关基准，不引入新服务",
  ],
  [
    "L3-2",
    "真实家庭账户与公网HTTPS",
    "not-deployed",
    "L3",
    "需部署者确认服务器、域名/HTTPS、持久卷、账户及公网隔离验证；本轮不购买或部署",
  ],
  [
    "L3-3",
    "全品牌自动官方搜索/受限社区API",
    "not-implemented",
    "L3",
    "百炼本次无URL；Wiki不通、Hackaday需账号；不得宣称全平台或模型引用已验证",
  ],
].map(([id, task, result, level, evidence]) => ({
  id,
  task,
  result,
  level,
  evidence,
}));
const sourceFiles = execFileSync(
  "git",
  ["diff", "--name-only", "d5affe4", "HEAD"],
  { encoding: "utf8" },
)
  .trim()
  .split(/\r?\n/)
  .filter((f) => /^(src|scripts|tests)\//.test(f) && fs.existsSync(f));
const output = {
  date: new Date().toISOString(),
  baseline: "d5affe4",
  implementationHead: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  syntheticOnly: true,
  privacy:
    "No keys, user photos/databases, full official manuals or third-party pages exported. Outputs are synthetic test output, not verified facts.",
  summary: {
    attempts: requests.length,
    http200: requests.filter((r) => r.status === 200).length,
    failed: requests.filter((r) => r.status !== 200).length,
    vision: requests.filter((r) => r.vision).length,
    modelSummary,
    latencyMs: {
      p50: latency[Math.floor(latency.length * 0.5)],
      p95: latency[Math.floor(latency.length * 0.95)],
    },
    estimatedPricedCny: requests.reduce((s, r) => s + (r.estimatedCny || 0), 0),
    unpricedAttempts: requests.filter((r) => r.estimatedCny == null).length,
    actualBill: null,
    costPolicy:
      "Beijing qwen-plus <=128k 0.8/2 CNY per million input/output, qwen3-vl-plus <=32k 1/10; conservative without cache discount. 3.7/3.8 models and unavailable usage unpriced; native-search extra charges unknown. This is NOT the total account bill.",
    priceSource: "https://help.aliyun.com/zh/model-studio/model-pricing",
  },
  tests: {
    unit: {
      pass: Number(
        fs
          .readFileSync(dir + "/unit-final.txt", "utf8")
          .match(/ℹ pass (\d+)/)?.[1],
      ),
      fail: Number(
        fs
          .readFileSync(dir + "/unit-final.txt", "utf8")
          .match(/ℹ fail (\d+)/)?.[1],
      ),
      record: ".runtime/final-20261021/unit-final.txt",
    },
    typecheck: read(dir + "/typecheck-final.json"),
    build: {
      status: "pass",
      ...read(".runtime/latest-life-build.json"),
      id: fs.readFileSync(".next-rc/BUILD_ID", "utf8"),
    },
    production: read(dir + "/regression-final.json"),
    benchmark: {
      status: "known-failure",
      falseRejections: 1,
      details:
        "Historical extractive harness rejects a benign paraphrase; foundation benchmark 0 regressions. No threshold changed.",
    },
    cloud: read("artifacts/cloud/validation.json"),
    storybook: read("artifacts/rc/storybook-journeys.json"),
  },
  historical23: {
    path: historicalPath,
    sha256: hash(historicalPath),
    cases: historical.cases,
    policy:
      "编号、结果与等级原样保留；以下currentObservations不是对历史结果的覆盖",
  },
  currentObservations: observations,
  extraAcceptance: extra,
  demoStats: read(dir + "/demo-stats-final.json"),
  publicSources: read(dir + "/public-sources-final.json"),
  publicFunctional: read(dir + "/public-functional-final.json"),
  sourceHashes: Object.fromEntries(sourceFiles.map((f) => [f, hash(f)])),
  browserSummary: browsers.map((b) => ({
    origin: b.origin,
    resumedFrom: b.resumedFrom,
    passed: b.checks.length === 4 && !b.cases.some((c) => c.error),
    checks: b.checks.length,
  })),
  browsers,
  cases,
  requests,
  verdict:
    "受控本机初赛候选；商品首用完整性、开放创意可靠性/趣味性、个性化实质增益仍未全部通过。未公开部署，未做实机操作或用户研究。",
};
// Keep final user-visible answers and protocol metadata; do not republish long
// verbatim manual quotations embedded in model JSON. Local raw replay is intact.
function exportSafe(value) {
  if (typeof value === "string" && /^[\s]*[\[{]/.test(value)) {
    try {
      return JSON.stringify(exportSafe(JSON.parse(value)));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map(exportSafe);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) =>
        k === "sourceQuote" && typeof v === "string"
          ? [
              "sourceQuoteEvidence",
              {
                omitted: true,
                characters: v.length,
                sha256: createHash("sha256").update(v).digest("hex"),
              },
            ]
          : [k, exportSafe(v)],
      ),
    );
  return value;
}
output.quoteExportPolicy =
  "Long sourceQuote fields inside model JSON are replaced by hashes/lengths. Rendered replies retained. Raw local synthetic records remain unchanged for authorized offline replay.";
const text = JSON.stringify(exportSafe(output), null, 2);
if (
  /\bsk-[A-Za-z0-9_-]{12,}|BEGIN (?:RSA |EC )?PRIVATE KEY|data:image\/[^;]+;base64/i.test(
    text,
  )
)
  throw Error("Sensitive-looking export content blocked");
fs.writeFileSync(
  "docs/engineering/wujian-final-validation-2026-10-21.json",
  text + "\n",
);
console.log(JSON.stringify(output.summary));
