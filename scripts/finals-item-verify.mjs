// Reproducible offline release checks. Every server/fixture uses its own .runtime data.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
const root = process.cwd(),
  out = path.resolve(".runtime/item-v1/final-checks");
fs.mkdirSync(out, { recursive: true });
const npm =
  process.env.npm_execpath ||
  path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
if (!fs.existsSync(npm))
  throw Error("npm CLI path not found; use npm exec to supply npm_execpath");
const env = {
  ...process.env,
  AI_ALLOW_PAID_CALLS: "false",
  WUJIAN_ALLOW_PAID_CALLS: "false",
  WUJIAN_ALLOW_PUBLIC_FETCH: "false",
  WUJIAN_ALLOW_SEARCH: "false",
  AI_API_KEY: "",
  AI_BASE_URL: "",
  AI_MODEL: "",
  AUTH_MODE: "local-demo",
  LANGSMITH_TRACING: "false",
  LANGCHAIN_TRACING_V2: "false",
  NEXT_TELEMETRY_DISABLED: "1",
  EDGE_PATH:
    process.env.EDGE_PATH ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
};
const commands = [
  ["unit", [npm, "test"]],
  ["typecheck", [npm, "run", "typecheck"]],
  ["benchmark", [npm, "run", "test:benchmark"]],
  ["build", [npm, "run", "build"]],
  ["cloud", [npm, "run", "test:cloud"]],
  ["browser-life", [npm, "run", "test:acceptance", "--", "life"]],
  ["browser-core", [npm, "run", "test:acceptance"]],
  ["browser-planning", [npm, "run", "test:task-planning"]],
  ["browser-care", [npm, "run", "test:care"]],
  ["browser-storybook", ["scripts/verify-local.mjs", "storybook"]],
  [
    "pi-poc",
    ["--experimental-strip-types", "experiments/pi-item-loop/poc.mjs"],
  ],
];
const rows = [];
for (const [name, args] of commands) {
  const file = path.join(out, name + ".log"),
    fd = fs.openSync(file, "w"),
    start = Date.now();
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["ignore", fd, fd],
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  fs.closeSync(fd);
  rows.push({
    name,
    command: [process.execPath, ...args],
    exitCode: code,
    elapsedMs: Date.now() - start,
    log: path.relative(root, file),
    realModelRequests: 0,
  });
  fs.writeFileSync(
    path.join(out, "commands.json"),
    JSON.stringify(rows, null, 2) + "\n",
  );
  console.log(JSON.stringify(rows.at(-1)));
  if (code !== 0) process.exit(1);
}
