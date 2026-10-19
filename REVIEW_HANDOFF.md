# ProductAgent统一仓库交接

## 2026-10-20 · 自主深化 / 上传与启动

故事照片区域改为可访问的添加/更换按钮、缩略图、文件名与移除，保留原存储及格式/大小校验。新增 START_LIFE_CLOUD.cmd：只加载本项目配置、显示不含密钥的状态、逐次 CLOUD 确认、检测端口但不终止进程，退出撤销授权。2项启动器离线测试和类型检查通过；照片浏览器回归随最终构建执行。真实模型调用0。

## 产品体验深化 / 最终验证

完整回归115/115通过；收尾来源标签/规划摘要/布局改动再以27项针对性测试及新版两组API/Edge复核通过。类型检查、生产构建、离线基准与/legacy四组回归通过；新增桌面/390px家庭、社交、发现与故事检查。真实模型0次，云端开放规划用协议替身验证，不宣称Qwen实际质量或实物效果。原3200为已有手动--cloud服务，未终止；本轮3201费用关闭预览复用当前开发数据，库完整性ok，无新迁移。实测摘要见docs/engineering/life-experience-validation.json。已知限制：有限路由/离线能力、公开资料需主动读取、视觉/OCR/真实账户同步未实现。

## 产品体验深化 / 第三批

录入收起非必要能力/维护字段；绑定型号提供主动读取公开来源正文入口，仍需本人核对保存，资料不自动升级为官方事实。来源列表使用真实回执ID，保留链接与资料类型。新版聊天叙述默认不自动写生活故事，普通交流不加载无关私人经历；明确保存、候选确认、图文编辑/删除与跨物品关联保留。社交赠礼从本人展柜进入原预览与授权流程。7项针对性产品路径测试与类型检查通过；下面进入唯一一轮最终完整回归与构建，真实模型0次。

## 2026-10-19 · 产品体验深化 / 第二批

新增页面上下文与产品意图路由，App指南不走型号澄清，物品话题和普通交流可切换；正文与结构化问题去重。发现和现有LangGraph共享目标规划服务：按服务端所属候选读取上一轮、排除/选择、时间/预算、材质能力、反馈与来源，云端允许开放方案，离线保留配方并增加通用能力组合。资源/事实ID/授权变化验证保留，安全否定句不再误判为危险动作。36项针对性新旧测试通过，真实模型0次；尚不宣称实际千问输出质量。

## 2026-10-19 · 产品体验深化 / 第一批

发现页改为目标对话、可选条件及方案迭代入口；家庭独立，礼物归入社交，复用原事项/赠礼领域动作。首页增加即时提问，统一紧凑的卡片、输入和移动布局。类型检查通过；目标规划后端与最终浏览器验证继续在后续批次完成，不将UI入口当成智能能力验收。

## 2026-10-19 · 本轮最终验证

108/108单元与领域测试（新增7项）、独立类型检查、生产构建、离线基准、新版两组API/Edge旅程及/legacy四组回归全部通过。包含实际资料失败→仅重试→只建一件、浏览器后退、图文关联/编辑/删除/越权、创意去重/收藏与合成隔离。用户明确暂不授权付费，本轮真实调用0；真实千问仍待本机Key配置和另行费用授权，不宣称在线质量。代码分批4143f70、d9d00aa及最终验证提交保留。最终机器记录见 docs/engineering/life-core-fixes-validation-2026-10-19.json。剩余边界：资料与本地配方为有限规则，旧重复候选保留反馈而不破坏性合并；未扩展视觉/OCR/账户或新架构。

## 2026-10-19 · 核心体验优化（第二批）

资料摘录仅在问题维度有直接答案时采用，否则明确待补充；属性局部更新保留材质/能力等，校验数量和真实日期。创意遵守自然语言时间、室内/静音要求、数量与已知室内限制；模型路径传入当前目标/时间/选择物品及获准偏好，校验返回资源/格式/时长，不套本地模板。新版Context/计划排除合成持有，普通商品指导排除私人经历，回忆无关线索不挪用其他经历。首页改为具体物品照片，详情联动故事，卡片展示余量/有效期/片段数，支持来源页返回与浏览器后退。20项life测试通过；真实模型0次，用户明确暂不授权。最终浏览器与回归另记录。

