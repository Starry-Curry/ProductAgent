// Only loaded by the explicitly authorized, isolated browser test child process.
import fs from "node:fs";
import path from "node:path";
if (process.env.CARE_LIVE_BROWSER_APPROVED !== "30-synthetic-only")
  throw Error("Live browser meter requires explicit test authorization");
const file = path.resolve(".runtime/care-live-20261021/ledger.json");
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  if (url.hostname !== "dashscope.aliyuncs.com") return originalFetch(input, init);
  const ledger = JSON.parse(fs.readFileSync(file, "utf8"));
  if (ledger.maxRequests !== 30 || ledger.requests.length >= 30)
    throw Error("Current test budget exhausted; no model request sent");
  const body = JSON.parse(String(init?.body || "{}"));
  const row = { number: ledger.requests.length + 1, case: "browser-care-files", at: new Date().toISOString(), model: body.model, status: "pending" };
  ledger.requests.push(row);
  fs.writeFileSync(file, JSON.stringify(ledger, null, 2), { mode: 0o600 });
  const started = Date.now();
  try {
    const response = await originalFetch(input, init);
    const data = await response.clone().json().catch(() => null);
    row.status = response.status;
    row.tokens = data?.usage || null;
    row.output = data?.choices?.[0]?.message || null;
    return response;
  } catch (error) {
    row.status = "transport-failed";
    row.errorType = error.name;
    throw error;
  } finally {
    row.elapsedMs = Date.now() - started;
    const latest = JSON.parse(fs.readFileSync(file, "utf8"));
    latest.requests = latest.requests.map((r) => r.number === row.number ? row : r);
    fs.writeFileSync(file, JSON.stringify(latest, null, 2), { mode: 0o600 });
  }
};
