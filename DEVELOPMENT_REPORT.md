# 开发记录

## 2026-10-29：物间 V2 架构 RFC

- 正式基准 main `ea32c3f4c9e18992ca267b6dd74e26e418c9e95a`；同时研究审计 `bc03b76` 与未合并修复 `8eca3d7`，不把修复分支当主线。
- 完成九份中文架构/迁移/验收文档，提供事实证据、用户/关系记忆、数字分身、功能组合、设备探索及框架对照。
- 新增内存 DDL 与合成设计检查。真实结果和限制见 [检查报告](docs/architecture-v2/evidence/CHECK_REPORT.json)、[自审](docs/architecture-v2/REVIEW.md)。
- 本轮不改业务、不迁真实数据库、不安装工具、不调用百炼、不控制设备。尚未实现 V2，未重跑历史业务测试。
- 下一步：先有选择迁入 v1 已验证修复，再做只读 ItemKnowledgeRepository / ContextBroker 纵切。框架与数据库暂留，REA 只设计隔离探索工具。

完整入口：[V2 RFC](docs/architecture-v2/README.md)。后续每轮追加事实、失败与决策，不将计划写成已完成。
