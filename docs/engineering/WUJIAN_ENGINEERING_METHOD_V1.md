# 物间比赛期工程方法 V1

日期：2026-11-03。整合用户的《比赛期精益工程工作方法 V1》与《GitHub 协作与冗余清理审查 V1》。本文件解释 [AGENTS](../../AGENTS.md) 与 [CONTRIBUTING](../../CONTRIBUTING.md) 的实施方法，不建立另一套产品规则；权威仍是 [产品定稿](../product/PRODUCT_FINAL_V1.md)，状态仍只维护 [CURRENT](CURRENT.md)。

## 做通完整结果

优先一条完整价值闭环：真实物品身份 → Qwen/成熟工具取得所需知识 → 使用获准资源形成建议/创造性方案 → 用户尝试与反馈 → 同一任务接续。保留故事、家庭、赠礼、分身与 REA 的产品地位，当前只做验证共享底座所需切片。

Demo-Ready 必须在真实 App、真实 Qwen、未预置商品中完成一项有官方依据的商品服务，以及一项目标驱动的已有物品创造/组合（有机制、资源、待核条件和保存反馈）。它是比赛期的小集成门槛，不等于 Foundation Accepted。后者仍要求冻结 6 SKU × 3 问至少 15/18 有依据的正确首答、四条真实浏览器旅程 4/4、严重错误 0；不能自行降标。

## 决策与实施

一次限时技术选择最多比较两个可行方案，只回答失败点、成熟解决办法、被替代的旧路径。优先阿里原生工具、现有 SDK 和实测的 AgentScope；简单问答保留短路径，不为技术标签建平台，框架不保证创造力。

实施顺序是失败样本 → 最小修复 → 定向回归 → 真实 App → 可恢复提交。重复局部补丁无效就检查调用链并减少中间层；不继续追加 SKU 特例或第二模型审稿。新实现稳定并覆盖业务/安全性质后清退重复执行器，保留已有有效领域服务。

团队消费已有 Item/Reality、Task Context、Tool、Task/Outcome 契约。页面负责人不必理解全部历史 Agent；事实、能力、授权和领域事务集中协调。原始资料保留，语义可修正，厂家事实、用户报告、模型推测、实体回读分别表达。

## 测试与付费

开发期只跑相关检查；集成节点集中 typecheck、离线回归、build 与实际浏览器验证。真实调用前先检查参数、fixture、来源、权限、费用门禁；冻结独立集不用于逐题调参，首答不能由重试覆盖。保留输出、延迟、失败阶段和请求台账，HTTP/JSON/引用 ID/模型自评分都不是任务成功。

比赛期可以推迟账户增强和广泛红队，但不跳过现有跨用户隔离、密钥保护、授权写入、危险设备确认及预算硬停止。本次治理没有模型调用或收费服务操作。

## GitHub 最小协作

main 保持稳定，develop 用于团队集成；只有从通过基础 typecheck/test/build 的可运行基线才可建立 develop，实际状态由 CURRENT 记录。本次只修订流程与 CI，**没有创建 develop、配置分支保护或更改账号权限**。

后续同学从最新 develop 开 feat/fix/docs/codex 分支，小提交、PR 到 develop，CI 加一名组员审查；main 仍需负责人批准。公共契约/网关/权限改动由底座负责人协调。PR 模板位于 .github/PULL_REQUEST_TEMPLATE.md；GitHub 默认自动模板需位于默认分支，在此之前可手动引用，不为启用模板擅自合并 main。

## 低风险清理边界

README 只留运行、当前状态与协作；历史入口改为 [固定提交索引](../HISTORY.md)，历史文件未移走。费用网关读取历史路径和哈希，未迁移引用前不得移动台账。实际删除代码须证明无调用或已完成替换，并做回归；不强推重写历史压缩体积，不用删文件数量衡量成果。

## 已实际读取的五项工程方法

2026-11-03 免费读取官方原文。下表只采用可立即复用的部分；没有为此安装工具或更改远端仓库设置。

| 官方实践 | 本仓库采用 | 边界 |
| --- | --- | --- |
| [Google SRE：Simplicity](https://sre.google/sre-book/simplicity/) | 减少偶然复杂度与重复接口；已替代死代码通过 Git 恢复，不长期留下注释/永关闭开关 | 不删除仍有调用的领域、安全或证据逻辑，代码行数不是成果指标 |
| [DORA：小批量](https://dora.dev/capabilities/working-in-small-batches/) | 切成独立、有用户价值且能测试的小时级切片，完成即检查和保存恢复点 | 不先攒完所有切片才给用户/浏览器反馈，也不以 DORA 为由擅自部署 |
| [Anthropic：有效 Agent](https://www.anthropic.com/research/building-effective-agents) | 先选简单可组合路径；明确工具接口，读取真实环境反馈，以请求/时间上限停止循环 | 只有效果实证更好才加步骤；不照搬文中多 Agent 或复审模式 |
| [Anthropic：Agent 评测](https://www.anthropic.com/research/demystifying-evals-for-ai-agents) | 同时看完整轨迹与最终业务状态；真实失败建小集，正负例平衡、试次隔离，确定性检查结合独立审阅 | 生成“已保存”不算数据库已保存；模型评分须校准，能力验收和旧功能回归分开 |
| [Fowler：Strangler Fig](https://martinfowler.com/bliki/StranglerFigApplication.html) | 沿现有调用边界逐入口替换，小切片验证并退役原路径，让收益提前可见 | 过渡桥有退出条件，不把临时新旧共存变成永久多 Runtime；不一把重写有效业务 |

GitHub 实务另按实际读取的 [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow)、[PR 模板](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository)、[Actions 分支过滤](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)、[分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) 与 [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/) 执行上文的小 PR、离线 CI、锁文件和审查流程。develop 是团队约定，不是 GitHub flow 强制要求；分支保护仍需管理员实际配置，模板默认分支限制仍在。

已定向读取 SRE 的复杂度/死代码/API 段、DORA 的独立小切片与避免批量积压段、有效 Agent 的最简路径/工具反馈/停止条件段、评测的 outcome/trajectory/评分器/稳定隔离环境段，以及 Fowler 的结果/切分/过渡架构段。先前两条过时 GitHub 文档路径失败后规范路径成功；未绕过登录或无限重试。当前状态、开发结果、费用与验收结论不由本文件重复声明。
