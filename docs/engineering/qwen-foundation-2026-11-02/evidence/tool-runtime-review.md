# AgentScope 正式工具循环适配切片

日期：2026-11-02。本切片的 11 项测试全部为**模型替身/合成资源**；没有真实 Qwen 请求、外部联网或设备操作，不构成产品智能验收。

`src/lib/agent/tool-runtime.ts` 使用真实 AgentScope 0.0.15 `Agent` / `Toolkit` / `ChatModelBase`，由调用者的现有 Provider 回调生成模型响应。没有实现第二个循环、框架个人存储、compression、structuredModel、二次语义审核或自动重试。

接口为 `runToolAgent({system,messages,tools,generate,guard,onEvent,stopAfterTool}) → {text,finish}`。初始 messages 按约定仅接受本轮 user 文本；授权历史由调用者显式放进语义 Context。普通工具错误由 Toolkit 返回 error tool_result；权限 403/409 被外层 fatal latch 捕获，下一工具/模型不能继续。

关键兼容处理：

- AS 会把连续 assistant 与 tool blocks 合并到一个 Msg；formatter 适配恢复工具结果后的下一模型轮边界。
- 原 OpenAIChatFormatter 丢弃 thinking。适配在复用其文本/工具格式化后，把当前模型轮的 thinking 显式附回 `reasoning_content`，只在本轮内存中保留，不进入事件正文或返回文本。
- `z.toJSONSchema` 必须使用 `io: input`，否则 `.default([])` 被输出 schema 标成 required，Toolkit 会在执行前错误拒绝 `{}`。新增缺省参数回归；类型转换只适配 AgentScope 狭窄 ToolInputSchema 声明，未改生成 schema 含义。
- 每模型与工具前后重新执行 guard；Schema 拒绝/未知工具也有工具事件边界校验。终止/权限异常不能由框架 error_result 吞后继续。
- 确认卡工具完成后可终止 generator，返回 `pending_confirmation`；未检查的模型前言不作为最终答复返回，也不追加总结或执行同轮其余写入。
- 真实请求/Token/费用/时间预算仍由调用者 generate 门禁负责。离线测试复现 maxIters=6 后框架第 7 次总结尝试，Provider 门禁在实际新请求前拒绝，不伪报完成。

执行命令：

```powershell
node --experimental-strip-types --test tests/foundation-tool-runtime.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

结果：11/11 通过，类型检查退出码 0。日志 `tool-runtime-regression.txt`、`tool-runtime-typecheck.txt`。首次类型声明适配失败保留为 `tool-runtime-typecheck-r1-schema-type-failure.txt`；较早复用忽略目录同版依赖的测试另存 `tool-runtime-reused-install.txt`，没有混称正式安装。

本切片未修改、重生成或覆盖任何 paid pilot 输入/输出、冻结题或费用台账。它证明 SDK/框架协议与指定生命周期行为，不证明自由文本行动具备现实资源依据；该质量缺口仍需主任务处理。
