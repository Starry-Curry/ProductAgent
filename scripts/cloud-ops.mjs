process.umask(0o077);
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { lifeDataDirectory } from "../src/lib/life/data-directory.ts";
const root = lifeDataDirectory(),
  command = process.argv[2],
  apply = process.argv.includes("--apply"),
  stopped = process.argv.includes("--server-stopped");
if (process.env.AUTH_MODE !== "public-demo")
  throw Error(
    "Maintenance only supports the explicitly configured public-demo volume",
  );
const hash = (f) =>
  createHash("sha256").update(fs.readFileSync(f)).digest("hex");
function checked(parent, name) {
  if (!/^[a-f0-9]{32}$/.test(name)) throw Error("Invalid visitor identity");
  const target = path.resolve(parent, name);
  if (
    path.dirname(target) !== path.resolve(parent) ||
    fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()
  )
    throw Error("Unsafe maintenance path");
  return target;
}
function healthy(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw Error("Snapshot integrity check failed");
  } finally {
    db.close();
  }
}
if (command === "backup") {
  if (!stopped)
    throw Error(
      "Stop the service first, then pass --server-stopped for a consistent full snapshot",
    );
  const destination = path.join(
    root,
    "backups",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const files = [];
  const sources = [[path.join(root, "visitors.sqlite"), "registry.sqlite"]];
  const parent = path.join(root, "visitors");
  if (fs.existsSync(parent))
    for (const id of fs.readdirSync(parent)) {
      const dir = checked(parent, id);
      const file = path.join(dir, "demo.sqlite");
      if (fs.existsSync(file)) sources.push([file, `${id}.sqlite`]);
    }
  for (const [source, name] of sources) {
    if (!fs.existsSync(source)) continue;
    const db = new DatabaseSync(source);
    const file = path.join(destination, name);
    try {
      db.exec("VACUUM INTO '" + file.replaceAll("'", "''") + "'");
    } finally {
      db.close();
    }
    healthy(file);
    files.push({ name, sha256: hash(file) });
  }
  fs.writeFileSync(
    path.join(destination, "manifest.json"),
    JSON.stringify(
      {
        format: 1,
        aiStopped: fs.existsSync(path.join(root, "AI_STOP")),
        at: new Date().toISOString(),
        files,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      backup: destination,
      databases: files.length,
      containsPrivateDemoData: true,
    }),
  );
} else if (command === "restore") {
  if (!apply || !stopped)
    throw Error(
      "Restore needs --apply --server-stopped and a new empty data volume",
    );
  const index = process.argv.indexOf("--from"),
    source = path.resolve(process.argv[index + 1] || "");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(source, "manifest.json"), "utf8"),
  );
  if (
    manifest.format !== 1 ||
    !Array.isArray(manifest.files) ||
    !manifest.files.some((f) => f.name === "registry.sqlite")
  )
    throw Error("Invalid backup manifest");
  if (
    fs.existsSync(path.join(root, "visitors.sqlite")) ||
    fs.existsSync(path.join(root, "visitors"))
  )
    throw Error(
      "Refusing to overwrite an existing demo volume; restore to a new empty volume",
    );
  for (const f of manifest.files) {
    if (
      !/^(registry|[a-f0-9]{32})\.sqlite$/.test(f.name) ||
      hash(path.join(source, f.name)) !== f.sha256
    )
      throw Error("Snapshot path/hash invalid");
    healthy(path.join(source, f.name));
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const f of manifest.files) {
    const target =
      f.name === "registry.sqlite"
        ? path.join(root, "visitors.sqlite")
        : path.join(
            checked(path.join(root, "visitors"), f.name.slice(0, -7)),
            "demo.sqlite",
          );
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(
      path.join(source, f.name),
      target,
      fs.constants.COPYFILE_EXCL,
    );
  }
  if (manifest.aiStopped)
    fs.writeFileSync(path.join(root, "AI_STOP"), "", { mode: 0o600 });
  console.log(
    JSON.stringify({ restored: true, databases: manifest.files.length }),
  );
} else if (command === "cleanup") {
  const file = path.join(root, "visitors.sqlite");
  if (!fs.existsSync(file)) {
    console.log(JSON.stringify({ expired: 0, applied: false }));
    process.exit(0);
  }
  const db = new DatabaseSync(file);
  try {
    const rows = db
      .prepare("SELECT id FROM visitors WHERE expires<=?")
      .all(Date.now());
    if (apply && !stopped)
      throw Error(
        "Stop service before applying cleanup; --server-stopped is required",
      );
    if (apply)
      for (const { id } of rows) {
        const target = checked(path.join(root, "visitors"), id);
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true });
        db.prepare("DELETE FROM visitors WHERE id=?").run(id);
        db.prepare(
          "DELETE FROM counters WHERE bucket LIKE ? OR bucket=? OR bucket LIKE ?",
        ).run(`http:${id}:%`, `upload:${id}`, `fetch:${id}:%`);
      }
    console.log(
      JSON.stringify({
        expired: rows.length,
        applied: apply,
        backupsRetained: true,
      }),
    );
  } finally {
    db.close();
  }
} else
  throw Error(
    "Use backup --server-stopped; restore --from <snapshot> --apply --server-stopped; cleanup [--apply --server-stopped]",
  );
