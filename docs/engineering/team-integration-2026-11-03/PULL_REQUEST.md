## 用户问题与实际变化

最新共享底座尚未进入 develop，专业模块也需要清晰公共接口。本PR将已保存的底座修复与本轮四认知最小通路、独立示例一起集成，组员不需重建Runtime、数据库或Context。

## 实现与范围

- 基于底座分支 5b8573d，develop核对基线f449067。包含尚未集成的b64280d、5b8573d和本轮8302e6c。
- services.ts增量导出既有amendOutcome、调用/错误/会话类型和API版本；TurnRequest与解析后TurnInput分开。独立功能使用公共服务和Provider，不依赖内部模型运行器。
- 四通路复用既有Reality、Context、Task/Outcome、账号、共享领域服务；不新建Runtime、数据库、Context或专业产品。
- 前序底座修复：未知品牌资料发现/来源身份链、共享原文和图示观测、资源目录、Task实际资源引用与幂等。原始失败/费用/截图保留；大部分变更行是证据，不是新增功能。

## 验证与恢复

- 本地Node24：typecheck、599/599离线测试、生产build和Mock CLI通过。
- 同一合成物品空间、隔离SQLite、两个真实注册的测试账号；工具循环使用明确离线Mock并阻断网络。0新付费请求，无实物验证。
- 获准公开知识/实例状态共享；私人Task/经历/故事不随物品共享；纠正、遗忘、撤权验证通过。原账号、家庭/赠礼、权限、迁移备份与恢复回归保留。
- 历史台账/冻结首答哈希未变，秘密扫描无发现。未改UI，不将历史浏览器和真实Qwen结果当本轮重跑。
- **Core Foundation智能质量仍NOT_ACCEPTED**；陌生指导仍有无依据扩写，历史18题0/18不覆盖。本PR为工程集成，不是模型质量放行。
- 没有存储迁移。恢复点5b8573d及本PR提交保留；不用reset覆盖用户工作或回滚私人数据库。

团队指南：[TEAM_INTEGRATION](https://github.com/Starry-Curry/ProductAgent/blob/codex/wujian-team-integration-v1/docs/engineering/TEAM_INTEGRATION.md)
测试和交付：[DELIVERY](https://github.com/Starry-Curry/ProductAgent/blob/codex/wujian-team-integration-v1/docs/engineering/team-integration-2026-11-03/DELIVERY.md)

- [x] 目标develop，不涉及main
- [ ] GitHub CI通过
- [ ] 一名组员独立审查；不以作者自审替代
- [x] 保留数据、权限、费用、确认和恢复边界
- [x] 无UI变化；Mock、历史真实模型、实体设备验证分别报告

未满足CI与组员审查前不自动合并develop，不合并main。
