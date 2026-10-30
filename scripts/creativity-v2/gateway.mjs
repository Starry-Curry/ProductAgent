// The application receives a fake key. Only this local process authenticates to the existing provider.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
export async function gateway(configPath) {
  if (!configPath || path.basename(configPath) !== ".env.local")
    throw Error("existing_local_configuration_required");
  const config = {};
  for (const line of fs.readFileSync(configPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) config[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  if (!config.AI_API_KEY || !config.AI_BASE_URL || !config.AI_MODEL)
    throw Error("credential_or_model_missing");
  const remote = new URL(config.AI_BASE_URL);
  if (
    remote.protocol !== "https:" ||
    remote.hostname !== "dashscope.aliyuncs.com" ||
    remote.username ||
    remote.password ||
    remote.search
  )
    throw Error("unexpected_provider_configuration");
  const modelResponse = await fetch(
    config.AI_BASE_URL.replace(/\/$/, "") + "/models",
    {
      headers: { Authorization: "Bearer " + config.AI_API_KEY },
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    },
  );
  const modelData = await modelResponse.json().catch(() => ({}));
  const available = (modelData.data || [])
    .map((m) => m.id)
    .filter((id) => typeof id === "string");
  const root = path.resolve("../creativity-v2-evidence");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "model-availability.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        httpStatus: modelResponse.status,
        ids: available,
      },
      null,
      2,
    ),
  );
  const file = path.join(root, "model-calls.json"),
    lockFile = path.join(root, "gateway.lock"),
    lock = fs.openSync(lockFile, "wx");
  fs.writeFileSync(
    lock,
    JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
  );
  const ledger = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { task: "creativity-engine-v2", attempts: [] };
  // Keep prior-stage attempts intact. All new continuous-development phases
  // share one 150-call / CNY50 ceiling, including failures and retries.
  const stage = "creativity-engine-v2";
  if (config.AI_MODEL !== "qwen-plus") throw Error("budget_model_not_priced");
  const stageSpend = () => ledger.attempts.filter((a) => a.stage === stage);
  const clean = (value) =>
    JSON.parse(
      JSON.stringify(value).replaceAll(config.AI_API_KEY, "[removed]"),
    );
  const save = () =>
    fs.writeFileSync(file, JSON.stringify(clean(ledger), null, 2) + "\n");
  const server = http.createServer(async (req, res) => {
    let attempt;
    try {
      if (
        req.headers.origin ||
        req.headers.authorization !== "Bearer fixture-only" ||
        req.method !== "POST"
      )
        throw Error("isolated_provider_required");
      let raw = "";
      for await (const c of req) {
        raw += c;
        if (Buffer.byteLength(raw) > 180000) throw Error("input_too_large");
      }
      const body = JSON.parse(raw);
      if (
        ![
          config.AI_MODEL,
          "qwen-max",
          ...(available.includes("qwen3.7-plus") ? ["qwen3.7-plus"] : []),
        ].includes(body.model) ||
        body.stream
      )
        throw Error("configured_nonstream_model_only");
      const maxTokens = Math.min(body.max_tokens || 4000, 4000);
      // UTF-8 byte count bounds input tokens; highest published Plus tier is
      // reserved until actual usage arrives. An unknown failed charge stays reserved.
      const reserve =
        (Buffer.byteLength(raw) * 8 +
          (maxTokens + (body.enable_thinking ? 2048 : 0)) * 64) /
        1e6;
      if (
        stageSpend().length >= 150 ||
        stageSpend().reduce(
          (n, a) => n + (a.estimatedCny ?? a.reservedCny),
          0,
        ) +
          reserve >
          50
      )
        throw Error("stage_budget_exhausted");
      const user = body.messages?.find((m) => m.role === "user");
      let question = "";
      try {
        question =
          JSON.parse(user.content).question ||
          JSON.parse(user.content).goal ||
          "";
      } catch {
        question = String(user?.content || "").slice(0, 2000);
      }
      attempt = {
        number: ledger.attempts.length + 1,
        stage,
        reservedCny: reserve,
        priceSource: "https://help.aliyun.com/zh/model-studio/model-pricing",
        startedAt: new Date().toISOString(),
        model: body.model,
        enableThinking: body.enable_thinking === true,
        status: "started",
        question,
        inputSha256: createHash("sha256").update(raw).digest("hex"),
        inputBytes: Buffer.byteLength(raw),
        input: clean(body.messages),
        tools: (body.tools || []).map((t) => t.function.name),
      };
      ledger.attempts.push(attempt);
      save();
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      const response = await fetch(
        config.AI_BASE_URL.replace(/\/$/, "") + "/chat/completions",
        {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: "Bearer " + config.AI_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...body,
            max_tokens: maxTokens,
            enable_thinking: body.enable_thinking === true,
            ...(body.enable_thinking === true
              ? {
                  stream: true,
                  stream_options: { include_usage: true },
                  thinking_budget: 2048,
                }
              : {}),
          }),
          signal: AbortSignal.any([
            AbortSignal.timeout(body.enable_thinking ? 85000 : 65000),
            controller.signal,
          ]),
        },
      );
      attempt.httpStatus = response.status;
      let result;
      if (body.enable_thinking === true && response.ok) {
        let text = "",
          usage,
          finishReason,
          buffer = "";
        const decoder = new TextDecoder();
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let end;
          while ((end = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, end).trim();
            buffer = buffer.slice(end + 1);
            if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
            const event = JSON.parse(line.slice(6));
            if (event.usage) usage = event.usage;
            text += event.choices?.[0]?.delta?.content || "";
            if (event.choices?.[0]?.finish_reason)
              finishReason = event.choices[0].finish_reason;
          }
        }
        result = {
          choices: [
            {
              message: { role: "assistant", content: text },
              finish_reason: finishReason,
            },
          ],
          usage,
          model: body.model,
        };
      } else result = await response.json();
      if (!response.ok) throw Error("provider_http_" + response.status);
      attempt.status = "returned";
      attempt.tokens = result.usage;
      attempt.returnedModel = result.model;
      if (
        Number.isFinite(result.usage?.prompt_tokens) &&
        Number.isFinite(result.usage?.completion_tokens)
      ) {
        const input = result.usage.prompt_tokens,
          output = result.usage.completion_tokens;
        const [inputRate, outputRate] =
          body.model === "qwen3.7-plus"
            ? [2, 8]
            : body.model === "qwen-max"
              ? [2.4, 9.6]
              : input <= 128000
                ? [0.8, body.enable_thinking ? 8 : 2]
                : input <= 256000
                  ? [2.4, 20]
                  : [4.8, 48];
        attempt.estimatedCny = (input * inputRate + output * outputRate) / 1e6;
      }
      attempt.finishReason = result.choices?.[0]?.finish_reason;
      attempt.output = clean(result.choices?.[0]?.message || {});
      attempt.elapsedMs = Date.now() - Date.parse(attempt.startedAt);
      save();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      if (attempt) {
        attempt.status = "failed";
        attempt.transportCode = e.cause?.code || e.name;
        attempt.error = String(e.message).replaceAll(
          config.AI_API_KEY,
          "[removed]",
        );
        attempt.elapsedMs = Date.now() - Date.parse(attempt.startedAt);
        save();
      }
      if (!res.headersSent)
        res.writeHead(attempt?.httpStatus >= 400 ? attempt.httpStatus : 503, {
          "content-type": "application/json",
        });
      res.end(
        JSON.stringify({
          error: { message: attempt?.error || "isolated_gateway_rejected" },
        }),
      );
    }
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    model: config.AI_MODEL,
    available,
    close: () =>
      new Promise((ok) =>
        server.close(() => {
          fs.closeSync(lock);
          fs.unlinkSync(lockFile);
          ok();
        }),
      ),
  };
}
