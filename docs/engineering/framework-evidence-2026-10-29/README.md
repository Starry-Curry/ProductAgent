# 框架实测与首个产品切片

2026-10-29。结论：**继续 LangGraph + SQLite + Next.js，把开发精力放在物品理解、关系记忆和可实施创意上。** 本轮已经移植 v1 有效源码/测试，并接入一个最小共享资料模块，不是新一轮 RFC。

- [简短决策](DECISION.md)：Mastra、Pi 的实测结果与引入门槛。
- [测试报告](TEST_REPORT.md)：实际命令、失败定位、真实模型结果与费用。
- [下一轮实现](NEXT_IMPLEMENTATION.md)：明确业务文件、入口、验收与预算建议。
- [机器汇总](evidence/SUMMARY.json)、[原始调用台账](evidence/live-ledger.json)、[浏览器结果](evidence/browser/result.json)。

本轮的产品改动：选择性移植 v1 的工具/模型回合/上下文/否定与条件修复；新增共享物品资料的安全投影和内容快照，供聊天、创意和故事使用。故事模型只拿身份，不携带无关物理属性；私人记忆仍单独授权。没有新建 V2 表、迁移用户数据或替换框架。

验收边界：赠画的显式保存、跨新会话召回、遗忘与越权有实际浏览器证据；真实模型也能引用赠送事实。**纸盒创意仍不合格**：目前能提供属性和偏好、拦截部分坏候选，但降级结果帮助有限。265 项业务回归与框架实验不是创意盲评或实物验证。

基准：main `ea32c3f4c9e18992ca267b6dd74e26e418c9e95a`；研究 [RFC 69eb7c8](https://github.com/Starry-Curry/ProductAgent/tree/69eb7c8791ca0fa85a8b105827705b5e75df5230/docs/architecture-v2)；移植来源 [v1 8eca3d7](https://github.com/Starry-Curry/ProductAgent/tree/8eca3d72fc93fce9d4cdb27b1ccd6bd70973a52e)。v1 尚未合 main，所有移植均在本轮分支复验。

工作区：`C:\Users\hp\.codex\worktrees\wujian-framework-evidence\ProductAgent-LifeContext`；分支 `codex/wujian-framework-evidence-v1`。原工作区、未跟踪 deliverables 与私人数据保留。只推独立分支，不合 main。
