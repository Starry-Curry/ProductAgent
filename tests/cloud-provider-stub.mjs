/** Test-process preload only; explicitly excluded from Docker. Never forwards a model request. */
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL
      ? String(input)
      : input.url,
  );
  if (
    url.hostname === "dashscope.aliyuncs.com" &&
    process.env.WUJIAN_TEST_TOOL_LOOP === "true"
  ) {
    const body = JSON.parse(init.body);
    const tool = body.messages.find((m) => m.role === "tool");
    const item = tool
      ? JSON.parse(tool.content).items?.find((i) => i.name === "合成纸盒")
      : null;
    if (
      tool &&
      (!item?.id ||
        !item.properties ||
        !item.sources?.registration ||
        !item.unknowns)
    )
      throw Error("Missing actual rich item tool result");
    return Response.json({
      choices: [
        {
          finish_reason: tool ? "stop" : "tool_calls",
          message: tool
            ? {
                role: "assistant",
                content: JSON.stringify({
                  kind: "general",
                  answer:
                    "合成离线工具往返：" +
                    item.name +
                    "。登记条件仍需核对，先坐下休息。",
                  itemIds: [item.id],
                  factIds: [],
                  procedureId: null,
                  questions: [],
                }),
              }
            : {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "list-fixture",
                    type: "function",
                    function: {
                      name: "list_accessible_items",
                      arguments: JSON.stringify({ limit: 40 }),
                    },
                  },
                ],
              },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
  }
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
