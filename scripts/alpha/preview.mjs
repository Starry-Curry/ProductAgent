// Alpha preview always uses a separate synthetic data directory.
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { gateway } from "./gateway.mjs";
const project = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(project);
const cloud = process.argv.includes("--cloud");
if (cloud && !process.argv.includes("--live-max=100-cny=20"))
  throw Error(
    "本轮云端体验须明确 --live-max=100-cny=20，沿用累计台账，不能重置预算。",
  );
const port =
  process.argv.find((s) => s.startsWith("--port="))?.slice(7) || "3201";
if (!/^\d{4,5}$/.test(port) || +port > 65535) throw Error("Invalid local port");
const gate = cloud
  ? await gateway({
      live: true,
      configPath: process.argv.find((s) => s.startsWith("--config="))?.slice(9),
    })
  : undefined;
const env = {
  ...process.env,
  AUTH_MODE: "local-demo",
  PRODUCT_AGENT_DATA_DIR: path.join(project, ".runtime/alpha-preview"),
  AI_ALLOW_PAID_CALLS: cloud ? "true" : "false",
  WUJIAN_ALLOW_PAID_CALLS: cloud ? "true" : "false",
  AI_BASE_URL: cloud ? "https://fixture.invalid/v1" : "",
  AI_API_KEY: cloud ? "fixture-only" : "",
  AI_MODEL: gate?.model || "",
  AI_JSON_MODE: "true",
  AI_ENABLE_THINKING: "false",
  WUJIAN_ALLOW_PUBLIC_FETCH: "false",
  LANGSMITH_TRACING: "false",
  LANGCHAIN_TRACING_V2: "false",
  NEXT_TELEMETRY_DISABLED: "1",
  ...(gate ? { ALPHA_GATEWAY: gate.url } : {}),
};
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
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  { cwd: project, env, windowsHide: true, stdio: "inherit" },
);
console.log(
  `物间 Alpha：http://127.0.0.1:${port}；独立合成数据；${cloud ? "本轮累计100次/20元网关生效" : "真实模型关闭"}`,
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill();
  if (gate) await gate.close();
}
process.on("SIGINT", () => {
  stop().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  stop().then(() => process.exit(0));
});
child.on("exit", async (code) => {
  await stop();
  process.exit(code || 0);
});
