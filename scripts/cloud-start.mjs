process.umask(0o077);
import { spawn } from "node:child_process";
import { mkdirSync, accessSync, constants, readFileSync } from "node:fs";
import { lifeDataDirectory } from "../src/lib/life/data-directory.ts";
import { publicOrigin } from "../src/lib/cloud/runtime.ts";
if (Number(process.versions.node.split(".")[0]) !== 24)
  throw Error("Cloud demo requires Node.js 24");
if (
  process.env.AUTH_MODE !== "public-demo" ||
  process.env.WUJIAN_DEPLOYMENT !== "cloud"
)
  throw Error(
    "Set AUTH_MODE=public-demo and WUJIAN_DEPLOYMENT=cloud explicitly",
  );
publicOrigin();
const dir = lifeDataDirectory();
mkdirSync(dir, { recursive: true, mode: 0o700 });
accessSync(dir, constants.W_OK);
if (process.env.DEMO_REQUIRE_VOLUME === "true") {
  if (process.platform !== "linux")
    throw Error(
      "Persistent mount verification requires Linux; local simulations must explicitly set DEMO_REQUIRE_VOLUME=false",
    );
  const mounts = readFileSync("/proc/self/mountinfo", "utf8")
    .split("\n")
    .map((line) => line.split(" ")[4])
    .filter(Boolean)
    .map((p) => p.replace(/\\040/g, " "));
  if (!mounts.some((m) => m !== "/" && (dir === m || dir.startsWith(m + "/"))))
    throw Error(
      "No separate persistent mount detected for the data directory; attach Volume before starting",
    );
}
if (!process.env.DEMO_ACCESS_CODE && process.env.DEMO_OPEN_ACCESS !== "true")
  throw Error(
    "Configure DEMO_ACCESS_CODE, or explicitly permit anonymous DEMO_OPEN_ACCESS=true",
  );
for (const name of [
  "DEMO_GLOBAL_MODEL_CALLS",
  "DEMO_VISITOR_MODEL_CALLS",
  "DEMO_DAILY_TOKEN_BUDGET",
  "DEMO_MODEL_INPUT_BYTES",
  "DEMO_MAX_OUTPUT_TOKENS",
  "DEMO_MODEL_CONCURRENCY",
  "DEMO_REQUESTS_PER_MINUTE",
  "DEMO_MAX_VISITORS",
  "DEMO_TTL_HOURS",
  "DEMO_UPLOAD_BYTES",
  "DEMO_STORAGE_BYTES",
  "DEMO_GLOBAL_STORAGE_BYTES",
  "AI_REQUEST_TIMEOUT_MS",
]) {
  const raw = process.env[name];
  if (
    raw !== undefined &&
    (!Number.isSafeInteger(Number(raw)) || Number(raw) <= 0)
  )
    throw Error("Invalid positive integer configuration: " + name);
}
const paid = process.env.DEMO_AI_ENABLED === "true";
if (
  paid &&
  (!process.env.AI_API_KEY?.trim() ||
    !process.env.AI_BASE_URL ||
    !process.env.AI_MODEL ||
    process.env.AI_ALLOW_PAID_CALLS !== "true" ||
    process.env.WUJIAN_ALLOW_PAID_CALLS !== "true")
)
  throw Error(
    "AI enabled but server key/model/endpoint or explicit payment flags missing",
  );
if (
  paid &&
  new URL(process.env.AI_BASE_URL).href.replace(/\/$/, "") !==
    "https://dashscope.aliyuncs.com/compatible-mode/v1"
)
  throw Error(
    "Public demo is restricted to the Beijing DashScope compatible endpoint",
  );
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("Invalid PORT");
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "0.0.0.0",
    "--port",
    String(port),
  ],
  {
    windowsHide: true,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      AI_API_KEY: process.env.AI_API_KEY || "",
      AI_BASE_URL: process.env.AI_BASE_URL || "",
      AI_MODEL: process.env.AI_MODEL || "",
      AI_ALLOW_PAID_CALLS: paid ? process.env.AI_ALLOW_PAID_CALLS : "false",
      WUJIAN_ALLOW_PAID_CALLS: paid
        ? process.env.WUJIAN_ALLOW_PAID_CALLS
        : "false",
      AI_ENABLE_THINKING: "false",
      AI_JSON_MODE: process.env.AI_JSON_MODE || "true",
      AI_REQUEST_TIMEOUT_MS: process.env.AI_REQUEST_TIMEOUT_MS || "60000",
      WUJIAN_ALLOW_SEARCH: "false",
      LANGSMITH_TRACING: "false",
      LANGCHAIN_TRACING_V2: "false",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);
console.info(
  JSON.stringify({
    event: "cloud_start",
    mode: "public-demo",
    port,
    aiEnabled: paid,
    singleInstance: true,
  }),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    child.kill(signal);
  });
process.on("message", (message) => {
  if (message?.command === "stop-cloud-test") child.kill("SIGTERM");
});
child.on("exit", (code) => process.exit(code ?? 1));
