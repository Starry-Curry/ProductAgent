# 本轮技术取舍（研发中，非验收通过）

基线：`f0e3114924a1d22b01b413d6d3e40b35fe6d6d41`；产品定稿不变。当前状态 **BLOCKED_AUTHORIZATION，产品未通过验收**：250次请求已用完，停止付费验证，保留可运行恢复点。冻结门槛见 OUTCOME_CONTRACT，原始输出不得凭接口成功判合格。

| 选择 | 用户收益、证据与代价 |
|---|---|
| 保留现有 OpenAI Node SDK 7.47 及领域事务，不引入第二运行框架 | 同一千问、同一只读工具的小实验中，SDK 2次调用约2.99秒，AgentScope 0.0.15约3.86秒（仅1例，不是质量统计）。AgentScope TypeScript 当前 OpenAI适配主要为Chat，接入原生Responses还需新适配，并不能替代物间授权/事务。原始：evidence/runtime-compare.json。Apache-2.0；仅隔离安装，没有产品依赖变动。 |
| 搜索定位与具体网页读取分开，使用SDK Responses原生事件 | 基本流、实际web_search、闭合范围web_extractor均实测；两次开放式搜索+抽取150秒未终止的失败保留。不是用一次95秒超时放弃厂商能力。Responses用reasoning.effort；不能把Chat的thinking_budget当Responses参数。只采结构化来源，过滤厂家域名，再取得原文并核对型号。 |
| PDF按需走百炼图文接口，文字层继续用现有pdf-parse | Brother真实16页说明书确有图文Token和pdf_page_parser计费事件；型号操作仍需独立对照。Docling可提供本地版式/OCR，但当前不足以证明新增Python服务/模型下载的收益；暂不加入。不是声称已实测Docling。 |
| 不用Vercel AI SDK或Python Qwen-Agent重复包一层 | Vercel有成熟的有界工具循环；Qwen-Agent有工具/RAG/代码执行。但现有SDK已覆盖当前实际协议，增加第二套消息、流及费用适配缺乏已证实收益。这里只是官方实现审查，未宣称真实A/B淘汰。 |
| 发现目录与具体读取分开 | 当前Task不再封闭其他获准物品目录；只暴露名称/型号/类别，按需服务端鉴权后读取资料。目录不带私人备注、故事或照片；未扩大共享权限。 |
| 行动共用Creative V2动作词表与条件计算 | Practical不再另造一套物理Schema。每步关联资源；明确冲突拒绝，未知保留条件。动作类型不证明自由文字语义，不能以动词正则冒充物理验证。普通聊天没有增加第二模型审稿。 |
| 草稿不直接流出，状态可流出；完整SSE有时间上限 | 用户不会先看到随后被放弃的操作草稿。模型最终回答仍须质量验收，缓冲本身不等于事实审核。SDK连接超时不等于整段生成上限，新增显式流中止。 |
| 只重查条件变化所影响的计划步骤 | 记录服务端资源指纹及逐步依赖；材料/尺寸变更显示受影响步骤，私密备注或分身改名不要求重做物理方案。未变化也不代表已通过实体测试。单元与浏览器验证分别记录，不能互相替代。 |

## 已发现失败及处理

- 首批baseline-f0与candidate-first脚本把physicalFacts放在了错误层级，实际模型缺少题设性质。**两份均为无效对照，保留原文和费用，不计首答门槛。** 修复为attributes.physicalFacts并逐件断言，冻结题目未改；重新采集baseline-valid、candidate-valid与direct-valid。
- 第一批陌生商品：支持页/营销页不能替代具体操作，部分输出仍给了无依据的通用步骤。搜索现在带上当前操作问题，且结构化产品型号明确不符时拒收；尚须实测复验。
- 冻结创意中的候选流程存在过早准备计划、条件表达不清与超时；未把这些失败改记成功，未降低9/12和零严重违反门槛。

## 官方依据（2026-11-02读取）

- [百炼原生搜索](https://help.aliyun.com/zh/model-studio/web-search)、[网页抽取](https://help.aliyun.com/zh/model-studio/web-extractor)、[Responses兼容](https://help.aliyun.com/en/model-studio/compatibility-with-openai-responses-api)、[PDF理解](https://help.aliyun.com/zh/model-studio/pdf-understanding)、[计费](https://help.aliyun.com/zh/model-studio/model-pricing)。
- [AgentScope TypeScript](https://github.com/agentscope-ai/agentscope-typescript)、[Qwen-Agent](https://github.com/QwenLM/Qwen-Agent)、[Vercel工具调用](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)、[Docling](https://docling-project.github.io/docling/)。未安装候选没有伪造兼容性测试。
