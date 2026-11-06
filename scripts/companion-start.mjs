import { spawn } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
if (Number(process.versions.node.split(".")[0]) !== 24)
  throw Error("物间需要 Node.js 24，请使用项目提供的运行环境。");
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const command = process.argv[2] || "start",
  cloud = process.argv.includes("--cloud");
if (!["dev", "start", "build"].includes(command))
  throw Error("Use dev, start or build");
const env = {
  ...process.env,
  AUTH_MODE: "local-demo",
  WUJIAN_BUILD_DIR: process.env.WUJIAN_BUILD_DIR || ".next-companion-release",
  PRODUCT_AGENT_DATA_DIR:
    process.env.PRODUCT_AGENT_DATA_DIR || path.join(root, "data-companion-v1"),
  AI_ALLOW_PAID_CALLS: cloud ? "true" : "false",
  WUJIAN_ALLOW_PAID_CALLS: cloud ? "true" : "false",
  AI_VISION_MODEL: process.env.AI_VISION_MODEL || "qwen3-vl-plus",
  WUJIAN_ALLOW_PUBLIC_FETCH: "true",
  WUJIAN_ALLOW_SEARCH: cloud ? "true" : "false",
  WUJIAN_REAL_CATALOG: "true",
  WUJIAN_DEMO_ANSWERS: "true",
  LANGSMITH_TRACING: "false",
  LANGCHAIN_TRACING_V2: "false",
  NEXT_TELEMETRY_DISABLED: "1",
};
const port = process.env.PORT || "3210";
if (command !== "build")
  console.log(
    `物间 App：http://127.0.0.1:${port}/ · ${cloud ? "本次进程启用真实 AI，主动提问会产生服务商费用" : "本地资料模式"} · 数据保存在本机`,
  );
async function run(args) {
  await new Promise((resolve, reject) => {
    const p = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", ...args],
      { cwd: root, env, stdio: "inherit" },
    );
    for (const s of ["SIGINT", "SIGTERM"]) process.once(s, () => p.kill());
    p.once("error", reject);
    p.once("exit", (c) =>
      c === 0 ? resolve() : reject(Error("程序退出，代码 " + c)),
    );
  });
}
try {
  if (
    command === "start" &&
    !existsSync(path.join(env.WUJIAN_BUILD_DIR, "BUILD_ID"))
  )
    await run(["build"]);
  await run([
    command,
    ...(command === "build" ? [] : ["--hostname", "127.0.0.1", "--port", port]),
  ]);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
