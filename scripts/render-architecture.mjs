import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Documentation renderer only: no app server, env files, model or network calls.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "docs", "architecture");
const width = 1600,
  height = 2720,
  scale = 1.5;
const palette = {
  ink: "#193c34",
  muted: "#5d716a",
  green: "#2c7867",
  line: "#c7d6ce",
  paper: "#f5f7f3",
  pale: "#edf4ee",
  blue: "#edf3f9",
  blueLine: "#a8bdcf",
  amber: "#fbf4e7",
};
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
const elements = [];
function text(
  x,
  y,
  value,
  size = 24,
  color = palette.ink,
  weight = 400,
  anchor = "start",
) {
  elements.push(
    `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}">${esc(value)}</text>`,
  );
}
function rect(
  x,
  y,
  w,
  h,
  fill = "white",
  stroke = palette.line,
  radius = 20,
  dashed = false,
) {
  elements.push(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dashed ? ' stroke-dasharray="9 7"' : ""}/>`,
  );
}
function arrow(
  d,
  { color = palette.green, both = false, dashed = false } = {},
) {
  const marker = color === palette.green ? "arrow-green" : "arrow-blue";
  elements.push(
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${marker})"${both ? ` marker-start="url(#${marker})"` : ""}${dashed ? ' stroke-dasharray="6 5"' : ""}/>`,
  );
}
function group(id, x, y, w, h, title, lines, options = {}) {
  elements.push(`<g data-card="${id}">`);
  rect(
    x,
    y,
    w,
    h,
    options.fill || "white",
    options.stroke || palette.line,
    options.radius || 18,
  );
  text(
    x + 24,
    y + (options.titleY || 37),
    title,
    options.titleSize || 27,
    palette.ink,
    600,
  );
  lines.forEach((line, i) =>
    text(
      x + 24,
      y + (options.bodyY || 75) + i * (options.leading || 32),
      line,
      options.bodySize || 22,
      palette.muted,
    ),
  );
  elements.push("</g>");
}
function pill(id, x, y, w, h, title, subtitle, fill = palette.pale) {
  elements.push(`<g data-card="${id}">`);
  rect(x, y, w, h, fill, palette.line, 14);
  text(x + w / 2, y + 29, title, 23, palette.ink, 600, "middle");
  if (subtitle)
    text(x + w / 2, y + 54, subtitle, 18, palette.muted, 400, "middle");
  elements.push("</g>");
}
function section(y, h, number, title, subtitle) {
  rect(64, y, 1472, h, "white", palette.line, 28);
  text(88, y + 45, number + "  " + title, 32, palette.ink, 600);
  if (subtitle) text(88, y + 79, subtitle, 22, palette.muted);
}

rect(0, 0, width, height, palette.paper, palette.paper, 0);
text(64, 58, "WU JIAN / PRODUCT AGENT", 22, palette.green, 600);
text(64, 124, "物间｜项目功能与技术架构", 56, palette.ink, 700);
text(
  64,
  171,
  "理解物品 · 理解人 · 理解人与物、人与人的关系",
  30,
  palette.muted,
);
rect(64, 199, 586, 38, palette.pale, palette.line, 19);
text(
  84,
  225,
  "现有工程快照  2026.10.18  /  功能基线 a6aa51b",
  20,
  palette.green,
  600,
);
text(
  1536,
  224,
  "绿色：体验与闭环   蓝色：技术与依赖",
  21,
  palette.muted,
  400,
  "end",
);

