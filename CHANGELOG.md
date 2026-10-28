# Changelog

Notable changes to ProductAgent / 物间 are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions use [Semantic Versioning](https://semver.org/) when the repository begins publishing tagged releases.

## [Unreleased]

### 2026-10-29｜决赛第一阶段审计

- 基于GitHub main `ea32c3f`，建立独立分支上的中文技术审计、两张真实架构图、测试/费用证据和长期决策入口。
- 191项离线测试、类型与生产构建通过；保留浏览器路径/旧定位器失败及隔离复验，不以绿色基础测试冒充智能验收。
- 22次真实百炼尝试（21 HTTP200、1超时），全部合成输入；记录工具往返、库存指代/属性丢失/无据保证等失败。没有产品源码修复、框架迁移或部署。
- 新增审计探针、离线诊断、公开测试定位器副本与证据整理脚本，默认不付费。详细见docs/finals/。

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
