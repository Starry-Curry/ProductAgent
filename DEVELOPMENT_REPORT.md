# 开发记录

## 2026-10-29：智能核心 Alpha（本轮）

从功能基准1cb9764创建独立分支codex/wujian-intelligence-alpha，工作区D:\ProductAgent-LifeContext\.runtime\alpha-app。新增真实商品小样本知识、自然聊天的原话记忆候选与确认、事实型关系回忆保护、创意作用/条件契约与反例复核；修复物品范围丢失及修复上下文权限。没有迁库、换框架、合main或触碰硬件。

289项离线通过（新增24），类型/构建/benchmark/隔离API及桌面移动浏览器通过。真实百炼72次尝试/60返回/12传输失败；已返回用量估算0.199881元，失败用量保守预留9.092990元，预算累计9.292870元。**创意产品验收仍失败，不能声称优于直接千问。**

[业务交付与体验入口](docs/engineering/intelligence-alpha-2026-10-29/README.md)、[真实失败与对照](docs/engineering/intelligence-alpha-2026-10-29/MODEL_RESULTS.md)、[完整测试](docs/engineering/intelligence-alpha-2026-10-29/TEST_REPORT.md)。以下保留上一轮报告。

---


## 2026-10-29：框架实证与首个共享物品切片

从 main `ea32c3f` 开独立分支，研究 RFC `69eb7c8` 和 v1 `8eca3d7`。框架实测收敛为继续 LangGraph；Mastra/Pi 留在独立实验子包，不进入根应用依赖。

实际改动：移植 v1 的有效工具、上下文、路由与条件修复及测试；新增 `context/knowledge.ts`，复用当前物品登记与产品资料，为聊天、创意和故事提供统一安全投影。快照不是持久版本或授权；记忆继续独立许可，故事模型只拿身份。

265 项业务测试、类型、benchmark、构建、cloud 替身、新版浏览器与新增赠画旅程通过。真实百炼 42 请求，估算 ¥0.0196844：工具和显式赠送事实可用；纸盒创意仍不合格，不能以 HTTP 200 或本地降级宣布成功。没有人类盲评、私人数据迁移、真实设备操作。

完整 [证据/失败](docs/engineering/framework-evidence-2026-10-29/TEST_REPORT.md)、[简短决策](docs/engineering/framework-evidence-2026-10-29/DECISION.md)、[下一轮源码清单](docs/engineering/framework-evidence-2026-10-29/NEXT_IMPLEMENTATION.md)。后续直接做关系来源与创意动作语义，不再扩展框架研究。
