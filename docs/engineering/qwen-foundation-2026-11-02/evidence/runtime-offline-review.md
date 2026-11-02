# Gate 2 前运行器候选：零付费业务协议实验

日期：2026-11-02。状态：**模型替身验证，不是正式 Qwen 验收，不代表产品任务成功**。Gate 1 尚未通过，本实验未使用任何付费授权。

## 运行方式与范围

```powershell
node scripts/foundation/runtime-offline-probe.mjs
```

脚本默认拒绝覆盖现存结果。使用本地 `127.0.0.1` HTTP 模型替身，构造合法 Chat Completions 与 SSE 响应；外部 fetch 被拒绝。现有 OpenAI SDK 7.47 与已安装 AgentScope TypeScript 0.0.15 通过真实 SDK/框架解析同一种模型协议，读取同一份合成标签机语义卡、同一问题与服务端工具闭包。

AgentScope 仅通过本工作区忽略目录 `.runtime/agentscope-offline` junction 复用上一工作区已有安装；无全局安装，无生产依赖/锁文件变更。包自带 Apache 2.0 LICENSE。工具关闭 built-in Skill，未注册 shell、文件或 MCP 工具。

语义卡明确标注合成、用户报告、未知材质、耗材不足，来源为 `example.invalid` 合成地址。没有把替身输出称为真实 Qwen，也没有对合成资料做官方认证。

## 实测结果

| 业务协议性质 | SDK 手工循环请求 | AgentScope 请求 | 结果 |
|---|---:|---:|---|
| 一次读资料后回答已知和未知 | 2 | 2 | 均正确传递工具结果；答案来自脚本，不测智能 |
| 资料工具临时失败，再次读取恢复 | 3 | 3 | 均把真实抛出的错误交还模型协议，随后一次成功 |
| 模型请求别人的物品 ID | 2 | 2 | 同一服务端闭包拒绝，实际读取 0 次 |
| 工具执行前暂停，恢复继续 | 2 | 2 | AS 新 Agent 从 StorageBase 状态恢复；底层工具只实际读一次 |
| 工具反复请求，配置 3 次循环 | 3 | **4** | SDK 硬请求上限停止；AS maxIters=3 后额外总结，结束事件仍为 completed |

共 25 次本地 HTTP 替身请求，真实上游请求 **0**，付费 **0**；没有外部网络请求。原始请求、工具事件、模型替身输出及断言在 `runtime-offline.json`。

初次实验的 SSE fixture 缺失标准 `tool_calls[].index`，导致 AS 解析器报错。已修正测试服务器，原错误保存在 `runtime-offline-r1-fixture-failure.json`；这是输入 fixture 错误，不据此判 AS 或产品失败。

## 哪些自研通用机制能够真正被替换

已通过真实库代码执行证明可交给 AS 的职责：

1. `Toolkit.registerToolFunction` 注册、Schema 验证、工具异常包装为 error tool_result；无需应用自己重复构造每个工具结果。
2. `Agent.replyStream` 的模型/工具循环推进，工具调用到结果的关联，原生 MODEL_CALL/TOOL_CALL/TOOL_RESULT/TEXT/REPLY 事件。
3. `StorageBase` 的 context/metadata 保存恢复；本实验通过 `iterator.return()` 在 TOOL_RESULT_START 后停止，finally 保存 pending 工具，重新实例化后继续且只读一次。

若正式采用，这些可以替换 `practical.ts` 当前手工循环中的模型推进、tool_result 协议封装和通用事件编排，不能只在原循环外再包一个 AS Agent。

**本子任务未替换生产代码，所以已减少的生产行数为 0。** 上述是实证可替换职责，不把 PoC 行数差宣称维护成本已经下降。SDK 原型仍显式管理 pending 队列、异常封装、消息追加和循环；AS 原型主要消费框架事件，另有 StorageBase 实现和工具注册适配成本。

## 必须保留或补齐的应用能力

- 权限、物品身份、用途授权、当前状态、撤权和业务写入确认必须保留在物间服务端工具闭包。AS 不知道谁有权读取物品，框架工具 Schema 不是授权。
- **`maxIters` 不是请求预算**。0.0.15 的 `Agent._reply` 在循环结束后仍以 toolChoice=none 调用总结；本实验实际 4 请求且 REPLY_END=completed。正式接入须由 Provider/网关或模型适配器执行全局及每任务请求/Token/时间预算，并将停止原因映射为未完成；不可仅观察框架 completed。
- 已安装公开 `ReplyOptions` 没有 `AbortSignal` 或 before/after 业务 guard 回调。受保护 `_reasoning`、`_acting` 可以子类扩展，但持有授权的工具闭包、Provider 请求前后校验、实际网络 abort 仍需适配。实验中的 generator 停止发生在工具执行前，**未证明可取消正在等待的远端模型请求**。
- 原生 `REQUIRE_USER_CONFIRM`/`USER_CONFIRM_RESULT` 与外部执行事件在库公开接口存在；本实验未测试生产写入确认，不可替代物间原领域事务/幂等/审计。
- AS 自带 `OpenAIChatModel` 走 Chat，`DashScopeChatModel` 走 DashScope 专用模型接口；本实验没有测试 Responses 原生 web_search/web_extractor，也没有验证收费模型的真实兼容。已有 native 工具可继续封在知识服务内部，由 AS 正式工具调用；若需要让一个模型轮直接混用 Responses 内置工具，需真实适配/对照，不能宣称开箱即用。
- 不使用 AS 默认 memory compression 去压缩私人长期记忆；每次仍由物间按当前用途权限构建任务相关语义卡。StorageBase 需对接现有 session/checkpoint 或只保留 turn-local 状态，不能平行存一套未受撤权控制的私人数据库。

## 接口建议与阶段判断

Gate 1 通过后值得进入小规模真实对照的候选是：**AgentScope 接管通用循环 + 现有 Provider/百炼知识服务适配 + 物间领域工具与当前权限闭包**。现有 SDK 作为公平控制组。

对主任务提出的最小接口需求：语义 Context 入参；统一 `{ name, schema, execute }` 工具注册表；模型前后 `guard`/budget 回调；明确的终止原因；事件转现有 SSE；可选现有存储适配。工具 `execute` 不应从框架持久 Context 恢复旧权限。

如果适配后仍同时保留原 Practical 循环、另建 AS 循环和 V3 审核链，就没有完成收敛。若实测 AS 不能减少净维护量或损害原生工具接入，应保留 SDK 并真正删掉失败旧执行器；这个取舍需 Gate 2 真实模型/工具证据，不能凭本实验决定模型智能路线。

## 源码核对定位

已安装官方包相对于 `@agentscope-ai/agentscope`：

- `dist/agent/index.mjs:735–742`：replyStream finally 保存。
- `dist/agent/index.mjs:962–1018`：循环、额外总结、completed 结束事件。
- `dist/agent/index.mjs:1137–1161`：toolkit 工具执行与结果事件。
- `dist/agent/index.mjs:201–240、359–372`：参数错误与工具异常转 error 结果。
- `dist/agent/index.d.ts:18–26、65–73、121–124`：ReplyOptions/AgentOptions/流式公开接口。
- `dist/event/index.d.ts:219–252`：确认、外部执行事件。
- `dist/storage/index.d.ts`、`dist/base-DUcNB1fg.d.ts`：存储扩展契约。

本报告基于实际安装版本源码与离线执行，不将 README 宣传或框架示例当作物间用户任务验收。
