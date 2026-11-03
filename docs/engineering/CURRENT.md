# 当前工程状态（2026-11-03）

唯一当前研发分支：`codex/wujian-qwen-foundation-v1`。工作区：`D:\ProductAgent-LifeContext\.runtime\qwen-foundation-v1`。旧任务已安全暂停，遗留成果保护点：`543a933571489a518e9dd4bb069e674155138d3a`（已推送）。本轮从此增量收敛，原项目与私人数据库未改。

**状态：NOT_ACCEPTED。** 冻结18题与四条完整旅程尚未全部通过；579项离线回归不是产品验收。实际用量以[原始台账](qwen-foundation-2026-11-02/evidence/model-calls.json)为准，轮次仍为 `qwen-foundation-20261102-r1`、150次/¥80，历史不重置。

## 当前实现

- Qwen / OpenAI SDK 提供模型和原生工具，AgentScope 做有界工具往返。普通缓存问答取消强制前置抽取及第二模型审核。
- Graph/HomeTask重复模型循环退役；原文故事、本地回忆、安全限制、任务/确认/授权事务保留。家庭用同一执行器。
- Reality / Context共享实例、准确型号、官方原文、获准关系/经历和Task。公开原文定位积累在既有知识记录中，资料页/对话/开放创意复用；模型推测不成为产品事实。
- 已修在途物品变化、跨物品反馈隔离、规划续接、语义引用确认及官方章节提前截断。REA仅为既有自有合成软件实验，无实体操作。

## 证据与团队接入

- [执行、失败与恢复](qwen-foundation-2026-11-02/STATUS.md)
- [公共接口、示例与Mock](qwen-foundation-2026-11-02/SERVICES.md)
- [离线收敛与实际修复](qwen-foundation-2026-11-02/evidence/runtime-convergence-review.md)
- [冻结独立验收规则](qwen-foundation-2026-11-02/acceptance/README.md)
- [固定历史索引](../HISTORY.md)：保留原文、费用、失败与恢复引用。

## 隔离运行

Node24、`npm ci`；普通运行看README。受控模型验证：

```powershell
$env:WUJIAN_EVAL_CONFIG='你的安全配置文件绝对路径'
node scripts/foundation/preview.mjs --dev --port=3241 --record-synthetic-evidence
```

使用当前获批网关与合成数据；配置值、Cookies和.runtime不提交。Ctrl+C停止，不能删台账绕过限制；`--offline`关闭模型费用。开发构建用.next-foundation，生产验证用.next-foundation-release，避免覆盖其他服务。

develop须由对应源码typecheck/test/build通过的可运行版本建立；目前尚未建立。不合并main、不改账号权限或分支保护。