## 2026-10-19 · 云端通路与核心可靠性修复（第一批）

启动默认费用关闭；仅本机 --cloud 单进程手动启用，退出即撤销。状态按密钥/配置/授权检查，未实际联网不宣称账户可用。Provider区分认证、网络、限流与无效JSON。录入请求回执随物品同事务保存（life schema v2/升级备份），资料失败可独立重试，不重复建档。候选按内容与实例去重并保留收藏，旧种子同样按合成数据隔离，发现默认不含演示。16项life测试及类型检查通过；真实模型调用0，等待另行授权。后续体验与最终回归另记录。

## 2026-10-19 · 新版交付入口

当前 feat/life-context-v1-d，从 4451ca2 统一工程增量开发；用户允许修改现有工程，先前 prototypes 限制已被正式授权替代。未修改 D:\ProductAgent-Dev 工作区或原数据。使用 START_LIFE.cmd 或 npm run start:life（3200，费用硬关闭），独立 data-life-v1；开发 dev:life；测试 npm run test:life 自动隔离库/端口，原四组旅程通过 test:acceptance 回归 /legacy。

完整数据/模块/权限/来源/操作及边界见 [本轮交接](docs/engineering/life-context-handoff-2026-10-19.md)。已通过生产构建、类型、离线基准、新版两组 API/浏览器及四组旧回归。照片/条码/二维码/PDF 是真实处理；无 VLM/扫描PDF OCR/通用商品编码查询，云端模型未付费调用。25 合成实例、10绑定型号、11包33事实2过程、12类创意、3片段2图文，统计详见验收。原型与测试数据、依赖和Key均不提交。Git只保留本地分批提交，未推送或合并。

## 架构图与对外介绍资料

2026-10-18 新增 [功能、技术与闭环架构](docs/PROJECT_ARCHITECTURE.md)，以及 docs/architecture 下的高清 PNG、SVG 和生成清单，可直接用于群内分享。图以功能提交 a6aa51b 为基线，覆盖现有功能、LangGraph/Skill/Context/百炼/SQLite 分层、记忆与行动闭环，待接入项单列。离线生成脚本为 scripts/render-architecture.mjs；本次仅改文档和绘图工具，核对 36 个应用指纹及图文排版，不重跑业务测试或模型。下方功能验收保留为对应轮次证据。

## 最新：记忆表达与物品故事 Skill

2026-10-18，继续 `feat/home-scene-item-companions`，基线 `4aaeb28`。详情见 [技术说明与体验](docs/engineering/memory-storytelling-2026-10-18.md)，结果见 [本轮验收](docs/engineering/memory-storytelling-validation-2026-10-18.json)。下方 75/75 与纯文档整理均为前轮历史。

最终验证：88/88（新增 13 项）、生产构建、独立 typecheck、离线 benchmark 与四组隔离 API/Edge 旅程通过；36 个源码指纹已记录。桌面/390px 截图已核对，本机 3100 的首页、指南与空间 API 均 200。本轮真实模型调用 0；云端表达使用协议替身验证，未冒充千问实测。

- 新增正式注册并接入图的 memory-storytelling：检索→相关选择/去重→本地组织或获准千问表达→检查→回退→继续回忆。替换 story 和可选 companion 的原文逐条拼接；物品语气来自类别，不能补事实。
- Runtime：src/lib/skills/memory-storytelling.ts；item-story 1.1.0、human-item-agent-v1.4。generate 兼容路径传实际 Skill Prompt；complete 路径不开放工具。云端至多一次，坏引用/清单/虚假行动/异常工具调用回退到本地。
- 私人片段默认本地；所选片段全部获准且非 demo 才进云端。原费用开关不变，没有读取 Key 内容。回忆/继续/展开不新增真实故事，助手改写不作记忆事实；遗忘与并发撤权守卫保留。历史提醒请求不执行。
- 没有增加数据库迁移、依赖、界面按钮或权限开关。测试使用隔离库与模型替身；本地组织和云端协议分别验证，不能将来源检查当语义忠实证明。有限检索/本地表达仍有边界，原业务和动画交互保留。

## 当前交接速读：运行与两个分支

