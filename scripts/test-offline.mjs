import { spawn } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
mkdirSync(path.join(root, ".runtime"), { recursive: true, mode: 0o700 });

const testFiles = readdirSync(path.join(root, "tests"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
  .map((entry) => path.join("tests", entry.name))
  .sort();

if (!testFiles.length) throw Error("No offline test files found");

const child = spawn(
  process.execPath,
  ["--experimental-strip-types", "--test", ...testFiles],
  {
    cwd: root,
    env: {
      ...process.env,
      AI_ALLOW_PAID_CALLS: "false",
      WUJIAN_ALLOW_PAID_CALLS: "false",
      LANGSMITH_TRACING: "false",
      LANGCHAIN_TRACING_V2: "false",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: "inherit",
    windowsHide: true,
  },
);

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) console.error(`Offline tests stopped by ${signal}`);
  process.exitCode = code ?? 1;
});
