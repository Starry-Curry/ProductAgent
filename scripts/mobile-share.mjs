import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMobileQR } from "./mobile-qr.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
if (Number(process.versions.node.split(".")[0]) !== 24)
  throw Error("需要 Node.js 24");
fs.mkdirSync(".runtime/mobile-release/bin", { recursive: true });
const infoFile = ".runtime/mobile-release/share-info.json";
try {
  const existing = JSON.parse(fs.readFileSync(infoFile, "utf8"));
  const response = await fetch(existing.url + "api/demo/session", {
    signal: AbortSignal.timeout(4000),
  });
  if (response.ok && (await response.json()).publicDemo) {
    console.log("分享已在运行：" + existing.url);
    console.log((await createMobileQR(existing.url)).png);
    process.exit(0);
  }
} catch {}
const bin = path.resolve(
  ".runtime/mobile-release/bin",
  process.platform === "win32" ? "cloudflared.exe" : "cloudflared",
);
if (!fs.existsSync(bin)) {
  if (process.platform !== "darwin")
    throw Error(
      "请从 https://developers.cloudflare.com/tunnel/downloads/ 安装 cloudflared 到 " +
        bin,
    );
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const download = await fetch(
    `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${arch}.tgz`,
  );
  if (!download.ok) throw Error("分享组件下载失败，请重试");
  const archive = ".runtime/mobile-release/bin/cloudflared.tgz";
  fs.writeFileSync(archive, Buffer.from(await download.arrayBuffer()));
  if (
    spawnSync("tar", ["-xzf", archive, "-C", ".runtime/mobile-release/bin"], {
      stdio: "inherit",
    }).status !== 0
  )
    throw Error("分享组件解压未完成");
}
if (!fs.existsSync(".next-companion-release/BUILD_ID")) {
  const result = spawnSync(
    process.execPath,
    ["scripts/companion-start.mjs", "build"],
    { stdio: "inherit", env: process.env },
  );
  if (result.status !== 0) throw Error("请先完成应用构建");
}
let server,
  ready = false;
const tunnel = spawn(
  bin,
  [
    "tunnel",
    "--no-autoupdate",
    "--url",
    "http://127.0.0.1:3212",
    "--protocol",
    "http2",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const log = fs.createWriteStream(".runtime/mobile-release/share-tunnel.log", {
  flags: "a",
});
async function start(url) {
  if (ready) return;
  ready = true;
  server = spawn(process.execPath, ["scripts/mobile-demo-start.mjs", url], {
    stdio: "inherit",
    env: process.env,
  });
  server.once("exit", () => tunnel.kill("SIGTERM"));
  const qr = await createMobileQR(url);
  fs.writeFileSync(
    infoFile,
    JSON.stringify({ ...qr, createdAt: new Date().toISOString() }, null, 2),
  );
  console.log(
    "\n手机扫码入口：" +
      qr.url +
      "\n二维码：" +
      qr.png +
      "\n请保持本窗口和电脑运行；重新分享会生成新的二维码。\n",
  );
}
let buffer = "";
for (const output of [tunnel.stdout, tunnel.stderr])
  output.on("data", (data) => {
    log.write(data);
    buffer = (buffer + String(data)).slice(-20000);
    const match = buffer.match(/https:\/\/[a-z-]+\.trycloudflare\.com/);
    if (match)
      void start(match[0]).catch((e) => {
        console.error(e.message);
        tunnel.kill();
        server?.kill();
      });
  });
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    tunnel.kill(signal);
    server?.kill(signal);
  });
tunnel.once("exit", (code) => {
  server?.kill("SIGTERM");
  log.end();
  process.exitCode = code || 0;
});
console.log("正在建立手机 HTTPS 分享入口…");