更新：2026-10-18。本节为当前接手入口，下方按轮次保留历史实现事实。**先读 [运行与分支交接说明](docs/RUN_AND_BRANCH_HANDOFF.md)**，其中含本机启动、新电脑/ZIP 安装、更新重建、验收、分支差异及可直接转发的话。

- 唯一工程：`D:\Project\Tianmao\ProductAgent`；仓库 `Starry-Curry/ProductAgent`。当前推荐分支 `feat/home-scene-item-companions`，家庭空间基线提交 `8a5c13e1de321a4ade356fb3655000328b339b8f`；后续运行说明与记忆表达迭代沿用该分支，实际 HEAD 以 Git/导出清单为准。
- 前一分支 `feat/household-demo-conversations` 的功能提交为 `4394b067ff3bf35d118eb3e276315db62ab774a4`。已复核它是当前分支的祖先；当前分支包含两个迭代，无需重复合并。`main` 仍为 `53a43437e94a51017bb4415cac4ad68d9245cf5a`，未包含这些迭代。
- 本机可先访问 http://127.0.0.1:3100 ，未运行时使用 START.cmd；新电脑 Node24 + npm ci/build/start:local。**已有构建时 START.cmd 不自动判断代码新旧，更新/切换后先停旧服务并重建。** local 启动器负责启用本机演示角色；开发用 dev:local。
- 当前 SQLite v6，升级前备份保留。第一分支为 v5；比较旧版需独立目录/数据库，不用旧代码直接打开日常 v6 库。凭证、日常库和构建缓存继续忽略，案例初始化代码已上传。
- 家庭空间基线证据：75/75、build、独立 typecheck、benchmark、四组隔离浏览器；上一分支 63/63、三组浏览器。均为相应功能轮次的历史证据。上一轮只整理说明、核对分支与链接/启动健康；本轮表达迭代以顶部新验收摘要为准。
- 审查 ZIP 从当前已提交 HEAD 重新导出，附件排除未跟踪的 docs/1018.md、Key、日常数据、依赖与构建缓存。历史 home-companions-validation 的指纹仅对应当时源码；当前源码以顶部记忆表达验收的指纹为准。

## 2026-10-18 · 家庭空间、动画角色与全屋 Agent

最终验证：75/75、build、独立 typecheck、离线 benchmark 与四组隔离 API/Edge 旅程通过，真实模型调用 0。已核对桌面/390px 截图及本机 3100 的 root/guide/home API 200、v6 备份。新操作回执为 action 消息，重复确认不重复追加；统一对话定位到最新回复。

当前分支 feat/home-scene-item-companions，基线 4394b06；未合并 main。本轮设计见 [迭代文档](docs/engineering/home-companions-iteration-2026-10-18.md)，具体架构/API/回退见 [实现交接](docs/engineering/home-companions-implementation-2026-10-18.md)，最终结果见 [验收摘要](docs/engineering/home-companions-validation-2026-10-18.json)。最终提交与 ZIP SHA256 见导出清单。

- UI：HomeExperience、ItemCharacter、home.css；固定房间、角色/状态动画、owner 摆放与键盘控件；首页已有 MemoryCenter 单独可见，旧帮助折叠，原业务导航保留。没有修改原 globals.css，也未添加运行依赖。
- Harness：mode=auto、LangGraph route→prepare→model/tools→validate→wait；每轮有效目标/Skill，未知/同名澄清。Prompt human-item-agent-v1.3；物品名称作为任务数据。模型/工具预算不变。
- 领域：home/contracts.ts、router.ts、decisions.ts、store.ts 与 /api/home。行动建议 15 分钟，服务端保管参数；仅已提交的本人会话卡可确认。事务复查目标/资源/身份/lease/位置版本，回读结果与最新 session revision；重复操作不重复创建。
- v6：home-schema.ts；home_placements/home_place_requests/home_proposals；保留 .before-v5-to-v6.sqlite。房间是固定常量；原 workspace 仍 JSON。摆放同步 location，保留同房间的细位；档案位置外部更新使旧请求冲突。
- 隐私：session.itemScopes 覆盖全屋引用物品及计划资源；切换目标清除旧设备条件/尝试，反馈按物品过滤。用户消息有 itemId/capture；回填遵守来源与跳过标记。默认云端历史授权、遗忘屏障和案例范围不变；案例故事经全屋入口先选物，不注入全局记忆。
- 验证：新增 home-companions.test.ts 与 home-integration.mjs；verify-local.mjs 默认四组浏览器，参数 home 可单独调试。费用关闭、独立 PRODUCT_AGENT_DATA_DIR；协议替身不算真实模型调用。报告与截图以本轮证据为准，不复用历史在线次数。
- 凭证与用户文件：Key/.env.local/api.txt 内容未读取；用户 untracked docs/1018.md 未改动、未纳入提交或导出。日常库不用于自动测试，原 data/.runtime/.next 忽略规则不变。

