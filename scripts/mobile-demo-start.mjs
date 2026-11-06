import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
process.umask(0o077);
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
if (Number(process.versions.node.split(".")[0]) !== 24)
  throw Error("需要 Node.js 24");
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const publicURL = new URL(process.argv[2] || "");
if (
  publicURL.protocol !== "https:" ||
  publicURL.username ||
  publicURL.password ||
  publicURL.pathname !== "/"
)
  throw Error("需要 HTTPS 演示域名");
const env = {
  ...process.env,
  AUTH_MODE: "public-demo",
  WUJIAN_DEPLOYMENT: "cloud",
  APP_PUBLIC_ORIGIN: publicURL.origin,
  WUJIAN_BUILD_DIR: process.env.WUJIAN_BUILD_DIR || ".next-companion-release",
  PRODUCT_AGENT_DATA_DIR: process.env.WUJIAN_HOST_DATA_DIR || path.join(
    root,
    ".runtime/mobile-release/public-data",
  ),
  WUJIAN_MOBILE_DEMO: "true",
  WUJIAN_REAL_CATALOG: "true",
  WUJIAN_DEMO_ANSWERS: "true",
  DEMO_OPEN_ACCESS: "true",
  DEMO_AI_ENABLED: "true",
  DEMO_ALLOW_VISION: "true",
  DEMO_GLOBAL_MODEL_CALLS: "300",
  DEMO_VISITOR_MODEL_CALLS: "40",
  DEMO_DAILY_TOKEN_BUDGET: "3000000",
  DEMO_TTL_HOURS: "72",
  DEMO_MAX_VISITORS: "30",
  DEMO_MODEL_CONCURRENCY: "2",
  DEMO_REQUESTS_PER_MINUTE: "120",
  DEMO_MODEL_INPUT_BYTES: "120000",
  DEMO_VISION_INPUT_BYTES: "2500000",
  DEMO_MAX_OUTPUT_TOKENS: "2000",
  DEMO_GLOBAL_STORAGE_BYTES: "1000000000",
  DEMO_STORAGE_BYTES: "100000000",
  AI_ALLOW_PAID_CALLS: "true",
  WUJIAN_ALLOW_PAID_CALLS: "true",
  AI_VISION_MODEL: process.env.AI_VISION_MODEL || "qwen3-vl-plus",
  AI_MODEL: process.env.AI_MODEL || "qwen-plus",
  AI_BASE_URL:
    process.env.AI_BASE_URL ||
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
  AI_ENABLE_THINKING: "false",
  AI_REQUEST_TIMEOUT_MS: "20000",
  WUJIAN_ALLOW_PUBLIC_FETCH: "false",
  WUJIAN_ALLOW_SEARCH: "false",
  LANGSMITH_TRACING: "false",
  LANGCHAIN_TRACING_V2: "false",
  NEXT_TELEMETRY_DISABLED: "1",
};
if (!env.AI_API_KEY?.trim()) throw Error("本机尚未配置模型密钥");
const port = process.env.PORT || "3212";
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  { cwd: root, env, stdio: "inherit" },
);
console.log(`物间手机版：${publicURL.origin}/ · 独立访客空间 · 启用真实 AI`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => child.kill(signal));
child.on("exit", (code) => (process.exitCode = code ?? 1));
