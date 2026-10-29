# 实施状态

日期：2026-10-29。此文件区分 main 当前能力和 V2 提案，不追认尚未合并的功能。

| 范围 | 状态 |
| --- | --- |
| main 的物品、故事、记忆、资料、任务和 LangGraph | 已有实现；范围和局限见 [源码映射](docs/architecture-v2/MIGRATION_PLAN.md) |
| item-understanding-v1 的工具/路由/条件修复 | 成果分支已存在，历史 256 离线与 148 请求；未合 main，最终条件补丁无完整新真实对照 |
| V2 九份架构、契约与三案例 | 本分支完成 RFC；[L0 自检报告](docs/architecture-v2/evidence/CHECK_REPORT.json) |
| 统一事实/能力/来源/授权的 ContextBroker | 待实现，P1 第一项 |
| V2 七表迁移、关系事实/遗忘栅栏、完整分身 | 待实现；仅内存 DDL 草案 |
| 功能角色搜索、统一 PlanSpec、独立盲评 | 待实现/待验证；无本轮模型质量结论 |
| REA、真实适配器与设备回读 | 待实验；没有安装或真实设备验证 |
| Pi / Cloudflare 生产替换、数据库替换 | 未决定，不实施 |

阶段门槛：[迁移计划](docs/architecture-v2/MIGRATION_PLAN.md)。