section(266, 560, "01", "以对话连接物品与日常");
group(
  "person",
  88,
  346,
  432,
  96,
  "人｜目标、经历与当下感受",
  ["自然开聊；首次介绍可跳过"],
  { fill: palette.pale, titleSize: 25, titleY: 34, bodyY: 68 },
);
group(
  "home-agent",
  584,
  346,
  432,
  96,
  "家｜全屋 Agent + 物品伙伴",
  ["全屋分流 · 每物角色 · 同窗交流"],
  { fill: palette.pale, titleSize: 25, titleY: 34, bodyY: 68 },
);
group(
  "relations",
  1080,
  346,
  432,
  96,
  "关系｜家人与故事接收者",
  ["获准协作 · 礼物传承 · 保留作者"],
  { fill: palette.pale, titleSize: 25, titleY: 34, bodyY: 68 },
);
arrow("M 526 394 H 575");
arrow("M 1022 394 H 1071", { both: true });
const capabilities = [
  [
    "物品理解与使用帮助",
    "档案 / 型号 / 官方知识与适用条件",
    "连续澄清 · 操作步骤 · 尝试反馈",
  ],
  [
    "家庭空间与二维伙伴",
    "房间示意 / 摆放位置 / 状态动画",
    "点开物品问用法、讲故事或聊聊",
  ],
  [
    "故事、记忆与个性化",
    "从讲述与操作静默整理，保留来源",
    "回忆表达 · 语气 · 纠正 / 忘记 / 授权",
  ],
  [
    "场景计划与物品发现",
    "物品组合 / 条件核对 / 精选妙用",
    "有限场景规划，保存到活动准备",
  ],
  [
    "家庭协作与事项",
    "确认摘要 / 负责人 / 进展与反馈",
    "私聊不随物品共享而自动公开",
  ],
  [
    "礼物与故事传承",
    "选定故事快照 / 预览 / 确认认领",
    "保留原作者，接收后的私人记忆隔离",
  ],
];
capabilities.forEach(([title, ...lines], i) =>
  group(
    "capability-" + i,
    88 + (i % 3) * 484,
    470 + Math.floor(i / 3) * 166,
    456,
    142,
    title,
    lines,
    { titleSize: 27, bodySize: 22, fill: i === 2 ? palette.amber : "white" },
  ),
);
text(
  88,
  806,
  "原有业务模块与长辈版保留；全屋与物品对话共用这些能力。",
  22,
  palette.muted,
);

section(
  854,
  1102,
  "02",
  "技术分层与 Agent Harness",
  "下图表示主要职责与依赖；完整调用与权限细节见配套 Markdown。",
);
group(
  "ui",
  88,
  960,
  1424,
  88,
  "交互层｜Next.js 15 · React 19 · TypeScript · SVG 角色",
  ["HomeExperience / AssistantConversation / MemoryCenter / 原业务页面"],
  { fill: palette.blue, titleSize: 28, titleY: 34, bodyY: 66, bodySize: 23 },
);
arrow("M 800 1053 V 1070", { color: palette.blueLine });
group(
  "api",
  88,
  1078,
  1424,
  88,
  "Next.js API｜assistant / home / memories / workspace / gift / discover",
  ["本机演示访问校验 · 会话与物品范围 · Zod 输入校验"],
  { fill: palette.blue, titleSize: 27, titleY: 34, bodyY: 66, bodySize: 23 },
);
arrow("M 600 1171 V 1186", { color: palette.blueLine });
elements.push('<g data-card="harness">');
rect(88, 1194, 1000, 224, palette.blue, palette.blueLine, 20);
text(
  112,
  1233,
  "Agent Harness｜LangGraph.js · Node.js 24",
  29,
  palette.ink,
  600,
);
const stages = [
  ["route", "意图与目标"],
  ["prepare", "构建上下文"],
  ["model/tools", "生成与只读工具"],
  ["validate", "检查与回退"],
  ["wait", "等待用户继续"],
];
stages.forEach(([title, subtitle], i) => {
  pill("stage-" + i, 112 + i * 190, 1258, 168, 66, title, subtitle, "white");
  if (i < stages.length - 1)
    arrow(`M ${285 + i * 190} 1291 H ${296 + i * 190}`, {
      color: palette.blueLine,
    });
});
text(112, 1365, "Checkpoint / revision / lease", 23, palette.muted);
text(
  112,
  1397,
  "通用上限：3次模型 · 6次工具 · 45秒；本地路径可直接返回",
  22,
  palette.muted,
);
elements.push("</g>");
group(
  "skills",
  1116,
  1194,
  396,
  224,
  "任务 Skill / Prompt",
  [
    "物品帮助 · 物品故事",
    "记忆表达 · 陪伴交流",
    "证据发现",
    "每轮选择 · 工具白名单",
  ],
  { fill: palette.pale, titleSize: 27, bodyY: 76, leading: 34, bodySize: 23 },
);
arrow("M 1110 1235 H 1094", { color: palette.blueLine });
group(
  "context",
  88,
  1468,
  456,
  166,
  "Context 与 Memory",
  [
    "按人 / 物品 / 会话范围组织",
    "记忆 · 偏好 · 语气 · 当下要求",
    "临时模式 / 遗忘 / 上云授权",
  ],
  { fill: palette.pale, titleSize: 27, bodyY: 75, leading: 31 },
);
group(
  "provider",
  572,
  1468,
  456,
  166,
  "模型适配｜北京百炼",
  [
    "qwen-plus · 兼容接口",
    "费用开关 / 超时 / 本地回退",
    "故事回忆表达至多尝试1次模型",
  ],
  { fill: palette.blue, titleSize: 27, bodyY: 75, leading: 31 },
);
group(
  "knowledge",
  1056,
  1468,
  456,
  166,
  "商品知识｜Product Packs",
  [
    "11个资料包 / 33条事实",
    "2个有限预审过程 · 型号绑定",
    "来源 / 地域 / 版本 / 适用条件",
  ],
  { fill: palette.blue, titleSize: 26, bodyY: 75, leading: 31 },
);
arrow("M 316 1462 V 1425", { both: true, color: palette.blueLine });
arrow("M 800 1462 V 1425", { both: true, color: palette.blueLine });
arrow("M 1284 1462 V 1441 H 1040 V 1425", {
  both: true,
  color: palette.blueLine,
});
group(
  "domain",
  88,
  1688,
  696,
  156,
  "领域执行｜确认后权限复查、事务与幂等",
  ["位置 / 活动计划 / 家庭事项 / 礼物", "业务命令执行后回读，给出真实回执"],
  { fill: palette.amber, titleSize: 26, bodyY: 78, leading: 34, bodySize: 23 },
);
group(
  "storage",
  816,
  1688,
  696,
  156,
  "本地 SQLite v6｜持久化与迁移备份",
  [
    "workspace JSON：主要业务与原始故事",
    "专用表：会话 / 记忆 / Checkpoint / 摆放 / 行动",
  ],
  { fill: palette.blue, titleSize: 27, bodyY: 78, leading: 34, bodySize: 22 },
);
arrow("M 790 1766 H 808", { color: palette.blueLine });
arrow("M 88 1137 H 73 V 1766 H 81", { color: palette.blueLine });
text(
  88,
  1888,
  "Context、会话与领域服务按范围读写本地库；主业务仍是 JSON，当前未使用向量数据库。",
  23,
  palette.muted,
);
text(
  88,
  1927,
  "模型仅调用受控只读工具；预览卡确认后由领域服务执行写动作。",
  23,
  palette.green,
  600,
);

