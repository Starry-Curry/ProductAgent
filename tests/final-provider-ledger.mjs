// Test-process instrumentation only. Never import from application code or ship in Docker.
import fs from "node:fs";
import path from "node:path";
const root = process.env.PRODUCT_AGENT_DATA_DIR;
if (
  !root ||
  !path.resolve(root).startsWith(path.resolve(".runtime") + path.sep) ||
  !path.basename(root).startsWith("final-browser-")
)
  throw Error("Synthetic final-browser data directory required");
const original = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (new URL(String(url)).hostname !== "dashscope.aliyuncs.com")
    return original(url, init);
  const file = path.join(root, "model-requests.jsonl"),
    start = Date.now();
  const body = JSON.parse(String(init?.body));
  let input = {};
  try {
    input = JSON.parse(
      body.messages?.find((m) => m.role === "user")?.content || "{}",
    );
  } catch {}
  const row = {
    at: new Date().toISOString(),
    model: body.model,
    vision: JSON.stringify(body.messages || []).includes('"image_url"'),
    toolDefinitions: body.tools?.length || 0,
    inputSummary: {
      question: input.question,
      goal: input.goal,
      personalContext: input.preferences || input.memories || [],
    },
  };
  // Count the attempt before sending; unfinished attempts stay visible after an interruption.
  fs.appendFileSync(file, JSON.stringify({ ...row, state: "started" }) + "\n");
  try {
    const r = await original(url, init),
      d = await r
        .clone()
        .json()
        .catch(() => null);
    row.status = r.status;
    row.usage = d?.usage;
    row.output = d?.choices?.[0]?.message;
    row.errorCode = d?.error?.code;
    return r;
  } catch (e) {
    row.status = "transport-failed";
    row.errorType = e.name;
    row.causeCode = e.cause?.code;
    throw e;
  } finally {
    row.elapsedMs = Date.now() - start;
    fs.appendFileSync(
      file,
      JSON.stringify({ ...row, state: "finished" }) + "\n",
    );
  }
};
