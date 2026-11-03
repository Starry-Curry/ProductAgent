# 最小通路贯通与团队集成交付

日期：2026-11-03。基线 `5b8573defab97afe3ffc273970cf22b766788929`，候选 `codex/wujian-team-integration-v1`，复用原隔离工作区。目标develop在核对时仍为 `f449067ce939d7fe82a3e48bab15df046d6eb2bc`，是本候选祖先；没有覆盖其他人的远端提交。没有新架构、第二Runtime、数据库或Context，没有数据迁移。

本轮交付的是**团队可集成的最小通路**，不改写 **Core Foundation = NOT_ACCEPTED**。陌生指导错误和历史18题0/18继续保留，不重测模型来包装质量通过。

## 四条通路与可运行证据

```bash
node --experimental-strip-types --test tests/foundation-four-paths.test.ts
node --experimental-strip-types examples/foundation/run-mock.ts
```

| 通路 | 同一组合成空间中的断言 | 验证性质 |
| --- | --- | --- |
| 理解物 | 型号身份、来源原文定位、条件化能力由公共Reality读取；保留source/basis，能力不可执行 | SQLite和来源替身。合成来源不是实际官网认证实验，无网络 |
| 物与物 | 开放目标未指定物品，发现分格模块及托盘；执行器实际读取后跟随同一Task，候选明确尺寸/承重/稳定性缺口 | 既有共享服务和有界工具循环＋确定性Mock。手写Mock候选不证明创造性或物理可行 |
| 物与人 | 明确确认、复用/云端许可后，报告进入同一用户的新Task并改变Mock可读结果；纠正后旧报告消失，遗忘后不可召回，公开知识仍在 | 实际领域事务与Context；Mock仅证明数据流，不证明模型理解 |
| 人与人 | 两个隔离注册账号通过现有invite/join/share服务授权；加入家庭不自动共享。授权后可读物品状态/公开资料，不可读所有者私人Task、经历、故事；撤权后Reality/目录拒绝，模型前阻断 | 实际账号库/领域服务，无HTTP浏览器冒充；没有开发新家庭产品 |

[四通路原始日志](evidence/four-paths-r1.txt)（4个子通路＋父测试，共5），[可运行CLI输出](evidence/example.txt)。本轮不新增浏览器/UI改动；上轮[真实浏览器/HTTP状态撤权](../qwen-foundation-2026-11-02/evidence/core-state-permissions-r1.json)及[真实Qwen完整/失败复测](../qwen-foundation-2026-11-02/CORE_REVIEW.md)保留为历史证据，未冒称本轮重新执行。

## 真正需要的接入补齐

- `services.ts` 增加既有 `amendOutcome`、输入/调用/错误类型、公共API版本标识。此前组员要从内部文件取纠正/遗忘接口；现在与Task/Outcome同一入口。
- 区分 `TurnRequest`（调用前，默认字段可省略）与 `TurnInput`（Schema解析后）；运行时校验不变。最小功能通过Provider依赖注入调用respond，不依赖具体SDK或内部运行器。
- 独立示例改用公共State/Person和TurnRequest类型。没有引入动态插件平台；专业工具服务独立实现，由底座负责人集中注册既有Schema/执行/权限元数据。
- [接入指南](../TEAM_INTEGRATION.md)明确版本兼容、409重试与明确确认、数据和费用边界。源事实和权限逻辑不复制到专业模块。

## 检查和费用

| 实际执行 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，[日志](evidence/typecheck.txt) |
| `npm test` | **599/599**，0跳过，[日志](evidence/offline-tests.txt)；含原账号/权限/长期经验/迁移备份/恢复回归 |
| `npm run build` | 通过，[日志](evidence/build.txt)；隔离生产目录 `.next-foundation-release` |
| 独立CLI | 通过，实际0上游；合成数据仅在忽略的.runtime |
| 费用/历史冻结 | 新付费请求0，历史台账和冻结首答不改；校验见本目录证据 |

没有新增供应商/外部收费服务、没有真实设备验证或控制、没有删除私人数据、没有提交秘密。没有为本轮再跑大规模benchmark或模型对照。

## develop集成边界

本PR包含 `develop@f449067..5b8573d` 尚未集成的底座修复和本轮小增量；前两项恢复提交 `b64280d / 5b8573d` 保留。相对develop已有修改包括未知来源发现、共享资料/目录、Task实际资源绑定、幂等与共享权限边界、合成认领重放修复；不是本轮重新研发。大量变更行来自原始测试证据/模型日志，不是新增业务模块。

公开规则接口返回应用到develop的ruleset为空；经典分支保护读取需认证，未据此假定无保护或更改设置，详见[实际读取结果](evidence/github-rules-read.json)。无论远端是否强制，仓库约定的CI＋一名组员审查仍必须完成。当前连接身份仅有push/triage而无admin；不修改仓库权限。

PR目标仅develop，待CI与组员审查。未满足时保持可审查PR，不自动合并；也不擅自推进main。可先从候选分支建立依赖功能分支，合并后正常从origin/develop开始。[指南](../TEAM_INTEGRATION.md)给出完整命令。

恢复方式：保留 `5b8573d` 及本轮提交，从任一已发布提交创建新恢复分支；不reset用户工作或回滚私人数据库。公共接口本轮为增量导出，无存储升级；以后不兼容修改必须列迁移方案和消费者回归，不把底层实现永久冻结。