section(1984, 390, "03", "两条闭环：理解用户，也把事情办完");
text(88, 2062, "记忆与个性化", 23, palette.green, 600);
const memoryLoop = [
  ["自然讲述 / 日常操作", "主要来源是人与物的故事"],
  ["本地提取 + 来源", "暂停 / 临时模式不提取"],
  ["按权限检索", "去重 / 人与物品范围"],
  ["组织语言", "本地或获准千问表达"],
  ["纠正 / 忘记", "使旧上下文失效"],
];
memoryLoop.forEach(([title, subtitle], i) => {
  pill("memory-loop-" + i, 88 + i * 290, 2078, 264, 68, title, subtitle);
  if (i < 4) arrow(`M ${358 + i * 290} 2112 H ${371 + i * 290}`);
});
text(
  88,
  2178,
  "历史私人记忆默认本地；逐条获准才可用于云端。本次必要问题仍可能发送给千问。",
  22,
  palette.muted,
);
text(88, 2206, "行动与协作", 23, palette.green, 600);
const actionLoop = [
  ["本次需求", "理解目标与当前物品"],
  ["预览行动卡", "最小摘要 / 不附私人对话"],
  ["用户确认", "确认前不执行业务写入"],
  ["事务复查与执行", "权限 / 身份 / 版本 / 期限"],
  ["真实回执", "结果回到原业务模块"],
];
actionLoop.forEach(([title, subtitle], i) => {
  pill(
    "action-loop-" + i,
    88 + i * 290,
    2222,
    264,
    68,
    title,
    subtitle,
    palette.amber,
  );
  if (i < 4) arrow(`M ${358 + i * 290} 2256 H ${371 + i * 290}`);
});
text(
  88,
  2330,
  "历史提醒请求不会自动执行；家庭事项“已创建”与“已处理”分别呈现。",
  22,
  palette.muted,
);

