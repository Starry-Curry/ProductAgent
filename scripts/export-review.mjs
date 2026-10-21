import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
if (git("status", "--porcelain", "--untracked-files=no"))
  throw Error("Commit tracked changes before exporting a review ZIP.");
const commit = git("rev-parse", "HEAD"),
  branch = git("branch", "--show-current");
const files = git("-c", "core.quotepath=false", "ls-files").split("\n");
const forbidden = files.filter(
  (p) =>
    /(^|\/)(node_modules|data|\.runtime|\.next|secrets)(\/|$)|(^|\/)api\.txt$|\.(sqlite(?:[-.].*)?|sqlite3(?:[-.].*)?|db(?:[-.].*)?|gguf|safetensors|key|pem|pfx|p12)$/i.test(
      p,
    ) ||
    (/(^|\/)\.env(?:\.|$)/i.test(p) && !/(^|\/)\.env\.example$/i.test(p)),
);
if (forbidden.length)
  throw Error("Forbidden tracked paths; review exclusions before export.");
const dir = path.resolve(".runtime/exports");
mkdirSync(dir, { recursive: true });
const zip = path.join(
  dir,
  "ProductAgent-Review-" +
    new Date().toISOString().slice(0, 10).replaceAll("-", "") +
    "-" +
    commit.slice(0, 7) +
    ".zip",
);
execFileSync(
  "git",
  [
    "archive",
    "--format=zip",
    "--prefix=ProductAgent/",
    "--output=" + zip,
    commit,
  ],
  { windowsHide: true },
);
const sha256 = createHash("sha256").update(readFileSync(zip)).digest("hex");
writeFileSync(
  zip + ".json",
  JSON.stringify(
    {
      commit,
      branch,
      sha256,
      contents:
        "tracked source, lockfile, tests, engineering documents and sanitized validation reports",
      excluded:
        "local credentials, databases, runtime, dependencies, build cache, untracked private files",
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ zip, commit, branch, sha256 }));
