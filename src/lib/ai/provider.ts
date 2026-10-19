export class ProviderError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export type ProviderResult = {
  text: string;
  model: string;
  tokens: { input: number; output: number } | null;
};
export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};
export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
export type ModelResponse = ProviderResult & {
  toolCalls: ToolCall[];
  finishReason: string;
};
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};
export type Provider = {
  ready?: boolean;
  complete?: (
    messages: ModelMessage[],
    tools: ToolDefinition[],
    options?: { timeoutMs: number },
  ) => Promise<ModelResponse>;
  model: string;
  generate: (system: string, input: unknown) => Promise<ProviderResult>;
};

export function createProvider(
  env: Record<string, string | undefined> = process.env,
  request: typeof fetch = fetch,
): Provider {
  const { AI_BASE_URL, AI_API_KEY, AI_MODEL } = env;
  const provider: Provider = {
    ready: !!AI_BASE_URL && !!AI_API_KEY?.trim() && !!AI_MODEL && env.AI_ALLOW_PAID_CALLS === "true",
    model: AI_MODEL || "unconfigured",
    async generate(system, input) {
      if (!AI_BASE_URL || !AI_API_KEY || !AI_MODEL)
        throw new ProviderError(
          "not_configured",
          "千问尚未配置。当前精选指导可用，但不是模型回答。",
        );
      if (env.AI_ALLOW_PAID_CALLS !== "true")
        throw new ProviderError(
          "payment_not_authorized",
          "真实模型调用尚未获费用授权，本次没有发送请求。",
        );
      let url: URL;
      try {
        url = new URL(AI_BASE_URL.replace(/\/$/, "") + "/chat/completions");
      } catch {
        throw new ProviderError("configuration", "模型地址配置无效。");
      }
      if (url.protocol !== "https:" || url.username || url.password)
        throw new ProviderError(
          "configuration",
          "模型地址必须使用 HTTPS，且不能包含账号信息。",
        );
      try {
        const response = await request(url, {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${AI_API_KEY}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(30000),
          body: JSON.stringify({
            model: AI_MODEL,
            messages: [
              { role: "system", content: system },
              { role: "user", content: JSON.stringify(input) },
            ],
            max_tokens: 1500,
            ...(env.AI_ENABLE_THINKING === "false" ? { enable_thinking: false } : {}),
            // Opt in only after checking this account/model's capabilities.
            ...(env.AI_JSON_MODE === "true"
              ? { response_format: { type: "json_object" } }
              : {}),
          }),
        });
        if (!response.ok)
          throw new ProviderError(
            response.status === 401 ? "authentication" : response.status === 403 ? "permission" : response.status === 429 ? "rate_limited" : "upstream",
            `请求失败：模型服务返回 ${response.status}，请核对账户权限或稍后重试。`,
          );
        const result = await response.json().catch(() => { throw new ProviderError("invalid_response", "请求失败：模型服务返回了无效 JSON。"); });
        const choice = result?.choices?.[0];
        if (
          choice?.finish_reason !== "stop" ||
          typeof choice?.message?.content !== "string" ||
          !choice.message.content.trim() ||
          choice.message.content.length > 12000
        )
          throw new ProviderError(
            "invalid_response",
            "模型未返回完整有效回答，请重试。",
          );
        const u = result.usage;
        const tokens =
          u &&
          Number.isSafeInteger(u.prompt_tokens) &&
          u.prompt_tokens >= 0 &&
          Number.isSafeInteger(u.completion_tokens) &&
          u.completion_tokens >= 0
            ? { input: u.prompt_tokens, output: u.completion_tokens }
            : null;
        return { text: choice.message.content, model: AI_MODEL, tokens };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        const timeout =
          error instanceof Error &&
          ["TimeoutError", "AbortError"].includes(error.name);
        throw new ProviderError(
          timeout ? "timeout" : "network",
          timeout
            ? "模型请求超时，请稍后重试。"
            : "模型连接或响应失败，请稍后重试。",
        );
      }
    },
  };
  provider.complete = (messages, tools, options) =>
    completeModel(env, request, messages, tools, options);
  return provider;
}

