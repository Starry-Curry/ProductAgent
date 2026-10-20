import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
export function currentBuildDirectory(root, env = process.env) {
  let selected = env.WUJIAN_BUILD_DIR;
  if (!selected) {
    try {
      selected = JSON.parse(
        fs.readFileSync(
          path.join(root, ".runtime", "latest-life-build.json"),
          "utf8",
        ),
      ).directory;
    } catch {}
  }
  if (selected && !/^\.next(?:-[a-z0-9-]+)?$/.test(selected))
    throw Error("Invalid local build directory");
  return selected || ".next";
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = process.cwd(),
    directory = ".next-rc";
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "build"],
    {
      windowsHide: true,
      stdio: "inherit",
      env: {
        ...process.env,
        WUJIAN_BUILD_DIR: directory,
        AI_ALLOW_PAID_CALLS: "false",
        WUJIAN_ALLOW_PAID_CALLS: "false",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => {
    if (code === 0) {
      fs.mkdirSync(path.join(root, ".runtime"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".runtime", "latest-life-build.json"),
        JSON.stringify({ directory, builtAt: new Date().toISOString() }),
      );
    }
    process.exitCode = code ?? 1;
  });
}
