# 物间 · ProductAgent

围绕**具体物品、人与物的故事、人与人的协作**提供持续帮助：不会用时提问，平时留下经历、发现用途，需要时请家人接力或把故事随礼物传递。

当前是可运行的本机演示工程，技术栈为 Next.js 15 / React 19 / TypeScript / Node.js **24** / SQLite / LangGraph.js。唯一开发目录为 D:\Project\Tianmao\ProductAgent；[源码仓库](https://github.com/Starry-Curry/ProductAgent)。已从 2026-10-17 精简审查包导入并持续深化。

## 先启动与体验

本机已有依赖和项目 Node24：双击根目录 **START.cmd**，打开 http://127.0.0.1:3100 。开发启动可用 scripts/windows.ps1 -Task dev。

新电脑：

~~~powershell
npm.cmd ci
npm.cmd run build
npm.cmd run start:local
~~~

须先安装 Node24。服务只监听 127.0.0.1；顶部人物是演示身份，尚无真实登录与跨设备家庭账户。

1. 首页点“试试分步帮助”，再点“帮我解决”，体验 Windows 11 设置、步骤尝试与结果反馈；无需付费模型调用。
2. 打开一件物品 → **故事与记录**，像平时一样讲述它与你或家人的经历。原始故事留在物品下，开启自动整理时静默提取相关记忆，无需填写个人档案。
3. 在“记忆与陪伴”查看依据、纠正、忘记或暂停；需要陪伴交流时主动开启。发现与活动准备围绕已有可用物品，家庭和礼物仍遵循原权限与故事选择。

首页已补充 8 个有官方资料的家居案例，包含合成故事、关系记忆和家庭事项；默认展示 4 个，可展开全部。初始背景介绍可保存或跳过一次，其余新增记忆通过物品对话完成。演示内容与真实画像、物资清单隔离，详情见 [家居案例与入口调整](docs/engineering/household-cases-and-onboarding-2026-10-18.md)。

网页内有 [/guide 操作指南](http://127.0.0.1:3100/guide)；完整功能矩阵与验收见 [当前产品和使用指南](docs/engineering/current-product-guide-2026-10-18.md)。

## 当前能力与边界

| 入口 | 当前能做什么 |
| --- | --- |
| 使用帮助 | 不建档先问、连续澄清、有限官方步骤、尝试/结果反馈、后关联物品、预览后家庭交接、售后入口 |
| 我的物品 / 故事与记录 | 档案与型号、共享范围、人与物讲述、私人故事时间线、来源记忆与当前物品回忆 |
| 活动准备 / 发现 | 有限规则规划、资料约束核对、精选妙用、明确兴趣与当前方向、收藏/尝试记录 |
| 家庭事项 | 维护、清洁、采购、提醒、协助；负责人、进展和用户确认完成 |
| 礼物与记忆 | 已建档物品、精选原故事快照、预览与认领分开、保留原作者、后续私人记忆隔离 |

已接通北京百炼 qwen-plus，上一轮有真实在线与浏览器验证；本轮静默记忆使用本地规则，不额外发起模型调用。商品资料仍为 **11 个版本包、33 条事实、2 个有限过程**。讲述窗口当前是本地叙述确认/回忆，尚非模型自由对话或完整语义理解。

照片目前只作档案；没有真实 OCR/拍照识物、订单同步、IoT、全品类说明书库、跨设备公开分享或自动 Skill 上线。关怀是演示信号，用户反馈有效不代表实物检测。

## 模型、记忆与数据

新克隆复制 .env.example 为 .env.local，仅在本机填 AI_API_KEY；北京地址为 https://dashscope.aliyuncs.com/compatible-mode/v1 。确认费用后才把 AI_ALLOW_PAID_CALLS 设为 true。本机已有 Key 和可用配置保持；凭证仅用于服务端认证，不展示、不入 Git。

记忆以本人对物品的故事为主，聊天、持有登记、要求与反馈作补充；默认本地整理、默认不上云。普通问答当前必要问题可能交给云端；历史私人记忆逐条授权。临时提问不保存或使用个人记忆。暂停只停止派生整理；忘记派生记忆不会删除原始故事或旧备份，但会阻止原来源再次自动生成同条记忆。

日常数据 data/demo.sqlite。v4 增量升级前保留 SQLite 备份；测试使用独立 PRODUCT_AGENT_DATA_DIR。架构、提取闭环、来源/范围/失效设计见 [技术设计](docs/engineering/ambient-memory-architecture-2026-10-18.md)。

## 开发验证与交接

~~~powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:benchmark
npm.cmd run build
npm.cmd run test:acceptance
~~~

acceptance 自动使用独立数据库和端口、关闭真实模型，Windows Edge 执行原业务和物品故事旅程。真实模型、实物和真实用户体验不能由离线测试代替。

- [当前实现状态](IMPLEMENTATION_STATUS.md)、[开发报告](DEVELOPMENT_REPORT.md)、[技术交接](REVIEW_HANDOFF.md)
- [文档目录](docs/README.md)、[产品说明书 V1.1](docs/物品智能服务_完整产品说明书_V1.1_交付版.md)
- [本轮验证](docs/engineering/ambient-validation-2026-10-18.json)、[上一轮真实百炼验证](docs/engineering/live-validation-2026-10-18.json)
- [原始迁移与来源](docs/engineering/repository-migration-2026-10-17.md)、[Git 协作](CONTRIBUTING.md)

后续仍通过 Git 功能分支迭代；审查 ZIP 是源码附件，排除 Key、数据库、个人资料、依赖、运行时和构建缓存。
