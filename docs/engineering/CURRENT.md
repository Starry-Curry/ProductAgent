# 当前工程状态（2026-11-03）

2026-11-05 新任务进行中：`codex/wujian-finals-product-v1` 基于文档候选 `689293c`，业务沿用 `56d2c1f`。用户扩大到决赛整体产品闭环，并要求逐层对抗审查及至少八小时持续研发；新授权800次上游请求、不设金额上限，旧账目仍封存。实际进展、费用和未达标项见 [本轮状态](finals-product-2026-11-05/STATUS.md)。这是独立研发，未合并main/develop；下方历史质量结论不被代码修复或阶段提交替代。

2026-11-05 仓库协作整理：文档候选分支为 `codex/wujian-docs-cleanup-v1`，业务集成候选仍为下述团队分支。本次只精简重复报告并补充 [GitHub 操作指南](../GIT_WORKFLOW.md) 与 [后续规划](NEXT_STEPS.md)，不修改业务、权限、历史证据或智能验收结论。核对时 PR #1 仍开放且没有组员审查，develop/main 未更新；旧分支和未发布的本地清理恢复点保留。本次未运行付费模型，不重新运行全量测试或生产构建；文档差异与链接另行核对。

2026-11-05 阶段9：可运行入口、真实成功/失败、费用、保护边界和恢复步骤集中在[本轮交接](finals-product-2026-11-05/DELIVERY.md)。已完成多处知识/授权/并发修复及真实浏览器验证，仍不等于Core/Full或全产品通过；不以681项离线通过替代模型任务质量。

## 2026-11-03团队交付快照（历史，最新任务见上方）

当时研发分支：`codex/wujian-team-integration-v1`，基于底座分支 `codex/wujian-qwen-foundation-v1@5b8573d`。复用原干净隔离工作区：`D:\ProductAgent-LifeContext\.runtime\qwen-foundation-v1`，未重复复制项目。原项目与私人数据库未改；历史保护点 `543a933`、`f449067`、`b64280d`、`5b8573d` 保留。

**本轮最小通路与团队集成交付**：四个认知方向在同一组合成物品中通过零网络测试，599项离线、类型、生产构建通过。公共入口增加既有纠正/遗忘服务及调用输入/错误类型，没有重做执行器、数据或Context。见 [团队直接接入](TEAM_INTEGRATION.md) 和 [本轮测试/集成记录](team-integration-2026-11-03/DELIVERY.md)。已开 [PR #1 → develop](https://github.com/Starry-Curry/ProductAgent/pull/1)，须CI＋一名组员审查，未满足前不直接推进develop；组员现在可从明确候选分支开发。

**本次收口：Core Foundation V1 = NOT_ACCEPTED。** 共享服务与工程收敛已交付，但自主发现后的首次操作指导仍有错误细节；后续复测改善不替换首答，也不足以证明陌生商品可靠性。见 [核心验收与未达标项](qwen-foundation-2026-11-02/CORE_REVIEW.md)。用户暂停赠礼、社交、家庭协作、复杂故事的主动开发，已有功能与安全回归保留。原完整质量验收的冻结首答 **0/18** 不变，四条完整旅程留待后续 Full Foundation Quality Accepted；不混称完整Foundation通过。

费用封存：R1 **142/150**，估算¥19.633624，8次余量不再使用；R2 **40/40**，已知估算¥4.575668＋超时未知用量预留¥13.131072＝¥17.706740；R3 **12/12**，估算¥2.608660。R2从27次在原40次/¥20授权内追加至40次，原27条字节快照、R3授权及超时预留保留，可校验旧前缀。没有合并额度或覆盖历史。最后零费用收尾新增请求 **0**，不再启动付费测试。详见[账目及逐任务用量](qwen-foundation-2026-11-02/evidence/core-closeout-summary-r2.json)。不补跑全部18题直接对照。

实际结果：未知品牌ZOOM H1essential经真实Qwen原生搜索、通用厂家身份链取得HTML/PDF，原文及条件化能力进入Reality。J01 Task→获准合成反馈→新会话→纠正→遗忘实际运行；初始回答混淆左右、关机条件及指示细节。读取真实PDF原图后新会话已答对左侧开关、中间解除、录音中不能关机，仍有不受原文支持的扩写。开放目标曾漏掉已登记托盘；分离完整精简目录与相关资料后，真实复测发现托盘并根据获准失败经历改走承托路线，仍是待验证设想。所有失败和复测分别保留。

## 当前实现

- Qwen / OpenAI SDK 提供模型和原生工具，AgentScope 做有界工具往返。普通缓存问答取消强制前置抽取及第二模型审核。
- Graph/HomeTask重复模型循环退役；原文故事、本地回忆、安全限制、任务/确认/授权事务保留。家庭用同一执行器。
- Reality / Context共享实例、准确型号、官方原文、获准关系/经历和Task。公开原文定位积累在既有知识记录中，资料页/对话/开放创意复用；模型推测不成为产品事实。
- `foundation/services.ts` 是团队公共入口；独立目标功能示例可运行，Provider可注入升级，不建第二套Runtime。目录支持分页/用途收窄；PDF识读候选保留来源与页码，但为未验证模型观测。
- 已修在途物品变化、跨物品反馈隔离、规划续接、语义引用确认及官方章节提前截断。REA仅为既有自有合成软件实验，无实体操作。

## 证据与团队接入

- [执行、失败与恢复](qwen-foundation-2026-11-02/STATUS.md)
- [公共接口、示例与Mock](qwen-foundation-2026-11-02/SERVICES.md)
- [本次核心验收、浏览器和恢复步骤](qwen-foundation-2026-11-02/CORE_REVIEW.md)：594/594离线回归、类型、生产构建、benchmark通过；实际账号撤权/型号/状态检查通过，均无新增模型请求。
- [离线收敛与实际修复](qwen-foundation-2026-11-02/evidence/runtime-convergence-review.md)
- [冻结独立验收规则](qwen-foundation-2026-11-02/acceptance/README.md)
- [固定历史索引](../HISTORY.md)：保留原文、费用、失败与恢复引用。

## 隔离运行

Node24、`npm ci`；普通运行看README。当前安全体验入口仅离线，不产生新费用：

```powershell
$env:WUJIAN_MODEL_ROUND='qwen-foundation-20261103-r3'
node scripts/foundation/preview.mjs --offline --dev --port=3241
# http://127.0.0.1:3241；新克隆需自行创建合成账号与物品
node --experimental-strip-types examples/foundation/run-mock.ts
```

离线入口可查看本地合成资料与任务、操作已授权的本地业务；**不能重现真实Qwen回答**，实际模型回答和截图见证据。收费网关已达到本次追加请求上限，不应再启动。配置值、Cookies和.runtime不提交。Ctrl+C停止，不能删台账绕过限制。开发构建用.next-foundation，生产验证用.next-foundation-release，避免覆盖其他服务。

develop已从基础检查通过的 f449067 建立并推送；它是团队开发基线，并非正式验收通过。当前增量仍在独立codex分支，不合并main、不改账号权限或分支保护。
