import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lifeDataDirectory } from "../src/lib/life/data-directory.ts";
const command = process.argv[2];
if (!["dev", "start", "build"].includes(command))
  throw Error("Use dev, start or build");
const workspace = fileURLToPath(new URL("../", import.meta.url));
const dir = lifeDataDirectory(process.env, workspace);
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    command,
    ...(command === "build"
      ? []
      : ["--hostname", "127.0.0.1", "--port", process.env.PORT || "3200"]),
  ],
  {
    cwd: workspace,
    windowsHide: true,
    stdio: "inherit",
    env: {
      ...process.env,
      AUTH_MODE: "local-demo",
      PRODUCT_AGENT_DATA_DIR: dir,
      AI_ALLOW_PAID_CALLS: "false",
      WUJIAN_ALLOW_PAID_CALLS: "false",
      LANGSMITH_TRACING: "false",
      LANGCHAIN_TRACING_V2: "false",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);
console.log("物间新版：独立数据目录", path.resolve(dir), "；真实模型费用关闭");
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
child.on("exit", (code) => process.exit(code ?? 1));
