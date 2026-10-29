# 评审与交接

2026-10-29，分支 `codex/wujian-architecture-v2-rfc`。所有正式成果通过 GitHub 分支阅读，不需要搬运文件。

1. 先读 [架构总览](docs/architecture-v2/README.md)，再读 [决策](docs/architecture-v2/DECISIONS.md) 与 [三案例验收](docs/architecture-v2/ACCEPTANCE.md)。
2. [自审](docs/architecture-v2/REVIEW.md) 列出已修正的设计漏洞和未知；[机器报告](docs/architecture-v2/evidence/CHECK_REPORT.json) 仅证明 L0，不能证明 V2 已实现。
3. 独立工作区来自最新 main `ea32c3f`；原工作区/其他分支/私人数据保留。研究固定审计 `bc03b76`、修复 `8eca3d7`。后续先 diff/移植已验证修复及测试，不直接整分支视为主线。
4. 下一轮从当时最新 main 开实现分支：只读可信上下文纵切 → 关系与遗忘 → 创意盲评 → 分身/设备分阶段推进。见 [迁移](docs/architecture-v2/MIGRATION_PLAN.md)。
5. 待负责人决定：记忆默认、共享/删除保留期、创意盲评目标与人选、第一台设备和风险。Pi/数据库无立即迁移依据。

复现：Node 24，`node docs/architecture-v2/check.mjs --repo=.`；需本地包含 source-map 中三个 Git 提交（浅克隆若缺失，先正常 fetch 对应分支）。不加载 env、不发请求、不打开应用数据库。业务测试在下一轮受影响实现中重跑，本轮没有以文档检查替代产品测试。