限制：有限规则路由/记忆提取；通用场景模型建议没有任意写动作。已实现可保存的野餐、旅行、阅读角及位置/家庭卡。没有 OCR/VLM/语音/真实登录/IoT/后台通知，也没有把旧信号模拟升级为健康判断。备份回退需先隔离核验版本，不覆盖现有 v6 日常库。

## 2026-10-18 · 家居案例与对话式记忆入口

最终验证：63/63 测试、生产构建/类型检查、离线基准、隔离旧旅程/静默记忆/家居案例三组浏览器验收通过。首次介绍保存/跳过后不再出现，演示操作不清空真实会话；本轮付费模型调用 0。合成截图在 review-evidence/household-20261018，详情见本轮验证摘要。

新增八组家电/家具案例：7 个新官方资料包，知识目录达到 11 包/33 条事实，配套 16 段合成故事、24 条演示记忆、4 个家庭事项、2 个示例计划。案例与真实画像/活动资源隔离，按版本追加，不重置已有数据。

记忆入口改为一次可选介绍，保存或跳过后持久关闭；日常新增通过物品对话。移除手动补充/直接写记忆及重复私人记录表，保留既有记忆纠正/忘记、原时间线、陪伴与家庭/礼物流程。v5 增量迁移有备份，新增介绍状态与案例安装回执。

分支 feat/household-demo-conversations，起点 60b0ad9。主要文件：catalog/household-products.ts、demo/、memory/introduction.ts、experience-schema.ts、MemoryCenter、HouseholdCases。来源、运行、边界与核实步骤见 [本轮说明](docs/engineering/household-cases-and-onboarding-2026-10-18.md)；最终测试记录见 [验收摘要](docs/engineering/household-validation-2026-10-18.json)。本轮真实模型调用 0；用户 docs/1018.md 与 Key 内容未读取或纳入交付。


## 2026-10-18 · 静默记忆与物品故事体验

验证完成：55/55 单元与领域测试、生产构建/类型检查、离线基准、隔离 API 与 Edge 故事/手机/长辈版旅程通过。新指南与暂停/恢复也已验收；本轮真实模型调用 0。最终复核还补上旧来源不能覆盖新陈述的时序约束，并重新通过全量测试/构建/浏览器验收。详细结果见 [验收摘要](docs/engineering/ambient-validation-2026-10-18.json)，合成截图见 review-evidence/ambient-20261018。

开发分支：feat/ambient-memory-experience；起点 9c14eb1（已运行的 LangGraph + 真实百炼兼容修复）。唯一工程未变。用户 untracked docs/1018.md 保持不动，不进入导出。

- 核心实现：src/lib/memory/ambient.ts，有限规则抽取、来源 hash 回执、去重/否定更新、按人暂停和有限历史核对；原记录仍在 workspace，派生记忆在 personal_memories。
- v4：src/lib/repositories/ambient-schema.ts、migrations.ts；新增 capture settings/source receipts/slots，升级前 .before-v3-to-v4.sqlite，未来版本拒绝写。保留 v2/v3 及旧备份。
- 写路径：db.write 事务内 captureWorkspace；commitTurn 事务内 story 原文与派生整理；recordSessionFeedback 自动方法与撤回。不调用模型写画像；显式纠正/忘记锁住自动主题并沿用上下文失效。忘记对话清除同源派生记忆，原始故事作品另留。
- UI：故事模式 AssistantConversation + 原时间线、MemoryCenter 默认管理而非收集、HelpEntry 示例、/guide。story 模式的确认与回忆是本地能力；一般帮助和可选交流仍可用真实 provider。
- 隐私：不要读取或打印 .env.local/api.txt；应用可用 Key 认证。默认私人记忆不上云，普通当前问题仍可能送云端。暂停整理不停止原始会话/主动故事保存。行为观察不升级喜好，采购不升级订单或所有权，礼物转入故事不升级亲历。
- 验证：tests/ambient.test.ts 新增静默闭环回归，tests/foundation-integration.mjs 从手工填兴趣改为物品故事录入；原测试保留。使用 Node24、独立 PRODUCT_AGENT_DATA_DIR，费用关闭。命令见 README。
- 发布附件：npm run export:review 从已提交 HEAD 用 git archive 输出 .runtime/exports 源码 ZIP 及 commit/SHA256，不带凭证、库、依赖、运行时、构建缓存和未跟踪文件。主线继续 Git 分支协作。

