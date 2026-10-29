import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { root, saveReport } from "./shared.mjs";

function scripted(body) {
  const users = body.messages.filter((m) => m.role === "user");
  const question = JSON.stringify(users.at(-1) || "");
  const lastUser = body.messages.findLastIndex((m) => m.role === "user");
  const results = body.messages
    .slice(lastUser + 1)
    .filter((m) => m.role === "tool");
  const last = results.at(-1);
  if (
    !last ||
    (/temporary_tool_failure/.test(JSON.stringify(last)) && results.length < 2)
  ) {
    return {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_" + crypto.randomUUID(),
          type: "function",
          function: {
            name: "read_item",
            arguments: JSON.stringify({
              itemId: /painting/.test(question) ? "painting" : "box",
            }),
          },
        },
      ],
    };
  }
  let data;
  try {
    data = JSON.parse(last.content);
  } catch {
    data = { error: last.content };
  }
  return {
    role: "assistant",
    content:
      "仅依据工具返回：" +
      JSON.stringify(data) +
      "。未记录的属性与关系细节未知。",
  };
}
function send(
  res,
  body,
  message,
  usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
) {
  const id = "chatcmpl-" + crypto.randomUUID();
  const finish = message.tool_calls ? "tool_calls" : "stop";
  if (!body.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id,
        object: "chat.completion",
        created: 1,
        model: body.model,
        choices: [{ index: 0, message, finish_reason: finish }],
        usage,
      }),
    );
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const delta = {
    role: "assistant",
    ...(message.content ? { content: message.content } : {}),
    ...(message.tool_calls
      ? { tool_calls: message.tool_calls.map((t, index) => ({ ...t, index })) }
      : {}),
  };
  for (const choice of [
    { index: 0, delta, finish_reason: null },
    { index: 0, delta: {}, finish_reason: finish },
  ])
    res.write(
      "data: " +
        JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created: 1,
          model: body.model,
          choices: [choice],
        }) +
        "\n\n",
    );
  res.write(
    "data: " +
      JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created: 1,
        model: body.model,
        choices: [],
        usage,
      }) +
      "\n\n",
  );
  res.end("data: [DONE]\n\n");
}
export async function gateway({ live = false, configPath } = {}) {
  const traces = [];
  let config = {};
  const ledgerFile = path.join(root, "live-ledger.json");
  const lockFile = path.join(root, "live.lock");
  let lock;
  let ledger = { maxRequests: 60, maxEstimatedCny: 20, attempts: [] };
  if (live) {
    if (!configPath || path.basename(configPath) !== ".env.local")
      throw Error("Existing .env.local configuration required");
    const raw = fs.readFileSync(configPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) config[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
    if (!config.AI_API_KEY || !config.AI_BASE_URL || !config.AI_MODEL)
      throw Error("credential_or_model_missing");
    const url = new URL(config.AI_BASE_URL);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hostname !== "dashscope.aliyuncs.com"
    )
      throw Error("unexpected_or_unpriced_provider_region");
    if (config.AI_MODEL !== "qwen-plus")
      throw Error("unpriced_model_requires_review");
    // Never reset a ledger or steal a stale process lock automatically.
    lock = fs.openSync(lockFile, "wx", 0o600);
    fs.writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      { flush: true },
    );
    try {
      if (fs.existsSync(ledgerFile))
        ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
    } catch (error) {
      fs.closeSync(lock);
      fs.unlinkSync(lockFile);
      lock = undefined;
      throw error;
    }
  }
  const clean = (value) =>
    live
      ? JSON.parse(
          JSON.stringify(value).replaceAll(
            config.AI_API_KEY,
            "[credential removed]",
          ),
        )
      : value;
  let active = false;
  const server = http.createServer(async (req, res) => {
    try {
      const raw = await new Promise((ok, bad) => {
        let s = "";
        req.on("data", (c) => {
          s += c;
          if (s.length > 200000) bad(Error("payload_too_large"));
        });
        req.on("end", () => ok(s));
      });
      const body = JSON.parse(raw);
      const arm = new URL(req.url, "http://localhost").pathname.split("/")[1];
      let message, usage;
      if (live) {
        if (active) throw Error("single_writer_budget_gateway");
        const spent = ledger.attempts.reduce((s, a) => s + a.estimatedCny, 0);
        if (ledger.attempts.length >= 60 || spent + 1 > 20)
          throw Error("paid_budget_exhausted");
        if (JSON.stringify(body.messages).length > 64000)
          throw Error("input_budget_exceeded");
        active = true;
        const attempt = {
          number: ledger.attempts.length + 1,
          arm,
          model: config.AI_MODEL,
          startedAt: new Date().toISOString(),
          estimatedCny: 1,
          status: "reserved",
          input: clean(body.messages),
        };
        ledger.attempts.push(attempt);
        saveReport(ledgerFile, ledger);
        const start = performance.now();
        try {
          const outbound = {
            ...body,
            model: config.AI_MODEL,
            stream: false,
            max_tokens: Math.min(
              1500,
              body.max_tokens || body.max_completion_tokens || 900,
            ),
            temperature: 0.2,
            enable_thinking: false,
          };
          attempt.effectiveMaxTokens = outbound.max_tokens;
          delete outbound.stream_options;
          delete outbound.max_completion_tokens;
          const response = await fetch(
            config.AI_BASE_URL.replace(/\/$/, "") + "/chat/completions",
            {
              method: "POST",
              headers: {
                Authorization: "Bearer " + config.AI_API_KEY,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(outbound),
              signal: AbortSignal.timeout(45000),
              redirect: "error",
            },
          );
          attempt.httpStatus = response.status;
          const result = await response.json();
          if (!response.ok) throw Error("upstream_http_" + response.status);
          message = result.choices?.[0]?.message;
          usage = result.usage;
          if (!message) throw Error("invalid_upstream_response");
          attempt.status = "returned";
          attempt.finishReason = result.choices[0].finish_reason;
          attempt.output = clean(message);
          attempt.tokens = usage;
          if (
            Number.isFinite(usage?.prompt_tokens) &&
            Number.isFinite(usage?.completion_tokens)
          )
            attempt.estimatedCny =
              (usage.prompt_tokens * 0.8 + usage.completion_tokens * 2) /
              1000000;
        } catch (error) {
          attempt.status = "failed";
          attempt.error = String(error.message).replaceAll(
            config.AI_API_KEY,
            "[removed]",
          );
          throw Error(attempt.error);
        } finally {
          attempt.elapsedMs = Math.round(performance.now() - start);
          saveReport(ledgerFile, ledger);
          active = false;
        }
      } else message = scripted(body);
      traces.push({ arm, input: body.messages, output: message, live });
      send(res, body, message, usage);
    } catch (error) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: String(error.message), type: "lab_error" },
        }),
      );
    }
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    model: live ? config.AI_MODEL : "offline-scripted",
    traces,
    ledger,
    close: () =>
      new Promise((ok) =>
        server.close(() => {
          if (lock !== undefined) {
            fs.closeSync(lock);
            fs.unlinkSync(lockFile);
            lock = undefined;
          }
          ok();
        }),
      ),
  };
}
