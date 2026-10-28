# 架构比较、工具评估与后续实验

日期：2026-10-29。**决定 D01：保留当前产品与数据基线，先修业务契约并做隔离实验，不在本轮选定替代框架。** 理由：已复现的主要故障来自路由、数据裁剪、预算和校验；真实LangGraph工具循环已经成功。比较过继续LangGraph、Pi Core、Pi Durable及Cloudflare部署，尚无等条件收益证据。这个决定不排除下一轮推翻当前运行核心。

## 官方资料与版本边界

已读取 [Pi官方仓库](https://github.com/earendil-works/pi)，远端HEAD `ad702637fdf6fbd3f965c5dba0b14bae100b74eb`（审计时查询；未安装）。当前包命名为 `@earendil-works/*`，不能照搬旧包名。主要依据是 [Agent Core README](https://github.com/earendil-works/pi/blob/ad702637fdf6fbd3f965c5dba0b14bae100b74eb/packages/agent/README.md)、[Durable README](https://github.com/earendil-works/pi/blob/ad702637fdf6fbd3f965c5dba0b14bae100b74eb/packages/durable/README.md) 与 [Cloudflare PiHarness官方文档](https://developers.cloudflare.com/agents/harnesses/pi/)。文档是现时官方能力说明，不是本机运行结果。

LangGraph依据当前锁文件1.5.1实现，并查阅官方 [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) 与 [Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)。框架当前文档不替代本项目已锁版本的测试。Pi Durable公开标明experimental；Cloudflare页面支持限定Pi minor，示例与仓库main API已有演进差异。实验必须钉版本/commit并用相应版本测试，不能混用文档示例。

## 四种选择怎样影响物间

| 维度             | 当前LangGraph实现                                     | Pi Agent Core                                              | Pi Durable（Node + SQLite）                            | Cloudflare Pi Harness                                                     |
| ---------------- | ----------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| 核心用途         | 显式图节点/分支/检查点                                | 轻量模型—工具循环与事件                                    | 持久会话、任务和扩展运行时                             | 在Durable Object中承载Pi Durable并自动唤醒                                |
| 对物间的直接价值 | 可看清安全分支与确认路径；已有验证资产                | 减少自己写循环，流式事件、steer/followUp与工具钩子方便交互 | 适合长期能力探索、等待用户补充、多阶段任务重启继续     | 适合未来联网在线服务、弹性休眠和托管唤醒                                  |
| 工具扩展         | 当前4个原生工具，技能白名单与Zod参数                  | 可变工具集、上下文转换、before/afterToolCall               | 扩展注册、工具持久任务、caller/重放策略、延迟工具发现  | 通过harness扩展工具，业务仍须自建权限                                     |
| 恢复与状态       | SQLite checkpointer + wait interrupt；业务会话另存    | 状态主要在运行实例，持久恢复仍需宿主实现                   | 先存储后发布，重启恢复任务；重放安全工具须显式声明     | Durable Object SQLite + Lifecycle唤醒/心跳；并非仅换一个npm包             |
| 人工确认/权限    | interrupt可停等输入；现有动作卡、版本、领域授权可复用 | 钩子可阻止工具，但不是完整身份/权限系统                    | 宿主仍要做审批、数据权限、幂等外部副作用               | 官方页面明确尚无工具调用审批步骤；不能替代物间授权                        |
| 存储/部署        | Node24 + SQLite，Next前后端保留                       | 可留Node/Next，需设计会话与恢复适配                        | 官方有openNodeSqliteStorage，**无需先迁Cloudflare**    | 要新增Workers/DO/Lifecycle，处理现有SQLite BLOB、Node OCR/PDF/Sharp等适配 |
| 迁移范围         | 小改路由、上下文与预算即可试验                        | 抽出运行核心；工具、输出契约及领域授权保留                 | 还需适配会话、任务、检查点迁移与清理策略               | 在Durable实验之外，增加部署/连接/存储边界工程                             |
| 主要风险         | 自写Graph过大、不同生成路径的策略不一致               | 不能自动补上持久任务或物理知识                             | experimental API、存储单拥有者、重放语义与既有事务交互 | 平台成本、版本绑定、原数据迁移、无现成审批；本轮无账号/部署验证           |

Pi Core的工具调用、事件和钩子来自其官方README；Pi Durable的Node SQLite、持久任务/重放与experimental状态来自Durable官方README。Durable当前基于pi-ai与Chord，不应简单当作给现有Pi Core实例加一个数据库插件。Cloudflare负责在DO中接入存储与生命周期；Pi的“能继续跑”不证明业务建议更正确。[Core](https://github.com/earendil-works/pi/blob/ad702637fdf6fbd3f965c5dba0b14bae100b74eb/packages/agent/README.md)、[Durable](https://github.com/earendil-works/pi/blob/ad702637fdf6fbd3f965c5dba0b14bae100b74eb/packages/durable/README.md)、[PiHarness](https://developers.cloudflare.com/agents/harnesses/pi/)。

Pi Durable默认不会把未声明可安全重放的中断工具简单重跑；应用仍须用幂等回执保护外部动作。物间未来设备协议读取可以做可重试的只读工具，控制设备的写操作应独立审批和验证，不能因框架支持code mode就开放shell、任意网络或设备控制。官方Pi仓库也不提供自动替代宿主的系统权限隔离。[Pi权限说明](https://github.com/earendil-works/pi#permissions--containerization)。

## 哪些是业务问题，哪些值得用框架实验回答

**明确属于业务实现**：库存指代误判、列表丢材质/限制、公开模型轮次=1、正则漏掉“安心使用”和物理机制、数据来源分层与提示词。原样搬去Pi，这些问题仍会存在。

**框架可影响但未证明收益**：运行循环/事件代码量、长任务恢复、steer与用户跟进、任务收件箱、断线观察、睡眠唤醒、跨工具编排。当前LangGraph也已有持久化与人工中断；不得把缺少宿主调度误写成LangGraph不能持久化。现有授权/遗忘/epoch/事务和动作卡必须保留，不能用框架会话替代。[LangGraph持久化](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[人工中断](https://docs.langchain.com/oss/javascript/langgraph/interrupts)。

**可以只换Agent核心**：建议保留Next API和前端、Item ID/SQLite业务库、知识获取、记忆过滤、领域命令和校验器；实验新增一个运行适配接口，输入是已授权上下文/工具，输出继续用AssistantReply与trace。先让新会话走影子实验库，不迁移旧checkpoint。Pi Durable可用单独任务库，避免把其异步事务与当前同步DatabaseSync事务交叉。模型适配也必须验证百炼工具协议、结构化输出、用量与费用闸门；“支持OpenAI兼容”不是已实测可替换。

## 开发辅助工具：先复用，后按收益安装

本轮实际可用：Node24、锁文件依赖、`@playwright/test`、已安装Edge、rg、Node test runner、Git/GitHub连接、终端、静态图片查看、Mermaid；Codex还有浏览器控制、节点执行和代码审查工具。可用不代表本轮每项都调用过。实际浏览器验收复用仓库Playwright脚本，没有安装额外自动化工具。

Skills目录中有OpenAI Docs、Find Skills、Computer Use、Visualize、Skill Installer等；本轮用前两者核对官方说明与候选技能来源。Codex Goals工具存在，但适合用户明确设定的持续目标，不是产品运行时的任务恢复方案；本轮未创建Goal、未创建新聊天或派生代理。[Skills官方说明](https://learn.chatgpt.com/docs/build-skills)、[Goals官方说明](https://learn.chatgpt.com/use-cases/follow-goals)。

| 工具                           | 预期收益                                              | 当前兼容/安装成本与风险                                                                                   | 本轮处理                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright                     | 可重复API+页面验收、截图与错误采集                    | 已在锁文件；Edge已可用；两组默认路径需显式配置                                                            | **实际复用**，收益最高                                                                                                                   |
| agent-browser                  | 日常探索页面、快照定位与交互；CLI/MCP可少写一次性脚本 | 官方支持Windows及指定浏览器；新增CLI/daemon及配置维护，须用隔离浏览器资料                                 | [核对官方仓库](https://github.com/vercel-labs/agent-browser)，未安装；已有Playwright足够                                                 |
| Understand Anything            | 给产品/开发者可交互代码图、导览与影响分析             | 官方列出Codex/Windows安装；Tree-sitter+LLM混合，需评估源码发送、模型费用、图更新与安装脚本                | [核对官方仓库](https://github.com/TheArkhitect/understand-anything)，未运行远程安装脚本；当前人工源码图已够用                            |
| CodeGraph                      | 跨文件调用/影响检索，可能降低长期大仓探索成本         | 名称对应多个不同项目；本轮查看suatkocar候选，Windows二进制/构建及嵌入后端未本机验证；图索引可能含私有源码 | [候选官方实现](https://github.com/suatkocar/codegraph)，未安装，不把它当唯一“CodeGraph”                                                  |
| OpenAI Frontend Skill          | 下一轮界面设计约束和视觉复核方法                      | 当前可用Skills清单未含该名称；官方文章提及但旧.curated/.system路径均404，不能据目录索引宣称已可安装       | [官方前端文章](https://developers.openai.com/blog/designing-delightful-frontends-with-gpt-5-4)可读；不安装不明镜像，后续重新核对官方来源 |
| Codex Skills / Goals /现有测试 | 将基线检查、脱敏台账、交接固化为可复用流程            | Skills是研发助手能力，不是物间产品内的Agent技能；Goals也不能替代任务数据库                                | 先保留本轮脚本/文档，重复两轮后再决定是否做项目Skill                                                                                     |

不新增MCP服务即可完成本轮审计。后续若索引工具有必要，应先排除.env、api.txt、数据库、照片、缓存及私密文档，再在公开源码副本固定版本试跑；本轮没有完成这些工具的性能或安装验收。

## 下一轮三个实验（均未实施）

### E1：让物品条件完整到达建议，完成一次工具往返

**问题**：F01–F04让“模型可用”与“答案可靠”脱节。

**范围**：独立功能分支；修库存指代标准化；新增授权后的物品摘要/详情工具，带ID、材质、用途限制、未知条件和来源；公开只读任务允许至少2轮且仍逐HTTP扣预算。补充通用保证与任务前提校验。保留四个已知反例，覆盖“选中物品”和“先列表再选物”两条路径。

**自动成功标准（拟定）**：30条库存同义/否定/排除测试全部正确选择或澄清；20条有明确限制的建议不得漏传限制或做相反保证；本机/公开替身均完成tool→final；预算/权限撤销/幂等回归无新增失败；无网络测试0真实请求。成功表示契约正确，不是物理安全认证。

**改现有代码**：是，小范围；不换框架。**需负责人确认**：公开访客每个有效任务可用的费用/轮次上限，以及“缺条件时先追问还是先给有条件方案”的产品取舍。本轮未授权下一轮付费预算，真实复验需重新约定。

### E2：同模型、同物品证据的回答质量盲测

**问题**：是提示/上下文/规则损伤效果，还是模型本身不能完成目标？

**范围**：仅实验适配器，比较“短Prompt直调”“当前Agent”“E1后Agent”；同模型快照、输入事实、输出预算、温度与计费规则；每组覆盖理解/新用途/现实任务，多随机重复。不要拿更长输出或更多候选充当更好答案。单独统计本地截流；不将0模型路径强行标成模型组成功。

**自动成功标准（拟定）**：冻结至少24条场景及对照事实；机器检查未登记资源、越权数据、引用和前提；盲评分别给相关性、实用性、意外性、物理依据、可执行成果评分；记录每个有效结果的Token/耗时及误拒。不让同一生成模型担任唯一裁判。实物可行性仍需少量人工实践确认，自动检查只能筛明显错误。

**改现有代码**：只新增评测和可配置提示实验；生产默认不改。**需负责人确认**：选定优先场景及惊喜/稳妥权重、愿意人工实践的低风险案例、下一轮付费次数/金额。统计优劣须预先约定，不凭单次输出判框架优胜。

### E3：同业务工具下，LangGraph与Pi的恢复/维护成本对照

**问题**：物间是否真的需要更换运行核心来支持持续探索和恢复？

**范围**：保留业务库、前端、工具与授权校验；独立adapter、假模型、独立Node+SQLite任务库。可先用Pi Core验证循环/事件，再以Pi Durable比较持久任务；不部署Cloudflare、不启用任意代码执行。注入5类故障：模型发出后中断、工具前/后崩溃、确认前撤权、重启重复requestId、等待超时/用户跟进。使用模拟协议工具和回执计数，不连接真实设备。

**自动成功标准（拟定）**：100次故障循环不丢已提交状态；已完成写回执不重复；撤权后0写入；未知模型计费尝试不自动重发而不记账；最终状态/费用可解释；评估新增代码量、隔离复杂度、延迟和定位耗时。框架默认重试必须经过物间费用授权适配。

**改现有代码**：新增可插拔运行接口，旧路径保持默认；数据不迁移。**需负责人确认**：长期任务到底要服务哪些用户目标；只有实验收益明确后，才决定正式迁移、旧会话处理和平台部署。

## 何种证据才支持彻底重构

需要共同满足：E1/E2表明业务契约已修正而核心瓶颈仍在；E3反复证明现有核心难以满足必要的恢复/交互目标；新实现通过原191项和新增权限/遗忘/访客/故障测试；迁移、回滚、数据所有权、成本和维护责任有完整计划；产品负责人确认收益足以覆盖重做与延期。若收益仅来自换了Prompt或扩大预算，应把改进应用回现有核心，不把它记为框架胜利。

## 决策日志

| 决定                           | 状态           | 理由、替代与未知                                         |
| ------------------------------ | -------------- | -------------------------------------------------------- |
| D01 保留产品基线，先小实验     | 本轮已执行     | 业务故障证据明确；比较四种架构，尚无迁移对照             |
| D02 独立克隆/分支、合成库      | 本轮已执行     | 保留旧分支deliverables和真实数据；不用旧Demo替换最新代码 |
| D03 不安装额外图谱/前端工具    | 本轮已执行     | 现有工具已完成目标；新工具收益/费用/Windows兼容未验证    |
| D04 不部署、不接实机、不推main | 本轮已执行     | 本阶段只审计与设计；后续重大方向仍待负责人决定           |
| D05 新模型预算不自动继承       | 待后续任务授权 | 本轮22/40在此停止；剩余额度不是无限期授权                |