rect(64, 2402, 1472, 112, palette.ink, palette.ink, 24);
text(
  88,
  2445,
  "工程证据｜88 / 88 测试 · 4组 API 与浏览器旅程",
  30,
  "#ffffff",
  600,
);
text(
  88,
  2487,
  "功能版 a6aa51b：构建 / 类型检查 / 离线基准通过；本次仅整理架构图，未重跑业务测试。",
  23,
  "#d4e4dc",
);
rect(64, 2538, 1472, 104, "#f0f2ee", "#b5c3b9", 20, true);
text(
  88,
  2577,
  "待接入｜真实账户与跨设备家庭 · 识物 / OCR · IoT · 语音 · 后台通知",
  26,
  palette.ink,
  600,
);
text(
  88,
  2615,
  "当前为本机演示；路由与记忆仍有规则边界，引用检查不等于完整语义或实物验证。",
  23,
  palette.muted,
);
text(64, 2688, "仓库  Starry-Curry / ProductAgent", 20, palette.muted);
text(
  1536,
  2688,
  "分支  feat/home-scene-item-companions",
  20,
  palette.muted,
  400,
  "end",
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">物间项目：功能、技术和闭环架构</title><desc id="desc">当前工程的六类产品能力，Next.js、LangGraph、百炼、SQLite 技术分层，以及记忆和行动闭环；底部单独列出待接入能力。</desc>
<defs><marker id="arrow-green" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 z" fill="${palette.green}"/></marker><marker id="arrow-blue" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 z" fill="${palette.blueLine}"/></marker></defs>
<g font-family="'Microsoft YaHei UI','Microsoft YaHei','Segoe UI',sans-serif">${elements.join("\n")}</g></svg>\n`;
mkdirSync(output, { recursive: true });
const svgPath = path.join(output, "project-architecture.svg");
const pngPath = path.join(output, "project-architecture.png");
writeFileSync(svgPath, svg);
const browser = await chromium.launch({
  executablePath:
    process.env.EDGE_PATH ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
let layout;
try {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: scale,
  });
  await page.route(/^https?:/, (route) => route.abort());
  await page.setContent(
    `<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:${palette.paper};}svg{display:block}</style></head><body>${svg}</body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  layout = await page.evaluate(
    ({ width, height }) => {
      const errors = [];
      for (const t of document.querySelectorAll("svg text")) {
        const b = t.getBBox();
        if (
          b.x < 0 ||
          b.y < 0 ||
          b.x + b.width > width ||
          b.y + b.height > height
        )
          errors.push("canvas: " + t.textContent);
      }
      for (const g of document.querySelectorAll("[data-card]")) {
        const r = g.querySelector(":scope > rect").getBBox();
        for (const t of g.querySelectorAll(":scope > text")) {
          const b = t.getBBox();
          if (
            b.x < r.x + 10 ||
            b.y < r.y ||
            b.x + b.width > r.x + r.width - 10 ||
            b.y + b.height > r.y + r.height
          )
            errors.push(g.dataset.card + ": " + t.textContent);
        }
      }
      return {
        textElements: document.querySelectorAll("svg text").length,
        cards: document.querySelectorAll("[data-card]").length,
        overflowErrors: errors,
      };
    },
    { width, height },
  );
  if (layout.overflowErrors.length)
    throw Error(JSON.stringify(layout.overflowErrors));
  await page.locator("svg").screenshot({ path: pngPath });
} finally {
  await browser.close();
}

const validation = JSON.parse(
  readFileSync(
    path.join(
      root,
      "docs/engineering/memory-storytelling-validation-2026-10-18.json",
    ),
    "utf8",
  ),
);
const unchanged = Object.entries(validation.sourceHashes).every(
  ([p, hash]) =>
    createHash("sha256")
      .update(readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n"))
      .digest("hex") === hash,
);
if (!unchanged)
  throw Error(
    "Application changed: review architecture and evidence before publishing this snapshot.",
  );
const manifest = {
  snapshot: "2026-10-18",
  functionalBaseline: "a6aa51b",
  generatedAt: new Date().toISOString(),
  svg: "project-architecture.svg",
  png: "project-architecture.png",
  svgDimensions: { width, height },
  pngDimensions: { width: width * scale, height: height * scale },
  layout,
  matchedApplicationFingerprints: Object.keys(validation.sourceHashes).length,
  applicationTestsRerun: false,
  realModelCalls: 0,
  note: "Code-grounded documentation snapshot. Functional test results are prior a6aa51b evidence; no credentials or user database were read.",
  sha256: Object.fromEntries(
    [svgPath, pngPath].map((p) => [
      path.basename(p),
      createHash("sha256").update(readFileSync(p)).digest("hex"),
    ]),
  ),
};
writeFileSync(
  path.join(output, "render-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify({ svg: svgPath, png: pngPath, ...manifest }));
