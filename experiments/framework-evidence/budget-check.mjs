// Starts the gateway, but deliberately sends no HTTP request.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gateway } from "./gateway.mjs";
import { root, saveReport } from "./shared.mjs";
const configPath = process.argv
  .find((a) => a.startsWith("--config="))
  ?.slice(9);
const file = path.join(root, "live-ledger.json");
const before = fs.readFileSync(file, "utf8");
const g = await gateway({ live: true, configPath });
try {
  await assert.rejects(
    gateway({ live: true, configPath }),
    (error) => error.code === "EEXIST",
  );
  assert.equal(fs.readFileSync(file, "utf8"), before);
} finally {
  await g.close();
}
assert(!fs.existsSync(path.join(root, "live.lock")));
const result = {
  passed: true,
  concurrentLiveProcessRejected: true,
  ledgerUnchanged: true,
  requestsSent: 0,
  taskTotalAttempts: JSON.parse(before).attempts.length,
};
saveReport(path.join(root, "budget-check.json"), result);
console.log(JSON.stringify(result));
