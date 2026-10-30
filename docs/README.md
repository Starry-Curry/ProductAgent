# 文档索引

- [2026-10-30 统一家庭体验 Beta：流程、真实来源及未过关的内容](engineering/unified-home-beta-2026-10-30/README.md)

## 2026-10-29：商品、关系与可选分身纵向开发

- [实际业务流程、测试与真实效果限制](engineering/personal-objects-2026-10-29/README.md)：已接入App；个性化回答未全部过关。

README 负责快速运行，以下文档分别回答产品、工程、演示和部署问题。

## 2026-10-29：智能核心 Alpha

- [业务交付、体验方法与真实失败](engineering/intelligence-alpha-2026-10-29/README.md)。商品知识和自然候选已接入；创意未过产品验收，不能以技术测试通过替代效果。

## 2026-10-29：框架实证与共享资料产品切片

- [本轮结论与实际改动](engineering/framework-evidence-2026-10-29/README.md)：保留 LangGraph，移植 v1 修复，接入最小共享物品资料。
- [测试与真实失败](engineering/framework-evidence-2026-10-29/TEST_REPORT.md)、[下一轮直接开发](engineering/framework-evidence-2026-10-29/NEXT_IMPLEMENTATION.md)。
- [V2 RFC 的固定成果](https://github.com/Starry-Curry/ProductAgent/tree/69eb7c8791ca0fa85a8b105827705b5e75df5230/docs/architecture-v2) 是设计依据，不等于 main 或本轮产品已全部实现。

## 推荐阅读顺序

| 顺序 | 文档                        | 适合谁                       |
| ---- | --------------------------- | ---------------------------- |
| 1    | [根 README](../README.md)   | 第一次访问仓库、准备运行的人 |
| 2    | [产品方案](PRODUCT.md)      | 评审、产品、设计与潜在用户   |
| 3    | [演示指南](DEMO_GUIDE.md)   | 需要现场讲解或复现体验的人   |
| 4    | [技术架构](ARCHITECTURE.md) | 工程、算法与安全评审         |
| 5    | [部署说明](DEPLOYMENT.md)   | 本地容器或公开演示维护者     |
| 6    | [验证记录](VALIDATION.md)   | 需要判断完成度和风险边界的人 |

## 工程与协作

- [贡献指南](../CONTRIBUTING.md)
- [安全策略](../SECURITY.md)
- [变更记录](../CHANGELOG.md)
- [第三方组件与素材](../THIRD_PARTY_NOTICES.md)
- [最终验收 JSON](validation/final-validation-2026-10-21.json)
- [部署核验 JSON](validation/deployment-check-2026-10-21.json)

## 证据原则

仓库会显式区分以下来源：

1. **预置演示内容**：为了让新访客看到完整体验而写入的合成数据。
2. **本地规则或资料检索**：可以离线执行，但不等于在线模型能力。
3. **模型生成内容**：来自已配置模型，仍需通过结构、证据和行动条件校验。
4. **真实验收记录**：有日期、环境、请求结果和剩余限制。
5. **产品构想**：尚未由当前代码实现的能力，只在路线图中出现。

演示图片、合成故事和 AI 生成类别图都不代表用户的真实物品、真实经历或型号实拍。

- [2026-10-29 智能行为与创造力：业务实现、真实对照、失败与匿名样本](engineering/intelligence-behavior-2026-10-29/README.md)

- [2026-10-30 统一家庭连续体验与真实质量失败记录](engineering/continuous-experience-2026-10-30/README.md)

- [2026-10-30 开放创造力 V2：实际交互、对照与失败证据](engineering/creativity-v2-2026-10-30/README.md)
