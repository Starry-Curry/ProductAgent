# 2026-10-18 隔离验收证据

截图与 JSON 均来自本轮 Windows Edge + 生产构建的独立测试库，使用合成故事与虚构角色，没有使用日常数据库或真实私人资料，真实模型调用为 0。测试脚本为 tests/integration.mjs 与 tests/foundation-integration.mjs；入口为 scripts/verify-local.mjs。

- ambient-item-story-desktop.png：原物品详情、故事讲述、本地回忆与原始时间线。
- ambient-guide-mobile.png / ambient-guide-desktop.png：新操作指南，390px 与桌面。
- foundation-elder-mobile.png：保留长辈版的原帮助入口和家庭事项。
- integration.json / foundation-integration.json：本轮原业务与新故事旅程执行结果。

截图可说明交互与来源呈现，不是真实物品、真实用户理解或在线模型效果证明。完整验证与已修复失败见 docs/engineering/ambient-validation-2026-10-18.json。