完整设计、边界、后续顺序与回滚见 [技术说明](docs/engineering/ambient-memory-architecture-2026-10-18.md)，功能使用见 [操作指南](docs/engineering/current-product-guide-2026-10-18.md)。新测试摘要见 [验收记录](docs/engineering/ambient-validation-2026-10-18.json)。


## 2026-10-18 · 用户授权的真实百炼验收

北京百炼 qwen-plus 已真实接通。公开商品三例成功；新版普通建议、来源事实选择、真实工具往返和浏览器显示的最终一轮验收全部成功（4 场景、5 次调用）。模型与页面问题已修正，44/44 单元与领域测试、类型、构建与离线门禁通过；没有实物验证。此前“未在线验收/调用 0”仅是上一阶段的历史结论，不表示 Key 无效。

本机非 Key 配置已按用户本次授权完善；Key 只由应用用于认证，不进入模型上下文、日志或报告。体验入口 http://127.0.0.1:3100 ，步骤见 [系统体验指南](docs/engineering/system-experience-2026-10-18.md)，证据见 [在线验证摘要](docs/engineering/live-validation-2026-10-18.json)。


## 2026-10-18 · 已批准并实现第一轮技术基座

用户已批准设计 v2，当前功能分支为 `feat/agent-memory-foundation`。已实际接入 LangGraph.js 与 SQLite checkpoint，新增连续会话、未建档提问后关联物品、有限来源过程、尝试与结果反馈、预览摘要的家庭交接、记忆管理/授权/纠正/忘记、兴趣与可选文字陪伴。原产品导航、业务模块、型号核对、售后与旧记录保持。

完整修改、Prompt、Loop、存储和个性化的实际设计见 [实现说明](docs/engineering/foundation-implementation-2026-10-18.md)，验收入口见 [晨间验收](docs/engineering/morning-acceptance-2026-10-18.md)。新交付以这两份文档及 [脱敏验证摘要](docs/engineering/foundation-validation-2026-10-18.json) 为准；下方确认前的文字保留为历史。

模型与实物结论仍有边界：自动验证不调用真实百炼；知识目录仍是三类商品四包十二条事实，新增两个有限过程；通用表达的风险检查不是语义安全证明。没有新增真实认证、IoT、视觉、全品类说明书解析或无人审核的自我进化。


最新验证：42/42 单元与领域测试、typecheck、生产构建、离线能力门禁，以及隔离数据库的旧 API/Edge 交互与三条新用户旅程通过。真实模型调用 0；日常业务库未用于测试。完整脱敏结果见 docs/engineering/foundation-validation-2026-10-18.json。

## 历史记录：导入、审查与确认前设计

更新：2026-10-17。先读README.md、IMPLEMENTATION_STATUS.md、docs/README.md。

## 唯一主线与来源

- 本机D:\Project\Tianmao\ProductAgent；远程Starry-Curry/ProductAgent，main。
- 源码来自Wukaifeng导出包内Product-Agent-Review-20261017.zip，SHA256：cb610240630dcd218f81358a5459bb73bb33514618d46bb40518fa646f7d1726。
- 原报告记录f0584882769bd85a143b3756ff8e1db2845591c6、基线118e295d6f513fc439daaa67870c4f186ac1df69。没有原.git，仅记录来源，不伪造历史。
- 旧LocalFlow/Python/Windows包留作历史，勿覆盖当前源码或合并业务库。

## Git 已连接并核对

