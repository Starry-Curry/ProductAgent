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
export type Provider = {
  model: string;
  generate: (system: string, input: unknown) => Promise<ProviderResult>;
};

export function createProvider(
  env: Record<string, string | undefined> = process.env,
  request: typeof fetch = fetch,
): Provider {
  const { AI_BASE_URL, AI_API_KEY, AI_MODEL } = env;
  return {
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
            // Opt in only after checking this account/model's capabilities.
            ...(env.AI_JSON_MODE === "true"
              ? { response_format: { type: "json_object" } }
              : {}),
          }),
        });
        if (!response.ok)
          throw new ProviderError(
            response.status === 429 ? "rate_limited" : "upstream",
            `模型服务暂不可用（${response.status}），未生成回答。`,
          );
        const result = await response.json();
        const choice = result.choices?.[0];
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
}
