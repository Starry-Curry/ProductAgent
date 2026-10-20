/** Test-process preload only; explicitly excluded from Docker. Never forwards a model request. */
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL
      ? String(input)
      : input.url,
  );
  if (url.hostname === "dashscope.aliyuncs.com")
    return Response.json({
      model: "offline-cloud-stub",
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: JSON.stringify({
              kind: "general",
              answer:
                "合成离线替身：可以先坐一会儿，喝水或伸展由你按实际情况选择；不需要围绕物品聊天。",
              factIds: [],
              procedureId: null,
              questions: [],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
  return original(input, init);
};
