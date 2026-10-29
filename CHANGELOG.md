# Changelog

## 2026-10-29 · 智能核心 Alpha（独立分支）

- 新增两款型号明确的官方商品知识实验与显式合成测试入口；详情、聊天和创意共用资料。
- 自然聊天可建议有原话来源的记忆候选，确认前不作为长期认识；保留私密、纠正与遗忘。事实型赠送者回忆避免编造留言。
- 创意新增性质到作用/成果/条件结构，修复勾选物品被部分名称匹配删除、否定粘贴误判、引用命名空间和修复上下文隐私；明确否决不取回坏草稿，不自动用观察模板冒充新用途。
- 增加24项离线回归、商品来源解析、同模型真实对照与桌面/移动验收脚本。创意真实质量未过关；[交付与完整证据](docs/engineering/intelligence-alpha-2026-10-29/README.md)。

---


Notable changes to ProductAgent / 物间 are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions use [Semantic Versioning](https://semver.org/) when the repository begins publishing tagged releases.

## [Unreleased]

### 2026-10-29：框架实证与共享物品资料切片

- 在独立实验子包比较 LangGraph、Mastra、Pi Core/Durable；继续使用 LangGraph，未替换框架或根应用依赖。
- 选择性移植未合并 v1 的物品读取、工具回合、路由/否定、条件和失败处理修复与测试，重新验收；不是声称 main 原有能力。
- 新增共享物品资料安全投影与内容快照，连接聊天、创意和故事；故事上云只带必要身份，不扩展记忆许可，不建新业务表。
- 265 项业务回归通过，新增跨会话赠画/遗忘/越权浏览器验收；真实百炼 42 请求，纸盒创意仍未达标，保留失败。
- 详细结果与直接开发清单见 [本轮交付](docs/engineering/framework-evidence-2026-10-29/README.md)。

### Changed

- Reorganized the repository around a product-first README, product brief, architecture, demo guide, deployment guide, and validation record.
- Made `npm run dev` and `npm start` launch the working local demo with an isolated data directory.
- Consolidated ModelScope notes into maintainable documentation.

### Added

- Offline GitHub Actions validation for type checking, tests, and production build.
- Security, contribution, and third-party notices for public collaboration.
- A cross-platform offline test launcher that prepares the isolated runtime directory on a fresh checkout.

### Fixed

- Updated historical showcase assertions from 3 to the current 4 synthetic stories.

## [0.1.0] - 2026-10-21

### Added

- Next.js 15 / React 19 life-object workspace with an optional Chinese-language Agent.
- Versioned product evidence, manual ingestion, source tracking, and grounded help checks.
- Life stories, memory candidates, chapter organization, family tasks, gifts, and privacy controls.
- Offline rule-based ideas plus optional Qwen planning through an OpenAI-compatible provider.
- Docker/ModelScope configuration with isolated visitors, quotas, upload limits, and model cost gates.
- Idempotent synthetic showcase with 25 items, 4 ideas, 4 stories, and 2 chapters.
- Unit, domain, reliability, and browser acceptance test suites.


## 2026-10-29 智能行为与创造力实验版

独立分支 codex/wujian-intelligence-behavior-v1，从 Alpha 7c51317 开发，未合并 main。详见 [交付说明](docs/engineering/intelligence-behavior-2026-10-29/README.md)、[测试报告](docs/engineering/intelligence-behavior-2026-10-29/TEST_REPORT.md) 和 [匿名原始样本](docs/engineering/intelligence-behavior-2026-10-29/REVIEW_SAMPLES.md)。

已实现：完整型号资料综合问答、诚实摘录回退、两回合创意资源池子集、反馈主动再探索、收藏/结果/备注并发写入修复。真实浏览器的生成—展示—收藏—否定—再探索及桌面/移动端跑通。307/307离线、类型、生产构建、benchmark、6个集成旅程及8组公开演示替身检查通过。真实模型60次、57返回/3失败；已知usage估算0.2114072元，含无usage保守预留合计0.49414元，额度耗尽停止。

尚未实现：可靠的物理/动作语义验证或已证明的创造力提升。qwen3-max两次404，未启用。原始差样本、夹具错误和补测限制均保留；没有外部盲评或物理试用。下一步先解决创意机制错误，不扩展框架、数据库、数字分身或REA。本机独立预览费用关闭；凭证、SQLite、依赖和运行缓存不入Git。
