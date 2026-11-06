# 物间 Wujian

2026-11-06：[物品名片与新玩法入口修正](docs/2026-11-06_物品名片与新玩法入口修正.md)。物品点击后进入完整名片；发现新玩法回到物伴与阿圆聊天，复用真实检索、原文和持续事项。

通过理解人和物，连接使用帮助、创造玩法、共同经历和心意传递。当前为本地可运行的开发版，支持电脑和手机浏览器。

最新交互基础版本采用「物伴／物品／回忆／朋友」四栏，提供家庭用品、私人回忆、共同清单、逐步指导、提醒反馈、好友心愿与选择赠礼，并支持大字版。[交互基础版本与模块接口](docs/2026-11-05_交互基础版本与模块接口.md)说明共用契约、权限、迁移、后续模块接入及尚未验收的能力；[手机版整体产品与交互设计稿](docs/2026-11-05_物间手机版整体产品与交互设计稿.md)是功能参照。

本轮 [验证记录](docs/2026-11-05_交互基础版本验证.md)包含 50 项工程回归和双账号电脑/手机浏览器使用旅程，并区分界面业务验证与智能/实物验收。

当前仓库主线采用这份 Python/FastAPI + React/Vite 实现。2026-11-05 经产品负责人授权，将本地最新基线同步到 main/develop；原 TypeScript/Next.js 实现保留在归档标签和提交历史中。[主线同步与分支归档](docs/2026-11-05_主线同步与分支归档.md)说明恢复点与团队接入变化。当前仍是工程基线，智能底座未验收通过，不代表已经对外部署。

共同开发先阅读[产品功能、交互与总体架构审计](docs/2026-11-05_物间产品功能交互与总体架构审计.md)、[代码、数据库与技术架构审计](docs/2026-11-05_物间代码数据库与技术架构审计.md)和[贡献指南](CONTRIBUTING.md)。新功能从 develop 建分支，复用共同业务对象、迁移和接口。

产品约定见 [开发基线](04_物间_开发基线与协作约定.md)，实际架构见 [底座机制实施与真实验证](docs/2026-11-04_底座机制实施与真实验证.md)，最新修复和仍未通过的项目见 [底座缺口修复与验收状态](docs/2026-11-04_底座缺口修复与验收状态.md)。01、02、03 原文件保留；冲突以用户后续明确约定为准。

[任务计划与实施状态](05_物间_产品深度对齐与智能底座任务计划.md)包含理解人、创造力、REA 接入、阶段验收与产品完整度待办。当前共享机制已接通并经过工程回归；创意、分身事实准确性和响应时间尚未达到产品验收要求。

## 现在打开

服务启动后访问 **http://127.0.0.1:8000**。可以注册自己的账号，或在登录页进入「小林的物间」「小夏的物间」体验两方赠礼。体验档案中的拥有关系、个人经历和联调物品为模拟数据；模型回答来自真实百炼调用。

这台电脑已安装本项目依赖并构建界面，重新启动只需在项目目录运行：

```powershell
.venv\Scripts\python.exe -m wujian serve
```

也可双击 `start-wujian.cmd`。窗口中的 Ctrl+C 停止服务。若提示端口被占用，已有实例可能正在运行，可直接打开上述地址。

密钥只放本地 `.env`，不用发送到聊天或前端。`.env.example` 说明可选配置。普通对话、联网搜索、说明书图示识读和语义检索会调用百炼；离线测试不会。默认仅监听本机；本轮没有购买资源、开通云服务或对外部署。

## 队友首次安装

需要 Python 3.12、uv、Node.js 22.12+（本轮使用 Node 24 验证）。

```powershell
uv sync --cache-dir tmp/uv-cache
npm.cmd --prefix frontend ci --registry=https://registry.npmjs.org/ --cache=tmp/npm-cache
npm.cmd --prefix frontend run build
.venv\Scripts\python.exe -m wujian serve
```

首次使用前，将 `.env.example` 复制为 `.env` 并在本地填写密钥；已有 `.env` 请保留。`uv.lock` 和 `frontend/package-lock.json` 固定依赖。数据与原始资料保存在 `var/`，与源码分开；不要为了重新启动而删除它。关闭体验档案入口可设置 `WUJIAN_DEMO_MODE=false`。当前会话和部署设置用于本地原型，尚未完成公网生产加固。

