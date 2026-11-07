# 物间 Wujian

最新一轮加入阿圆总控办事、日期回忆盒、物品形态分身、102 条启用灵感参考，以及 **物间 Agent 自己编写、检查和发布的耳机工作台**。实际功能、首测失败、修复与验收边界见[最后一轮交付与真实验收](docs/2026-11-07_最后一轮交付与真实验收.md)。追加三处上下文/检索投影小优化后，725项完整离线回归通过；前端沿用已验证的生产构建，OpenAPI的88条路径及契约不变。本轮另有4次真实千问交互验证。耳机生成作品另有实机操作证据，陌生型号自主指导仍未验收，不能混为全体智能能力通过。

通过理解人和物，连接使用帮助、创造玩法、共同经历和心意传递。当前为本地可运行的开发版，支持电脑和手机浏览器。

2026-11-07 补齐[物品生成形象随赠礼转移](docs/2026-11-07_物品形象赠礼转移修复与验证.md)：明确选中的外观接收后成为对方独立私有图片，私人性格与成长不自动传出；41 项相关回归及双账户真实浏览器/API 旅程通过。此次专项在临时数据库验证，主服务由负责人统一更新。

最新交互基础版本采用「物伴／物品／回忆／朋友」四栏，提供家庭用品、私人回忆、共同清单、逐步指导、提醒反馈、好友心愿与选择赠礼，并支持大字版。[交互基础版本与模块接口](docs/2026-11-05_交互基础版本与模块接口.md)说明共用契约、权限、迁移、后续模块接入及尚未验收的能力；[手机版整体产品与交互设计稿](docs/2026-11-05_物间手机版整体产品与交互设计稿.md)是功能参照。

2026-11-06 的创造、REA 指导、回忆、分身与名片开发见[本轮实施记录](docs/2026-11-06_创意回忆分身与名片实施记录.md)，来源读取取舍见[原文与图片证据改进](docs/2026-11-06_来源读取与生活创意证据改进.md)。分身核心接续与实际浏览器旅程已跑通；独立创意和 REA 首测仍有适配与事实错误，底座整体保持 NOT_ACCEPTED。

新增照片多物关联、有来源的分身特点及局部停止、自然回忆许可和临时社区连接，见[最新共同底座交付说明](docs/2026-11-06_照片回忆分身与创意共同底座交付说明.md)。前阶段344项回归通过；同日后续共同工作区403项回归及完整前端构建通过，新增常驻创意入口、SQL对话恢复与来源读取改进详见该文第10节。强制创意结构实验未证明收益，已撤回；工程通过不等于创意可行性或实机REA已通过。

同日限时改进见[两小时创意机制与家庭素材交付](docs/2026-11-06_两小时创意机制与家庭素材交付.md)：按用户最新标准撤下12类零碎材料，小林最终39件物品、34件家庭共享，新增明确品牌型号、用途和官方照片及17条B站原始参考；其中7条有关键画面并沉淀为可本地检索案例。逐项进度、视觉证据类型、失败来源续接和物品ID错误反馈已修正。463项工程回归通过，真实多轮结果与仍未通过处分别保留。

早期[验证记录](docs/2026-11-05_交互基础版本验证.md)包含当时50项工程回归和双账号电脑/手机浏览器使用旅程，保留作历史基线。

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

密钥只放本地 `.env`，不用发送到聊天或前端。`.env.example` 说明可选配置。普通对话、联网搜索、说明书图示识读和语义检索会调用百炼；离线测试不会。默认仅监听本机，公网演示需单独配置下文的 FRP 入口。

当前图片、PDF页图和视频采样帧由同一主模型观察。`QWEN_VISION_MODEL`配置保留供教学分支兼容，普通观察不额外调用它。AS2教学已接入共同物品／任务，包含材料分支、实拍标注、3D与相机辅助；公开演示包见[AS2复现说明](demo/as2/README.md)和[最小融合记录](docs/2026-11-07_最小融合交付记录.md)。既定课程与图示展示已经验证，不代表任意陌生设备都能自动生成正确课程，物理摄像头与实际压烫也未全面验收。若更换主模型，需核对多模态支持，不能把传图成功等同于理解正确。

## 队友首次安装

需要 Python 3.12、uv、Node.js 22.12+（本轮使用 Node 24 验证）。

```powershell
uv sync --cache-dir tmp/uv-cache
npm.cmd --prefix frontend ci --registry=https://registry.npmjs.org/ --cache=tmp/npm-cache
npm.cmd --prefix frontend run build
.venv\Scripts\python.exe -m wujian serve
```

首次使用前，将 `.env.example` 复制为 `.env` 并在本地填写密钥；已有 `.env` 请保留。`uv.lock` 和 `frontend/package-lock.json` 固定依赖。数据与原始资料保存在 `var/`，与源码分开；不要为了重新启动而删除它。关闭体验档案入口可设置 `WUJIAN_DEMO_MODE=false`。当前会话和部署设置用于本地原型，尚未完成公网生产加固。

