# ProductAgent统一仓库交接

## 2026-10-18 · 静默记忆与物品故事体验

验证完成：55/55 单元与领域测试、生产构建/类型检查、离线基准、隔离 API 与 Edge 故事/手机/长辈版旅程通过。新指南与暂停/恢复也已验收；本轮真实模型调用 0。最终复核还补上旧来源不能覆盖新陈述的时序约束，并重新通过全量测试/构建/浏览器验收。详细结果见 [验收摘要](docs/engineering/ambient-validation-2026-10-18.json)，合成截图见 review-evidence/ambient-20261018。

开发分支：feat/ambient-memory-experience；起点 9c14eb1（已运行的 LangGraph + 真实百炼兼容修复）。唯一工程未变。用户 untracked docs/1018.md 保持不动，不进入导出。

- 核心实现：src/lib/memory/ambient.ts，有限规则抽取、来源 hash 回执、去重/否定更新、按人暂停和有限历史核对；原记录仍在 workspace，派生记忆在 personal_memories。
- v4：src/lib/repositories/ambient-schema.ts、migrations.ts；新增 capture settings/source receipts/slots，升级前 .before-v3-to-v4.sqlite，未来版本拒绝写。保留 v2/v3 及旧备份。
- 写路径：db.write 事务内 captureWorkspace；commitTurn 事务内 story 原文与派生整理；recordSessionFeedback 自动方法与撤回。不调用模型写画像；显式纠正/忘记锁住自动主题并沿用上下文失效。忘记对话清除同源派生记忆，原始故事作品另留。
- UI：故事模式 AssistantConversation + 原时间线、MemoryCenter 默认管理而非收集、HelpEntry 示例、/guide。story 模式的确认与回忆是本地能力；一般帮助和可选交流仍可用真实 provider。
- 隐私：不要读取或打印 .env.local/api.txt；应用可用 Key 认证。默认私人记忆不上云，普通当前问题仍可能送云端。暂停整理不停止原始会话/主动故事保存。行为观察不升级喜好，采购不升级订单或所有权，礼物转入故事不升级亲历。
- 验证：tests/ambient.test.ts 新增静默闭环回归，tests/foundation-integration.mjs 从手工填兴趣改为物品故事录入；原测试保留。使用 Node24、独立 PRODUCT_AGENT_DATA_DIR，费用关闭。命令见 README。
- 发布附件：npm run export:review 从已提交 HEAD 用 git archive 输出 .runtime/exports 源码 ZIP 及 commit/SHA256，不带凭证、库、依赖、运行时、构建缓存和未跟踪文件。主线继续 Git 分支协作。

完整设计、边界、后续顺序与回滚见 [技术说明](docs/engineering/ambient-memory-architecture-2026-10-18.md)，功能使用见 [操作指南](docs/engineering/current-product-guide-2026-10-18.md)。新测试摘要见 [验收记录](docs/engineering/ambient-validation-2026-10-18.json)。


## 2026-10-18 · 用户授权的真实百炼验收

北京百炼 qwen-plus 已真实接通。公开商品三例成功；新版普通建议、来源事实选择、真实工具往返和浏览器显示的最终一轮验收全部成功（4 场景、5 次调用）。模型与页面问题已修正，44/44 单元与领域测试、类型、构建与离线门禁通过；没有实物验证。此前“未在线验收/调用 0”仅是上一阶段的历史结论，不表示 Key 无效。

本机非 Key 配置已按用户本次授权完善；Key 只由应用用于认证，不进入模型上下文、日志或报告。体验入口 http://127.0.0.1:3100 ，步骤见 [系统体验指南](docs/engineering/system-experience-2026-10-18.md)，证据见 [在线验证摘要](docs/engineering/live-validation-2026-10-18.json)。


## 2026-10-18 · 已批准并实现第一轮技术基座

用户已批准设计 v2，当前功能分支为 `feat/agent-memory-foundation`。已实际接入 LangGraph.js 与 SQLite checkpoint，新增连续会话、未建档提问后关联物品、有限来源过程、尝试与结果反馈、预览摘要的家庭交接、记忆管理/授权/纠正/忘记、兴趣与可选文字陪伴。原产品导航、业务模块、型号核对、售后与旧记录保持。

完整修改、Prompt、Loop、存储和个性化的实际设计见 [实现说明](docs/engineering/foundation-implementation-2026-10-18.md)，验收入口见 [晨间验收](docs/engineering/morning-acceptance-2026-10-18.md)。新交付以这两份文档及 [脱敏验证摘要](docs/engineering/foundation-validation-2026-10-18.json) 为准；下方确认前的文字保留为历史。

模型与实物结论仍有边界：自动验证不调用真实百炼；知识目录仍是三类商品四包十二条事实，新增两个有限过程；通用表达的风险检查不是语义安全证明。没有新增真实认证、IoT、视觉、全品类说明书解析或无人审核的自我进化。


最新验证：42/42 单元与领域测试、typecheck、生产构建、离线能力门禁，以及隔离数据库的旧 API/Edge 交互与三条新用户旅程通过。真实模型调用 0；日常业务库未用于测试。完整脱敏结果见 docs/engineering/foundation-validation-2026-10-18.json。

