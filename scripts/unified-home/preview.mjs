import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gateway } from "./gateway.mjs";
const project = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(project);
const cloud = process.argv.includes("--cloud"),
  dev = process.argv.includes("--dev");
const config = process.argv.find((a) => a.startsWith("--config="))?.slice(9);
const port =
  process.argv.find((a) => a.startsWith("--port="))?.slice(7) || "3204";
if (!/^\d{4,5}$/.test(port) || +port > 65535) throw Error("invalid_port");
const gate = cloud ? await gateway(config) : undefined;
const child = spawn(
  process.execPath,
  [
    ...(gate
      ? [
          "--import",
          pathToFileURL(path.join(project, "scripts/alpha/network-hook.mjs"))
            .href,
        ]
      : []),
    "node_modules/next/dist/bin/next",
    dev ? "dev" : "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    cwd: project,
    windowsHide: true,
    stdio: "inherit",
    env: {
      ...process.env,
      PRODUCT_AGENT_DATA_DIR: path.join(project, ".runtime/home-preview"),
      AUTH_MODE: "local-demo",
      AI_ALLOW_PAID_CALLS: cloud ? "true" : "false",
      WUJIAN_ALLOW_PAID_CALLS: cloud ? "true" : "false",
      AI_API_KEY: cloud ? "fixture-only" : "",
      AI_BASE_URL: "https://fixture.invalid/v1",
      AI_MODEL: gate?.model || "",
      AI_CREATIVE_MODEL:
        process.argv
          .find((a) => a.startsWith("--creative-model="))
          ?.slice(17) ||
        gate?.model ||
        "",
      AI_TASK_MODEL:
        process.argv.find((a) => a.startsWith("--task-model="))?.slice(13) ||
        gate?.model ||
        "",
      AI_JSON_MODE: "true",
      AI_ENABLE_THINKING: "false",
      AI_TIMEOUT_MS: "60000",
      ALPHA_GATEWAY: gate?.url,
      WUJIAN_ALLOW_PUBLIC_FETCH: "true",
      LANGSMITH_TRACING: "false",
      LANGCHAIN_TRACING_V2: "false",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);
console.log(
  `物间统一家庭：http://127.0.0.1:${port}；仅独立合成数据；${cloud ? "真实模型已授权，基本调用记录开启" : "模型关闭"}`,
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill();
  if (gate) await gate.close();
}
process.on("SIGINT", () => stop().then(() => process.exit(0)));
process.on("SIGTERM", () => stop().then(() => process.exit(0)));
child.on("exit", (code) => stop().then(() => process.exit(code || 0)));
