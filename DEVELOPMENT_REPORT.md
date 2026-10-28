# 决赛升级开发报告

## 2026-10-29：可信物品理解与工具链

先发布了已有审计，独立审计分支提交 `bc03b76f53af8d6bf336e3f969c13014cea5c616`。随后从最新 main 的 `ea32c3f4c9e18992ca267b6dd74e26e418c9e95a` 安全克隆到 `.runtime/finals-item-understanding-v1`，分支 `codex/finals-item-understanding-v1`。原工作区及未提交成果保持原样。

本轮修改集中在上下文、路由、模型／工具循环、有限条件检查和创意失败处理；新增可复现测试、真实 API 费用闸门与公开证据。复用业务字段，没有数据库迁移、前端重设计、设备操作或生产框架替换。协作规则写入 AGENTS.md：隔离分支，自动相关测试、定位、提交和推送，禁止直合 main、强推、全局 Git 修改和泄露秘密。

新增 65 项回归，加原 191 项共 256 项。真实模型共 148 请求、输入 444,076／输出 38,862 tokens，按官方标准价估算 0.4329848 元。HTTP 200 全部返回，其中 6 次长度截断；产品仍有拒绝与降级。费用不是账单。对照过程、失败文本和迭代阶段完整保留，不能把最后的定向样例说成独立创新度验证。

Pi 只在 `experiments/pi-item-loop` 安装固定 1.4.0；正常重开与读取幂等测试通过，但未做强杀、外部写入或百炼适配验证。不据此决定迁移。

- [一页说明与架构](docs/finals/item-understanding-v1/README.md)
- [测试报告与原始证据](docs/finals/item-understanding-v1/TEST_REPORT.md)
- [原因、替代方案、剩余风险和下一轮实验](docs/finals/item-understanding-v1/DECISIONS.md)
