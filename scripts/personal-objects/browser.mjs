import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { gateway } from "./gateway.mjs";
import { root, saveReport } from "./shared.mjs";
if (
  process.argv.includes("--live") &&
  !process.argv.includes("--live-max=40-cny=10")
)
  throw Error("Explicit task budget flag required");
const live = process.argv.includes("--live");
const gate = await gateway({
  live,
  configPath: process.argv.find((s) => s.startsWith("--config="))?.slice(9),
});
const socket = createServer();
await new Promise((ok) => socket.listen(0, "127.0.0.1", ok));
const port = socket.address().port;
await new Promise((ok) => socket.close(ok));
const base = "http://127.0.0.1:" + port;
const data = mkdtempSync(path.resolve(".runtime/personal-browser-"));
const env = {
  ...process.env,
  PRODUCT_AGENT_DATA_DIR: data,
  AUTH_MODE: "local-demo",
  AI_ALLOW_PAID_CALLS: live ? "true" : "false",
  WUJIAN_ALLOW_PAID_CALLS: live ? "true" : "false",
  AI_BASE_URL: "https://fixture.invalid/v1",
  AI_API_KEY: "fixture-only",
  AI_MODEL: gate.model,
  AI_ENABLE_THINKING: "false",
  AI_JSON_MODE: "true",
  WUJIAN_ALLOW_PUBLIC_FETCH: "false",
  LANGSMITH_TRACING: "false",
  LANGCHAIN_TRACING_V2: "false",
  NEXT_TELEMETRY_DISABLED: "1",
  ALPHA_GATEWAY: gate.url,
  TEST_BASE_URL: base,
  ALPHA_LIVE: live ? "true" : "false",
  PERSONAL_OBJECTS_LEDGER: path.join(root, "live-ledger.json"),
};
const app = spawn(
  process.execPath,
  [
    "--import",
    pathToFileURL(path.resolve("scripts/alpha/network-hook.mjs")).href,
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
for (const pipe of [app.stdout, app.stderr])
  pipe.on("data", (d) => (logs = (logs + d).slice(-10000)));
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((ok) => setTimeout(ok, 500));
  }
  if (!ready) throw Error("App unavailable " + logs);
  const child = spawn(
    process.execPath,
    ["tests/personal-objects-integration.mjs"],
    {
      env,
      windowsHide: true,
      stdio: "inherit",
    },
  );
  const code = await new Promise((ok) => child.on("exit", ok));
  if (code !== 0) throw Error("Browser test failed " + code);
  saveReport(path.join(root, "browser-live-server.json"), {
    passed: true,
    port,
    data,
    logs,
    requests: gate.ledger.attempts.length,
  });
} finally {
  app.kill();
  await gate.close();
}