负责人已授权将上传的物品实拍和演示对话随源码交付，详见[可下载展示数据包](demo/showcase/README.md)。首次在空数据库启动时，默认载入这些物品、照片、回忆、演示聊天及工作台；进入「小林的物间」即可查看。已有数据库不会被替换，请勿删除原`var/`。如需单独体验下载版，可在`.env`设置`WUJIAN_DATA_DIR=var-showcase`，使用独立数据目录；该目录应留在本机。设置`WUJIAN_SHOWCASE=false`可关闭展示包装载。耳机真实绑定不随演示数据分发，需要在本机重新连接；无百炼密钥也可浏览已保存的展示内容，新增AI回答仍需配置密钥。

公网演示请在本地 `.env` 设置 `WUJIAN_DEMO_ISOLATION=true` 并重启后端。小林、小夏、妈妈、姥爷的资料会为每位浏览器访客单独复制；同一 IP 下的访客也互不影响。退出后重新进入得到新的初始档案，操作过程中刷新仍保留该次进度。初始列表省略未完成的演示尝试，AS2 聊天排第一，课程从第一步开始；已发布工作台保留为可打开的完成作品。原始展示包与已有私人数据不会因此被删除。

Windows 下可使用 `scripts/start_sakura.ps1` 启动官方 Sakura FRP 客户端直连公网，不依赖 Clash；本地应用须已启动。将客户端下载到 `var/frp/frpc.exe`，在本地 `.env` 填写 `NATFRP_TOKEN` 与 `NATFRP_TARGET`（隧道 ID），隧道目标指向 `127.0.0.1:8000`。域名、HTTPS 证书和隧道需在自己的 Sakura 账户配置；不要提交客户端、证书私钥或访问凭据。停止隧道用 `scripts/stop_sakura.ps1`。若旧部署曾遇到“已完成”按钮关联错对话，可在停止应用后运行 `.venv/Scripts/python.exe scripts/repair_demo_conversation_links.py`；脚本先备份默认 SQLite，再恢复访客自己的任务、反馈和对话引用，保留原记录。使用自定义数据库时先自行备份，不直接运行此一次性修复脚本。

公开B站搜索与视频抽帧共用现有可选组件：安装 `uv sync --extra video --cache-dir tmp/uv-cache`。搜索只需yt-dlp；抽帧还需将本地 FFmpeg 可执行文件的绝对路径填入 `.env` 的 `FFMPEG_BINARY`（或把 FFmpeg 加入 PATH）。搜索通过既有Agent工具`search_public_web(..., community="bilibili")`按需选用，最多一页五条真实视频线索，不额外调用搜索模型；默认`web`仍走百炼。仅使用工具本次新建的匿名会话，不读取用户登录信息；受限时明确失败，不暗中切换收费搜索。视频观察仍只支持可匿名读取的单条BV、低清有界MP4和少量抽帧。搜索标题、原页文字与实际画面分开，不能当作全视频理解、字幕生成或教学动画。此电脑已经配置；队友不用这些可选能力时无需安装额外组件。

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
| `migrations/` | Alembic 版本迁移；已有资料保留，当前版本 0009，已有 SQLite 升级前备份；消息记录回执只存摘要与记录ID |
| `wujian/interactions.py`、`interaction_routes.py` | 四栏工作区、家庭、回忆用途、清单协作、提醒反馈与心愿接口 |
| `wujian/foundation.py` | 认识依据、纠正/期限、任务版本、反馈与状态的共同业务操作 |
| `wujian/retrieval.py` | ReMe 混合检索；索引是可重建投影，SQL 是事实来源 |
| `wujian/turns.py` | AgentScope 原生最终输出契约；回答与持续计划一次提交 |
| `wujian/learning.py` | 主 Agent 的结构化认识更新、当前用户依据与型号适用性核对 |
| `wujian/continuity.py`、`source_access.py` | 家庭共享和赠礼中的公开商品证据接续；私人理解不混入 |
| `wujian/agent_runtime.py` | AgentScope 主循环接入、工具、上下文和任务结果 |
| `agent_skills/` | 按需加载的产品指导、创意探索与设备个性化技能，共用同一组业务对象 |
| `wujian/devices.py` | 项目内 REA MCP 生命周期、连接目标、观察证据与显式操作 |
| `wujian/knowledge.py` | 百炼真实搜索、原始网页/PDF 获取、引用与页图读取 |
| `wujian/source_video.py` | 可选 yt-dlp 平台解析与 FFmpeg 本地抽帧；同一来源与资产体系，原始网页和抽帧来源分开 |
| `wujian/community_search.py`、`community_sources.py` | 复用yt-dlp或可选MediaCrawler客户端；公开搜索线索和详情进入同一SourceRecord，不能冒充视频理解 |
| `wujian/mediacrawler_session.py`、`mediacrawler_worker.py` | 显式临时扫码、用户隔离、TTL与真实子进程清理；账号仅在RAM，模型不拿Cookie |
| `wujian/photo_matching.py`、`photo_matching_routes.py` | 识别回忆照片中的已有实物，可靠实例关联与歧义人工纠正，共同版本化Experience writer |
| `wujian/persona_models.py`、`memory_lifecycle.py` | 有情境和来源的相处特点、停止与纠正、共享SQL上的当前分身有效投影 |
| `wujian/server.py` | 登录、API、流式进度、文件权限与静态界面服务 |
| `frontend/src/features/` | 按物伴、物品、回忆、朋友、事项和共同表单拆分的响应式界面；`src/generated/api.ts` 自动生成 |
| `fixtures/development/catalog.json` | 中国大陆型号及非标物开发样本；不预置操作答案 |
| `fixtures/development/foundation_scenarios.json` | 26 件物品旅程所用的新增型号、真实约束和虚构生活情境 |
| `scripts/evaluate_foundation.py` | 在隔离数据目录中运行真实模型旅程，保留首答，不当作独立验收 |
| `tests/` | SDK 集成、共享身份、权限、赠礼与必要业务规则 |