## 开发与验证

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -v
.venv\Scripts\python.exe -m wujian validate fixtures/development/catalog.json
.venv\Scripts\python.exe -m wujian openapi contracts/openapi.json
npm.cmd --prefix frontend run types
npm.cmd --prefix frontend run build
```

开发界面可另外运行 `npm.cmd --prefix frontend run dev`。Vite 将 `/api` 代理到后端；日常体验直接使用后端提供的同源构建版。

## 实现与协作入口

| 文件 | 职责 |
|---|---|
| `wujian/api_models.py` | 真实 API 的输入输出契约；生成 OpenAPI 与前端类型 |
| `wujian/domain.py` | 界面、Agent 共用的物品、经历、私人理解、共享与赠礼操作 |
| `wujian/database.py` | SQLAlchemy 业务数据；本地默认 SQLite |
| `migrations/` | Alembic 版本迁移；已有资料保留，当前版本 0006，已有 SQLite 升级前备份 |
| `wujian/interactions.py`、`interaction_routes.py` | 四栏工作区、家庭、回忆用途、清单协作、提醒反馈与心愿接口 |
| `wujian/foundation.py` | 认识依据、纠正/期限、任务版本、反馈与状态的共同业务操作 |
| `wujian/retrieval.py` | ReMe 混合检索；索引是可重建投影，SQL 是事实来源 |
| `wujian/turns.py` | AgentScope 原生最终输出契约；回答与持续计划一次提交 |
| `wujian/learning.py` | 主 Agent 的结构化认识更新、当前用户依据与型号适用性核对 |
| `wujian/continuity.py`、`source_access.py` | 家庭共享和赠礼中的公开商品证据接续；私人理解不混入 |
| `wujian/agent_runtime.py` | AgentScope 主循环接入、工具、上下文和任务结果 |
| `agent_skills/` | 按需加载的产品指导与创意探索技能，共用同一组业务对象 |
| `wujian/devices.py` | 项目内 REA MCP 生命周期、连接目标、观察证据与显式操作 |
| `wujian/knowledge.py` | 百炼真实搜索、原始网页/PDF 获取、引用与页图读取 |
| `wujian/server.py` | 登录、API、流式进度、文件权限与静态界面服务 |
| `frontend/src/features/` | 按物伴、物品、回忆、朋友、事项和共同表单拆分的响应式界面；`src/generated/api.ts` 自动生成 |
| `fixtures/development/catalog.json` | 中国大陆型号及非标物开发样本；不预置操作答案 |
| `fixtures/development/foundation_scenarios.json` | 26 件物品旅程所用的新增型号、真实约束和虚构生活情境 |
| `scripts/evaluate_foundation.py` | 在隔离数据目录中运行真实模型旅程，保留首答，不当作独立验收 |
| `tests/` | SDK 集成、共享身份、权限、赠礼与必要业务规则 |

修改公共接口：先改 Pydantic，重新导出 OpenAPI 和前端类型，再更新调用方。功能调用已有业务操作，不再建立另一套物品或记忆。数据库启动时应用迁移；结构变化新增迁移，不能以删除 `var/` 或静默 `create_all` 代替。备份保存在 `var/backups/`。

## REA 前置准备与今晚接入

这台电脑已验证项目内 REA 6.8.0 的真实 MCP 握手及 229 个工具发现。队友首次准备运行：

```powershell
npm.cmd exec --cache D:/D盘桌面/wujian_final/tmp/npm-cache --registry=https://registry.npmjs.org/ --yes --package=rea-agents@6.8.0 -- rea --help
```

其他目录安装时改用对应绝对缓存路径，或把实际 `rea.mjs` 路径写入本地 `WUJIAN_REA_ENTRY`。不修改 Codex 全局配置。REA 在明确请求连接时启动，应用关闭时清理。工具目录不会全量塞入模型。

物品详情 → 更多 →「连接设备与探索」。当前支持本机浏览器调试入口和已授权的 JavaScript/Electron 软件包。后者默认放入 `var/device-artifacts/`，或使用本地 JSON 数组配置 `WUJIAN_REA_ARTIFACT_ROOTS`。实际设备的控制软件、协议或网页入口到位后，再选对应适配路径。

后端具有连接、探索、操作提案、显式执行与证据读取 API；界面当前提供连接与先探索入口。尚未连接你的显示屏，也尚未完成实际屏保改变。照片录入和 MCP 连通都不等于设备可控制；执行仍需具体目标和可用控制通道。

## 真实开发验证

以下会调用本地配置的百炼账号，使用新建隔离目录和明确虚构的生活记录：

```powershell
.venv\Scripts\python.exe scripts/evaluate_foundation.py --real --only all
```

可将 `all` 换为 `manual`、`memory`、`cases`、`journey`、`gift` 或 `rea` 进行针对性复测。结果在 `var/evaluations/<时间>/results.json`，既保留成功也保留失败。工程回归、开发复测和独立验收分开；不能把运行完成数当作智能质量通过数。

## 当前边界

本轮自然教学、按需 3D 和自动相机辅助的链路、复用来源、真实测试与已知不足，见 [自然教学与自动视觉辅助](docs/2026-11-06_自然教学与自动视觉辅助.md)。

已接通真实千问对话、工具调用、联网查资料、图片输入、跨会话私人理解及基础回忆/赠礼闭环。智能质量仍需独立验收，不能用工程测试数量代替。

真实测试已观察到跨新会话恢复同一任务、按失败反馈修改计划、主动记录多物回忆和选择性赠礼。但创意仍会过度肯定未经验证的效果，分身仍会混淆所收到故事的经历主体；仅增加作者来源尚未使模型可靠遵循。长任务达到数分钟，尚需改进。陌生物品目前只有开发样本成功，18 题独立验收尚未执行。

天猫订单导入、系统级到时推送、实体物流、自动照片归档、完整图形分身成长、自动语义冲突判定、跨账号共建商品知识库尚未实现。提醒目前是应用内事项与完成状态。
