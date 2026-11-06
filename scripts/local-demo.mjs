import { spawn } from "node:child_process";
const command = process.argv[2];
if (!["dev", "start"].includes(command)) throw Error("Use dev or start");
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    command,
    "--hostname",
    "127.0.0.1",
    "--port",
    process.env.PORT || "3100",
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      AUTH_MODE: "local-demo",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
child.on("exit", (code) => process.exit(code ?? 1));