修改公共接口：先改 Pydantic，重新导出 OpenAPI 和前端类型，再更新调用方。功能调用已有业务操作，不再建立另一套物品或记忆。数据库启动时应用迁移；结构变化新增迁移，不能以删除 `var/` 或静默 `create_all` 代替。备份保存在 `var/backups/`。

## REA 前置准备与今晚接入

现在可以从物品卡的新玩法／工作台入口使用本机适配器，或直接请阿圆制作工具。对于已配对、经协议身份核验的 Huawei FreeBuds 4E，Python 服务可读取电量、控制已支持的降噪模式，并通过 Pycaw 读取／调整绑定的 Windows 输出端点音量；协议、回读和实机边界见[耳机连接器说明](wujian/earbuds/PROTOCOL.md)。这条路径不依赖下述通用 REA MCP 服务。

`coding_workbench.py` 给主 Agent 提供逐文件编写、浏览器检查和发布能力，作品保存在同一物品的任务／私有素材内。检查使用已安装 Chrome 与 Playwright，队友安装 Python 依赖后需有本机 Chrome，缺失时会明确失败，不静默下载浏览器。作品在隔离 iframe 运行，设备写入需要物间外层真实点击确认；读取、模拟检查、ACK 回读和佩戴听感分别表达。当前有限消息桥不是任意宿主 shell 或驱动开发权限。

其他软件／浏览器目标仍可采用项目内 REA 6.8.0：这台电脑曾验证真实 MCP 握手及229个工具发现。队友首次准备运行：

```powershell
npm.cmd exec --cache D:/D盘桌面/wujian_final/tmp/npm-cache --registry=https://registry.npmjs.org/ --yes --package=rea-agents@6.8.0 -- rea --help
```

其他目录安装时改用对应绝对缓存路径，或把实际 `rea.mjs` 路径写入本地 `WUJIAN_REA_ENTRY`。不修改 Codex 全局配置。REA 在明确请求连接时启动，应用关闭时清理。工具目录不会全量塞入模型。

物品详情 → 更多 →「连接设备与探索」是原通用连接入口，支持本机浏览器调试入口和已授权的 JavaScript/Electron 软件包。后者默认放入 `var/device-artifacts/`，或使用本地 JSON 数组配置 `WUJIAN_REA_ARTIFACT_ROOTS`。其他实际设备的控制软件、协议或网页入口到位后，再选对应适配路径，不从耳机已适配推成任意硬件均可控制。

后端具有连接、探索、操作提案、显式执行与证据读取 API；界面当前提供连接与先探索入口。尚未连接你的显示屏，也尚未完成实际屏保改变。照片录入和 MCP 连通都不等于设备可控制；执行仍需具体目标和可用控制通道。

## 真实开发验证

以下会调用本地配置的百炼账号，使用新建隔离目录和明确虚构的生活记录：

```powershell
.venv\Scripts\python.exe scripts/evaluate_foundation.py --real --only all
```

可将 `all` 换为 `manual`、`memory`、`cases`、`journey`、`gift` 或 `rea` 进行针对性复测。结果在 `var/evaluations/<时间>/results.json`，既保留成功也保留失败。工程回归、开发复测和独立验收分开；不能把运行完成数当作智能质量通过数。

## 当前边界

已接通真实千问对话、工具调用、联网查资料、图片输入、跨会话私人理解及基础回忆/赠礼闭环。智能质量仍需独立验收，不能用工程测试数量代替。

真实测试已观察到跨新会话恢复同一任务、按反馈改计划、主动记录多物回忆、选择性赠礼、分身局部停止及MC自主搜集后观察视频。收到故事的主体混淆保留首答失败，修后有限案例已正确保留未知并呈现原作者；不能推为普遍可靠。创意物理适配和REA证据语义仍不稳定，长任务达到数分钟。陌生物品18题独立验收尚未执行。

天猫订单导入、系统级到时推送、实体物流、完整图形分身成长、自动语义冲突判定、跨账号共建商品知识库尚未实现。回忆上传后已有物品照片关联已接通，但跨视角实例识别未全面验收；提醒目前是应用内事项与完成状态。
