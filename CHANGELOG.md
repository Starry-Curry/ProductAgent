# Changelog

Notable changes to ProductAgent / 物间 are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions use [Semantic Versioning](https://semver.org/) when the repository begins publishing tagged releases.

## [Unreleased]

### 决赛升级第一轮（2026-10-29，独立功能分支，未部署）

- 修复已登记物品指代、否定拍照等目标识别；保留一般模型理解路径。
- 新增复用现有字段的物品上下文、授权分页／详情工具、来源与未知项；不自动读取私人备注和故事。
- 本地与公开演示允许完整工具往返，分开限制模型回合、工具调用和修正；保留费用、权限、幂等与确认写入。
- 补充物品条件检查、撤权／条件变化中止；区分创意候选不合格、超时与明确本地降级。
- 新增 65 项回归（总计 256）；发布 148 次真实百炼请求的对照、失败与费用台账，估算 0.433 元；没有真人创新度评分或实物验证。
- 增加独立 Pi 1.4.0 离线工具 PoC；生产仍为 LangGraph。建立中文状态、决策、测试与自动独立分支交付规则。
- 详见 [本轮报告](docs/finals/item-understanding-v1/README.md)。历史条目保留。

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