2026-10-17 续接时 origin 已改为 `git@github.com:Starry-Curry/ProductAgent.git`。SSH 连接成功，执行 `git push -u origin main` 返回 `Everything up-to-date`；随后通过 `git ls-remote` 核对远程 main 与本地均为 `53a43437e94a51017bb4415cac4ad68d9245cf5a`，领先/落后均为 0。历史上传限制见迁移记录，不再作为当前阻塞。

本轮审查位于 `chore/architecture-review-20261017` 分支，尚未提交或推送。

## 当前架构与运行

根目录为Next.js应用；page/components→API→domain/db/service-store，harness/provider组织受控模型调用，Product Pack/Context/discovery提供资料、偏好和有限组合。SQLite业务仍以workspace JSON为主，另有服务记录和反馈表。

Node24；npm ci/build/start:local，默认127.0.0.1:3100；开发dev:local。Windows可用scripts/windows.ps1和本机忽略目录.runtime/node24。真实身份未接入，模型付费默认关闭。数据data/demo.sqlite，测试用独立PRODUCT_AGENT_DATA_DIR，保留迁移备份。

## 文档与验证

完整产品说明、总任务书和主提示已补齐，旧交接所说“任务书缺失/上游未知”是历史状态。旧报告原文保存在docs/archive/import-2026-10-17。

默认测试、类型、基准和构建不产生真实模型费用。集成需独立服务/数据库及现有Edge路径。真实模型还需费用授权和脚本开关；不能把历史截图/离线替身算作本次在线验收。新复验见迁移记录。

遵守对象授权、只读模型工具、故事作者/持有人区分；用户报告不等于客观完成。凭证不入库，不工具读取或展示用户api.txt及秘密副本。

## 后续

按CONTRIBUTING.md从main建分支并PR，更新报告、交接、状态、CHANGELOG。任务书中的视觉、本地9B、Skill循环和多人功能仍是后续工作；用户当前任务优先，不因整理仓库擅自实施整个Backlog。

## 本轮审查与百炼接入

详细建议见 [架构审查](docs/engineering/architecture-review-2026-10-17.md)，验证摘要见 [review-validation](docs/engineering/review-validation-2026-10-17.json)。主要缺口是回答相关性、操作资料、应用 Skill 执行契约、服务会话与反馈闭环、可观察的个性化和评测门禁；文档建议尚未实现。

用户确认使用北京百炼；本机忽略文件 `.env.local` 已准备，创建时仅 API Key 留空，手动调用费用开关开启。本轮没有读取或展示用户凭证，没有真实模型调用。公共模板保持付费默认关闭。

本轮复验 26/26、离线 benchmark、build、typecheck，以及隔离数据库的现有 API/Edge 桌面手机集成均通过。七例基准仍误拒一个正确改写，且现有脚本没有质量门禁；离线探针复现相关事实答非所问仍被标为 succeeded。业务代码未修改。

## 2026-10-18 · Agent、Memory 与个性化设计修订

用户要求自然可靠、完整 Agent 闭环，以及覆盖记忆、兴趣、关系和可选陪伴的个性化。待确认设计见 [设计 v2](docs/engineering/agent-memory-personalization-design-2026-10-18.md)，其中调整后的首轮建议优先于上一版实施范围。

建议以 LangGraph.js 为首选薄编排层，先验证当前 Node/Windows/Next/SQLite 与百炼工具协议，再实施会话、Memory 生命周期与召回、个性化及文字陪伴最小体验。用户确认前不得据此开始安装依赖或修改应用。

本轮仅写设计和同步文档；没有改业务代码、数据库、环境配置或用户文件 docs/1018.md，没有调用真实模型。当前仍是原自建单次 Harness。

## 2026-10-18 · 本轮代码与远程交接

实现与验证提交 `f394556db306c32b905fc935a040328f2e94d26a` 已推送到 `origin/feat/agent-memory-foundation`，并以 ls-remote 核对一致。远程 main 仍为 `53a43437e94a51017bb4415cac4ad68d9245cf5a`，未合并本轮实现。工作区仅保留用户原有未跟踪文件 `docs/1018.md`；未覆盖或纳入提交。

本轮没有检查或改写私人 `.env.local`。一次拟补写默认项的命令因包含可能存放凭证的文件读写被自动审批拒绝，整条命令未执行；随后取消这项附带操作，只修改公开模板，功能与验收继续完成。
