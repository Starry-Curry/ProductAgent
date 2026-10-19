import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cloudStatus } from "../src/lib/life/provider.ts";

export function launchStatus(env) {
  const status = cloudStatus({ ...env, AI_ALLOW_PAID_CALLS: "false", WUJIAN_ALLOW_PAID_CALLS: "false" });
  return { keyPresent: !!env.AI_API_KEY?.trim(), configured: status.state === "unauthorized", message: status.message };
}
export async function portAvailable(port) {
  const server = createServer();
  return new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
async function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  if (existsSync(path.join(root, ".env.local"))) process.loadEnvFile(path.join(root, ".env.local"));
  const status = launchStatus(process.env);
  console.log(`密钥：${status.keyPresent ? "已配置（不显示内容）" : "未配置"}；云端调用：尚未授权。`);
  console.log("只读取本项目 .env.local，不改写费用配置。退出本次服务即撤销本次进程授权。");
  if (process.argv.includes("--status")) { console.log(status.message); return; }
  const offline = process.argv.includes("--offline");
  if (!offline && !status.configured) { console.log(status.message); console.log("请在本项目 .env.local 配置后重新双击；也可用 START_LIFE.cmd 离线使用。"); return; }
  if (!existsSync(path.join(root, ".next", "BUILD_ID"))) {
    console.log("尚无生产构建，请先运行 npm run build，再重新启动。"); return;
  }
  const port = Number(process.env.PORT || 3200);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("PORT 应为 1024–65535 的端口号");
  if (!(await portAvailable(port))) {
    console.log(`${port} 端口被占用，没有终止任何进程。若是你之前启动的物间，请回原窗口按 Ctrl+C，再双击本启动器。`);
    console.log(`保留原服务时，可在 PowerShell 运行：$env:PORT='3202'; node scripts/life-launch.mjs${offline ? " --offline" : ""}`);
    return;
  }
  if (!offline) {
    console.log("云端模式将把发送的问题、所选物品及获准上下文交给配置的模型服务，按账户计费；不会自动发起测试。Key 已配置不代表同意调用。");
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt.question("仅授权本次运行中的主动 AI 请求？输入 CLOUD 确认，其他输入取消：");
    prompt.close();
    if (answer.trim() !== "CLOUD") { console.log("已取消；未启动云端服务。"); return; }
  }
  console.log(`打开 http://127.0.0.1:${port}；关闭本窗口或 Ctrl+C 停止。`);
  console.log("恢复离线：停止本服务后双击 START_LIFE.cmd，或 node scripts/life-launch.mjs --offline。");
  const child = spawn(process.execPath, ["scripts/life-local.mjs", "start", ...(offline ? [] : ["--cloud"])], {
    cwd: root, windowsHide: true, stdio: "inherit",
    env: { ...process.env, AI_ALLOW_PAID_CALLS: "false", WUJIAN_ALLOW_PAID_CALLS: "false" },
  });
  process.on("SIGINT", () => child.kill());
  process.on("SIGTERM", () => child.kill());
  child.on("exit", code => { process.exitCode = code ?? 1; });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => { console.error("启动未完成，请检查配置、端口和 Node.js 24。没有输出密钥或服务响应。"); process.exitCode = 1; });
