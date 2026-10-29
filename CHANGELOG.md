# Changelog

## 2026-10-30：统一家庭体验 Beta（独立分支，内容验收未全部通过）

基准 `codex/wujian-personal-objects-v1@113696effe5f7f162fe9dccfbdf0bb64a7737d55`，分支 `codex/wujian-unified-home-beta`，隔离工作区 `D:/ProductAgent-LifeContext/.runtime/unified-home-app`。保留原项目未提交的 `deliverables/`，未合main、迁私人数据库、换框架或控制硬件。

已接入固定7款真实SKU与模拟赠画、一键家庭加载和明确云端许可；实际取得各商品至少一份官方资料（含规格、说明PDF和真实失败记录）。首页→统一任务→相关物品/故事→分身→原任务的流程已连通。使用现有LangGraph/SQLite会话、授权、记忆及反馈；普通真实物品空间仍保留旧路径，未宣称已把任意真实家庭全部迁入新机制。

329项离线通过（新增14）；类型、生产构建、benchmark、原纵向6条替身浏览器旅程和公开演示8组离线检查通过。新家庭6次真实问答与反馈、桌面/移动页面实际跑通；移动端另一个合成角色的跨会话纠正、遗忘及越权阻止通过。真实模型52次请求，50次提供方返回、2次失败；API返回和引用检查不能代替内容验收。

**内容仍有明确失败：未登记材料、未经证实的空余空间/支撑、旋钮方向及过早重置等。** 强模型小样本没有实证收益，未采用替换。下一轮先解决依据与动作、资源条件之间的约束，不先加REA或换框架。[可体验流程与来源](docs/engineering/unified-home-beta-2026-10-30/README.md)、[测试](docs/engineering/unified-home-beta-2026-10-30/TEST_REPORT.md)、[真实回答与失败](docs/engineering/unified-home-beta-2026-10-30/MODEL_RESULTS.md)。下方历史记录保留。


## 2026-10-29 最新交接：商品、关系与可选分身纵向版（未合并main）

独立分支 `codex/wujian-personal-objects-v1`，基准行为版 `d02b35e`，工作区 `D:/ProductAgent-LifeContext/.runtime/personal-objects-app`。请先读[本轮可体验流程及明确限制](docs/engineering/personal-objects-2026-10-29/README.md)、[测试报告](docs/engineering/personal-objects-2026-10-29/TEST_REPORT.md)和[真实回答](docs/engineering/personal-objects-2026-10-29/MODEL_RESULTS.md)。原项目与私人数据库未修改，没有迁库、换框架、操作硬件或合并main。

已接入三款经核对商品的认识与明确持有、公共知识/个人状态分区、图文故事确认关系记忆、可选名字/六种形象/语气与统一Agent交流、来源撤回和隐私检查。新增8项，315离线通过；类型/构建/benchmark、既有6浏览器旅程、公开演示8组离线检查与生活/文件两旅程通过。本轮真实百炼14请求/14返回，输入65004、输出4571tokens，估算0.0611452元；预览后续操作继续累计40次/10元台账。

**技术流程通过不等于产品效果通过：商品个性化帮助仍回退资料，分身错称用户、混合问题漏答、摆放建议缺乏实物依据仍未解决。** 下一轮先修回答与行动建议的证据衔接和角色身份，不扩大功能、换框架或宣称实体方案安全。以下保留历史记录。

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


## 2026-10-30：统一家庭连续体验修复

继续 `codex/wujian-unified-home-beta`，基于0c6851a。首页目标入口前移；物品详情增加聚焦单件的新用途探索、可选其他资源、逐方案继续；明确同意后才将反馈备注带入旧会话，修复前端丢弃planContext和hash导航问题。家庭偏好共享严格限于获准模拟范围，原空间私人偏好不混入。工具使用严格映射的本轮短引用，不模糊放行拼错ID。

真实浏览器完成生成、收藏、反馈、返回原会话及390px手机操作；但所生成方案物理机制不成立，已经页面标为不采用。98次真实请求（96 qwen-plus、2 qwen-max），估算0.8471632元，非账单；提供者返回不代表产品正确。模型复核实验效果不足，默认关闭；不采用qwen-max为默认。自动测试、构建不能证明智能或创意成熟。详细失败和证据见 [连续开发报告](docs/engineering/continuous-experience-2026-10-30/README.md)。无真实硬件、私人数据库或main合并。
