import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync } from "node:fs";
import path from "node:path";
const root = process.cwd();
mkdirSync(path.join(root, ".runtime"), { recursive: true });
const data = mkdtempSync(path.join(root, ".runtime", "verification-"));
const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const base = "http://127.0.0.1:" + port;
const env = {
  ...process.env,
  AUTH_MODE: "local-demo",
  PRODUCT_AGENT_DATA_DIR: data,
  AI_ALLOW_PAID_CALLS: "false",
  AI_API_KEY: "",
  AI_MODEL: "",
  AI_BASE_URL: "",
  LANGSMITH_TRACING: "false",
  LANGCHAIN_TRACING_V2: "false",
  NEXT_TELEMETRY_DISABLED: "1",
  TEST_BASE_URL: base,
};
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
for (const pipe of [server.stdout, server.stderr])
  pipe.on("data", (d) => {
    logs = (logs + d).slice(-8000);
  });
let started = false;
try {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw Error("Test server exited: " + logs);
    try {
      const r = await fetch(base + "/api/workspace", {
        headers: { "x-demo-actor": "lin" },
      });
      if (r.ok) {
        started = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!started) throw Error("Test server did not become ready: " + logs);
  for (const script of [
    "tests/integration.mjs",
    "tests/foundation-integration.mjs",
    "tests/household-integration.mjs",
  ]) {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      env,
      windowsHide: true,
      stdio: "inherit",
    });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    if (code !== 0) throw Error(script + " failed (" + code + ")");
  }
  console.log(
    JSON.stringify({
      passed: true,
      kind: "isolated-production-server",
      base,
      dataDirectory: data,
      realModelCalls: 0,
    }),
  );
} finally {
  server.kill();
}