async function completeModel(
  env: Record<string, string | undefined>,
  request: typeof fetch,
  messages: ModelMessage[],
  tools: ToolDefinition[],
  options?: { timeoutMs: number },
): Promise<ModelResponse> {
  if (!env.AI_BASE_URL || !env.AI_API_KEY || !env.AI_MODEL)
    throw new ProviderError(
      "not_configured",
      "云端 AI 尚未配置，可以先核对资料或记录尝试。",
    );
  if (env.AI_ALLOW_PAID_CALLS !== "true")
    throw new ProviderError(
      "payment_not_authorized",
      "云端模型调用未开启；本次没有发送请求。",
    );
  let url: URL;
  try {
    url = new URL(env.AI_BASE_URL.replace(/\/$/, "") + "/chat/completions");
  } catch {
    throw new ProviderError("configuration", "模型地址配置无效。");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new ProviderError(
      "configuration",
      "模型地址须为不含账号信息的 HTTPS 地址。",
    );
  try {
    const response = await request(url, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer " + env.AI_API_KEY,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(
        Math.max(1, Math.min(25000, options?.timeoutMs ?? 25000)),
      ),
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages,
        ...(tools.length ? { tools, tool_choice: "auto" } : {}),
        max_tokens: 1500,
        ...(env.AI_ENABLE_THINKING === "true" ||
        env.AI_ENABLE_THINKING === "false"
          ? { enable_thinking: env.AI_ENABLE_THINKING === "true" }
          : {}),
        // DashScope tool selection must use its native protocol.
        // The graph still validates the final JSON packet server-side.
        ...(env.AI_JSON_MODE === "true" && !tools.length
          ? { response_format: { type: "json_object" } }
          : {}),
      }),
    });
    if (!response.ok)
      throw new ProviderError(
        response.status === 401
          ? "authentication"
          : response.status === 403
            ? "permission"
            : response.status === 429
              ? "rate_limited"
              : "upstream",
        "请求失败：模型服务暂不可用（" +
          response.status +
          "），请核对账户配置或稍后重试。",
      );
    const data = await response.json().catch(() => { throw new ProviderError("invalid_response", "请求失败：模型服务返回了无效 JSON。"); });
    const choice = data?.choices?.[0];
    const calls = choice?.message?.tool_calls ?? [];
    if (!choice?.message || !["stop", "tool_calls"].includes(choice.finish_reason))
      throw new ProviderError(
        "invalid_response",
        "模型输出不完整，本次没有展示操作建议。",
      );
    if (
      calls !== undefined &&
      (!Array.isArray(calls) ||
        calls.length > 6 ||
        !calls.every(
          (c: ToolCall) =>
            c?.type === "function" &&
            typeof c.id === "string" &&
            c.id.length <= 100 &&
            typeof c.function?.name === "string" &&
            typeof c.function.arguments === "string" &&
            c.function.arguments.length <= 4000,
        ))
    )
      throw new ProviderError("invalid_response", "模型工具请求格式无效。");
    const text = choice.message.content ?? "";
    if (
      typeof text !== "string" ||
      text.length > 12000 ||
      (!text.trim() && !calls?.length)
    )
      throw new ProviderError("invalid_response", "模型没有返回可用内容。");
    const u = data.usage;
    const tokens =
      u &&
      Number.isSafeInteger(u.prompt_tokens) &&
      u.prompt_tokens >= 0 &&
      Number.isSafeInteger(u.completion_tokens) &&
      u.completion_tokens >= 0
        ? { input: u.prompt_tokens, output: u.completion_tokens }
        : null;
    return {
      text,
      model: env.AI_MODEL,
      tokens,
      toolCalls: calls || [],
      finishReason: choice.finish_reason,
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name)
        ? "timeout"
        : "network",
      "请求失败：模型连接未完成（网络或超时），可以保留问题后重试。",
    );
  }
}