## 历史记录：导入、审查与确认前设计

更新：2026-10-17。先读README.md、IMPLEMENTATION_STATUS.md、docs/README.md。

## 唯一主线与来源

- 本机D:\Project\Tianmao\ProductAgent；远程Starry-Curry/ProductAgent，main。
- 源码来自Wukaifeng导出包内Product-Agent-Review-20261017.zip，SHA256：cb610240630dcd218f81358a5459bb73bb33514618d46bb40518fa646f7d1726。
- 原报告记录f0584882769bd85a143b3756ff8e1db2845591c6、基线118e295d6f513fc439daaa67870c4f186ac1df69。没有原.git，仅记录来源，不伪造历史。
- 旧LocalFlow/Python/Windows包留作历史，勿覆盖当前源码或合并业务库。

## Git 已连接并核对

2026-10-17 续接时 origin 已改为 `git@github.com:Starry-Curry/ProductAgent.git`。SSH 连接成功，执行 `git push -u origin main` 返回 `Everything up-to-date`；随后通过 `git ls-remote` 核对远程 main 与本地均为 `53a43437e94a51017bb4415cac4ad68d9245cf5a`，领先/落后均为 0。历史上传限制见迁移记录，不再作为当前阻塞。

本轮审查位于 `chore/architecture-review-20261017` 分支，尚未提交或推送。

## 当前架构与运行

根目录为Next.js应用；page/components→API→domain/db/service-store，harness/provider组织受控模型调用，Product Pack/Context/discovery提供资料、偏好和有限组合。SQLite业务仍以workspace JSON为主，另有服务记录和反馈表。

Node24；npm ci/build/start:local，默认127.0.0.1:3100；开发dev:local。Windows可用scripts/windows.ps1和本机忽略目录.runtime/node24。真实身份未接入，模型付费默认关闭。数据data/demo.sqlite，测试用独立PRODUCT_AGENT_DATA_DIR，保留迁移备份。

## 文档与验证

完整产品说明、总任务书和主提示已补齐，旧交接所说“任务书缺失/上游未知”是历史状态。旧报告原文保存在docs/archive/import-2026-10-17。

默认测试、类型、基准和构建不产生真实模型费用。集成需独立服务/数据库及现有Edge路径。真实模型还需费用授权和脚本开关；不能把历史截图/离线替身算作本次在线验收。新复验见迁移记录。

遵守对象授权、只读模型工具、故事作者/持有人区分；用户报告不等于客观完成。凭证不入库，不工具读取或展示用户api.txt及秘密副本。

## 后续

按CONTRIBUTING.md从main建分支并PR，更新报告、交接、状态、CHANGELOG。任务书中的视觉、本地9B、Skill循环和多人功能仍是后续工作；用户当前任务优先，不因整理仓库擅自实施整个Backlog。

## 本轮审查与百炼接入

详细建议见 [架构审查](docs/engineering/architecture-review-2026-10-17.md)，验证摘要见 [review-validation](docs/engineering/review-validation-2026-10-17.json)。主要缺口是回答相关性、操作资料、应用 Skill 执行契约、服务会话与反馈闭环、可观察的个性化和评测门禁；文档建议尚未实现。

用户确认使用北京百炼；本机忽略文件 `.env.local` 已准备，创建时仅 API Key 留空，手动调用费用开关开启。本轮没有读取或展示用户凭证，没有真实模型调用。公共模板保持付费默认关闭。

本轮复验 26/26、离线 benchmark、build、typecheck，以及隔离数据库的现有 API/Edge 桌面手机集成均通过。七例基准仍误拒一个正确改写，且现有脚本没有质量门禁；离线探针复现相关事实答非所问仍被标为 succeeded。业务代码未修改。

## 2026-10-18 · Agent、Memory 与个性化设计修订

用户要求自然可靠、完整 Agent 闭环，以及覆盖记忆、兴趣、关系和可选陪伴的个性化。待确认设计见 [设计 v2](docs/engineering/agent-memory-personalization-design-2026-10-18.md)，其中调整后的首轮建议优先于上一版实施范围。

建议以 LangGraph.js 为首选薄编排层，先验证当前 Node/Windows/Next/SQLite 与百炼工具协议，再实施会话、Memory 生命周期与召回、个性化及文字陪伴最小体验。用户确认前不得据此开始安装依赖或修改应用。

本轮仅写设计和同步文档；没有改业务代码、数据库、环境配置或用户文件 docs/1018.md，没有调用真实模型。当前仍是原自建单次 Harness。

## 2026-10-18 · 本轮代码与远程交接

实现与验证提交 `f394556db306c32b905fc935a040328f2e94d26a` 已推送到 `origin/feat/agent-memory-foundation`，并以 ls-remote 核对一致。远程 main 仍为 `53a43437e94a51017bb4415cac4ad68d9245cf5a`，未合并本轮实现。工作区仅保留用户原有未跟踪文件 `docs/1018.md`；未覆盖或纳入提交。

本轮没有检查或改写私人 `.env.local`。一次拟补写默认项的命令因包含可能存放凭证的文件读写被自动审批拒绝，整条命令未执行；随后取消这项附带操作，只修改公开模板，功能与验收继续完成。
