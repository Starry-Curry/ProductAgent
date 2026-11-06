# 物间 Wujian｜初赛项目交接手册

交接日期：2026-10-21。**这是可接手的开发候选，智能任务质量尚未全部验收通过。** 本轮已按产品负责人要求停止全面冲刺，不再追加模型测试、功能或部署。

## 1. 先从这里开始

- 仓库：[Starry-Curry/ProductAgent](https://github.com/Starry-Curry/ProductAgent)。已核对 origin 为该 HTTPS 地址；公开仓库。
- 交接分支：[handoff/wujian-prelim-20261021](https://github.com/Starry-Curry/ProductAgent/tree/handoff/wujian-prelim-20261021)。原开发分支 `feat/life-context-v1-d` 保留，不合并 main，不重写历史。
- 本机工作区 `D:\ProductAgent-LifeContext`。不要修改 `D:\ProductAgent-Dev`，不要合并其数据库。
- 最后功能修复提交：`6d385df87e664ed4fb5493b23e53934f2d375b3f`。包含本手册的文档提交在其之后；最新准确 SHA 用 `git rev-parse HEAD` 或上述分支的提交页查看，避免在文档内自引用不存在的提交。
- 原产品基线 `4451ca2`；本轮智能攻坚从 `d9a343f` 开始。交接前相对远端 main 的功能历史尚有 52 个本地提交，交接分支将一并保留。

新开发者先执行：

```powershell
git clone --branch handoff/wujian-prelim-20261021 https://github.com/Starry-Curry/ProductAgent.git
Set-Location ProductAgent
node --version
npm.cmd ci --cache .npm
npm.cmd run typecheck
```

要求 Node.js **24**，使用 `package-lock.json`，不要另换 Python/LocalFlow 发行版。先读本手册、根目录 `AGENTS.md`、`IMPLEMENTATION_STATUS.md`、`REVIEW_HANDOFF.md`。历史任务书是目标，不是已实现事实。

## 2. 产品定位及必须保留的原则

物间面向希望更好使用已有物品、组织日常生活和保留经历的个人及家庭，是天猫 AI 黑客松初赛候选。核心不是商品客服，也不是虚拟房间或强制日记。

| 四种价值 | 用户实际想得到什么 | 当前兑现及边界 |
|---|---|---|
| A 兑现原有价值 | 认识、使用、维护商品，解决实际问题 | 物品录入、Product Pack、按需官方资料和商品 Agent 已运行；完整首用及来源语义校验不稳定 |
| B 发现潜在价值 | 单件新用途、多物品组合，从目标得到可执行方案 | 规则兜底与真实 Qwen 开放生成均已接通；趣味、隐含资源及物理可靠性仍有失败 |
| C 延续与保护价值 | 生命周期、使用经历、生活故事与长期联系 | 图文事件、章节、跨物品关联及可纠正记忆已运行；长期理解与个性化实质收益仍须验证 |
| D 传递与共享价值 | 家庭协作、礼物、经验与授权共享 | 本机模拟成员、确认动作、故事快照及权限可操作；不是跨设备家庭账户系统 |

从物品出发、从用户目标出发是两条平等入口。真实物品、照片、生活经历及获准 Context 应长期关联；只在任务需要时取少量记忆，允许查看、确认、纠正、撤销与遗忘。普通聊天不必绑定物品，不把每次聊天自动变成长久画像。不能凭一次故事推断固定人格或敏感属性。不要强迫高频库存维护、长日记或照片上传。

视觉已确定为 **B＋C：真实物品展柜＋生活故事**。故事是生活材料，关联物品只作线索，不从商品照片拼造生活画面。家庭独立，礼物归社交；Persona 默认自然，可选开启单件伙伴。不恢复二维虚拟空间为主界面。

开放创意很重要，但不能以虚构商品能力、食品安全、物理机制或已执行动作换取惊喜。用户获得的任务结果与总成本优先于测试数量。沿用 FancyTech 的步骤评估与 Reference、Cherry Studio 的低摩擦入口、MuseGate 的少量可修改条件、Instinct 的按需授权 Context、a16z 的任务价值/总成本视角；这些是工程取舍原则，不代表已复刻其产品或引入其服务。

## 3. 当前完成程度

**可运行的领域闭环**：多入口录入及人工确认、照片存储、二维码/条码解码、有限开放食品资料、官方 HTML/PDF 获取与缓存、本机 OCR、统一聊天及历史、故事多图/编辑/删除/章节、个人理解确认/纠正/撤销、家庭事项与确认、礼物快照和分享、维护、默认离线及手动云端启动、公开演示访客隔离的生产模拟、`/legacy`。

**受控或有限能力**：11 个 Product Pack、有限品牌官方适配、12 类本地配方和能力组合、原型级视觉候选匹配、规则与可选模型辅助的章节建议/个人理解。真实 Qwen 可以生成固定配方之外的内容，但可执行性没有通用保证。接口可调用、引用 ID 有效、模型自评通过都不等于产品任务成功。

**没有完成**：通用全品牌商品资料定位、通用条码数据库、购物订单同步、受限社区全站搜索、通用物理验证、实机任务自动完成、真实跨设备家庭账户、成熟的多步骤任务驱动物品组织、证明稳定收益的个人画像、Neo4j/向量数据库、公开 HTTPS 部署及外网验收。

## 4. 实际技术结构与数据流

以下路径均相对仓库根目录。没有第二套 Agent，也没有独立故事数据库服务。

### 4.1 Next.js / React 与入口

`src/app/page.tsx`、`src/components/life/WujianApp.tsx` 组织首页、展柜、发现、故事、家庭、社交和问物间；`src/components/AssistantConversation.tsx` 是统一聊天 UI。`src/components/life/Intake.tsx`、`ItemInformation.tsx`、`OfficialSources.tsx` 承接录入与资料；`Stories.tsx` / `StoryOrganization.tsx` 承接阅读与章节/理解管理。历史入口仍在 `src/app/legacy/`。

浏览器只请求本服务 API，Qwen Key 不送到浏览器。`/api/life` 是新版领域操作入口，`/api/assistant` 是 Agent 会话，`/api/memories` 是个人记忆，`/api/workspace` 处理既有领域状态；媒体走 `/api/life/media/[id]`，礼物走 `/api/gift/[token]`，健康检查 `/api/health`。请求结构以对应 `route.ts` 和 Zod schema 为准，不能凭旧交接文档拼任意写命令。

### 4.2 SQLite、表结构与事务

`src/lib/db.ts` 取得 `demo.sqlite`，启用 WAL、foreign_keys、busy_timeout；`src/lib/life/data-directory.ts` 防误连旧目录/其他工作区。`src/lib/domain.ts` 是 Item、Task、Gift、Plan、State 及授权/变更规则。**物品、家庭任务、礼物和早期 Plan 位于 `workspace(id,body)` 的 JSON，而非独立 items/tasks SQL 表。** `db.write` 在事务内执行 mutate 和记忆采集。

| 表组 | 主要表及关键关系 | 维护位置与用途 |
|---|---|---|
| 基座/旧服务 | `workspace`；`schema_migrations`、`migration_audit`；`service_runs(actor,item_id,body)`、`service_feedback(run_id)` | `db.ts`、`migrations.ts`；保留早期可回放服务及迁移审计 |
| Agent | `agent_sessions(owner,item_id,revision,body,lease_until,expires_at)`；`agent_requests(owner,request_id,request_hash,session_id,result)`；`agent_feedback` | `repositories/foundation-schema.ts`、`sessions.ts`；会话租约、乐观并发、幂等重放 |
| 长期记忆/Persona | `personal_memories(owner,item_id,body,status,version)`；`memory_events`；`memory_epochs(owner,version)`；`persona_profiles(owner,scope,body)`；`action_receipts` | `memory/store.ts`；纠正/忘记、作用域和权限变化使旧模型上下文失效 |
| 静默采集 | `memory_capture_settings`、`memory_source_receipts`、`memory_capture_slots`、`memory_introductions`、`demo_content_installations` | `memory/ambient.ts`、`repositories/ambient-schema.ts` / `experience-schema.ts`；设置、去重与拒绝后不复活 |
| LangGraph | `graph_checkpoints`、`graph_writes` | `agent/checkpointer.ts`；在现有会话/权限保护下保存图状态 |
| 图文事件 | `life_media(id,owner,mime,body BLOB)`；`life_fragments(id,owner,text,media_id,revision,created_at,updated_at,demo)`；`life_fragment_items(fragment_id,item_id)`；`life_fragment_details(fragment_id,captured_on,media_ids,allow_recall,allow_cloud,origin)` | `life/schema.ts`、`stories.ts`、`media.ts`；一份正文关联多物品，不重复复制事件 |
| 章节与理解 | `life_chapters(id,owner,body)`；`life_understanding(id,owner,signature,body)`，理解签名按 owner 唯一 | `life/organization.ts`；章节正文保存 fragmentIds，个人候选保存 evidence 指纹、状态、scope、memoryId |
| 商品与创意 | `life_sources`；`life_knowledge_documents(owner,item_id,identity,url,hash,body,status,created_at)`；`life_knowledge_fetches`；`life_creative_evidence`；`life_ideas`；`life_idea_feedback(owner,idea_id,saved,outcome,note)`；`life_requests`、`life_installations` | `life/acquisition.ts`、`sources.ts`、`creative-evidence.ts`、`ideas.ts`；资料版本、短暂失败缓存、候选/收藏/反馈和录入幂等 |
| 旧空间/动作 | `home_placements`、`home_place_requests`、`home_proposals` | `repositories/home-schema.ts`、`home/`；供 legacy/受控动作回退，不作为新版主界面 |
| 公开演示注册库 | Volume 根的 `visitors.sqlite`：`visitors(id,token_hash,expires)`、`counters`、`model_requests`；每访客子目录独立 `demo.sqlite` | `cloud/runtime.ts`；这是访客隔离，不是正式账户系统 |

生活 schema 当前为 **v6**。迁移通过 `VACUUM INTO` 保留升级前备份，拒绝更高版本写入；具体 SQL 是 `src/lib/life/schema.ts` 和 `src/lib/repositories/*-schema.ts` 的事实来源。不要删除旧表、迁移备份或用初始化重置解决问题。

当前 SQLite 单实例、本机 Node 24 方案便于低成本可靠事务及交接。未引入 Neo4j 或向量库：关系规模尚小，章节/多物品关系已能表达；引入新服务会增加部署、迁移和权限成本，不能解决当前答案质量。并发增长后，先量测锁争用和查询，再将 JSON 中需索引的实体逐步规范化，保留稳定 ID、版本、授权及事件来源，必要时迁 PostgreSQL；不是直接更换存储。

### 4.3 Agent、Qwen 与知识闭环

`agent/service.ts` 处理请求/会话与完成报告 → `home/router.ts` 识别意图/当前物品 → `agent/graph.ts` 的现有 LangGraph 路由、prepare、模型/工具、验证及提交 → `skills/registry.ts` 动态任务说明 → `context/builder.ts` 最小 Context → `ai/provider.ts` 百炼 OpenAI 兼容传输 → `skills/document-help.ts` / `ai/harness.ts` 验证最终回答。

`life/provider.ts` 区分未配置/未授权/就绪；传输区分 API400/401/403/429、超时、网络及无效响应。`AI_REQUEST_TIMEOUT_MS` 与单请求选项、Agent 总预算共同约束。默认无付费调用；没有无穷网络重试。前端新增真实等待时长提示，不是实际 SSE 阶段进度或完成百分比。

`products.ts` / `catalog/household-products.ts` 提供 Product Pack 与可核对事实/有限过程。`life/knowledge.ts` 定位有限官方目录；`acquisition.ts` 检查品牌、型号、地区、实际读取正文、分块、缓存 hash/版本及冲突。`life/knowledge-task.ts` 按任务和清单平衡取证；`document-help.ts` 区分任务阶段、引文位置、参数、禁止操作和部分结果。搜索工具成功、得到 URL、读到正文、型号适配和回答成功是不同状态。不能把模型生成链接或摘要当已读官方来源。

新修改包括：首次充电不再因“第一次”误路由过去经历；装料检查判断动作目标；逐条保留有效步骤；同文档相邻块、PDF 连字/转义、短中文原句、明确省略摘录可定位，改数字或不存在的引文仍拒绝；烹饪缺食材/份量合并追问；有据缺失动作最多一次局部补齐。`guidance-continuation.ts` 仅在纯进度报告、当前物品授权及资料块仍有效、无私人记忆依赖时复用已核验剩余步骤，条件变化仍走 Agent。请求幂等与实际步骤完成不能混同；只记录用户报告，绝不宣称设备实机完成。

### 4.4 物品实例、录入与能力

`domain.ts` 的 Item 把名称/品牌/型号/地区、本人实例/共享、类别、生命周期、数量/单位/有效期、材质/供电/维护/能力、可用状态分开。`life/availability.ts` 统一合成标记及可用性筛选；普通推荐不把种子当真实持有。`life/intake.ts` 处理建档 requestId；资料保存失败可单独重试，不重复建物品。

`life/sources.ts` / `documents.ts` 负责安全 URL 读取、文字 PDF、扫码实际内容和本机 Tesseract OCR。条码不等于商品型号数据库。`open-catalog.ts` 是有限开放食品来源。视觉用已有 Qwen 协议（`vision.ts`）和逐张授权；生活照片候选由 `story-photo.ts` 将可见名称/OCR/属性与已有实例比较。同类、同型号或相似外观只是候选，用户确认后才关联；没有已部署 CLIP/SigLIP 向量检索或可靠实例身份识别。

### 4.5 Stories、个人理解及 Context

`life/media.ts` 校验 JPEG/PNG/WebP、大小/像素并重编码去 EXIF；照片实际存 **SQLite BLOB**。`life/stories.ts` 保存原文、多个 mediaIds、事件日期 capturedOn 和记录/修改日期；关联表不复制正文。`life/organization.ts` 管章节及明确陈述/多次倾向候选，保存相关事件指纹和拒绝/撤销状态；修改/删除来源会使派生理解失效。确认后关联 `personal_memories`，不是把 AI 推断直接变成事实。

`context/builder.ts`、`life/recall.ts`、`skills/memory-storytelling.ts` 区分普通历史、长期记忆、真实事件及主动回忆。相关性、owner、scope、allowCloud、epoch、Persona memoryUse 共同限制进入新模型请求的内容。确认了“建筑摄影”并不证明规划更可执行，仍要对全部关键动作独立检查。赠出/归档物品不删除原主私人经历，也不把它自动交给收礼人。

### 4.6 创意、家庭、礼物与隔离

`life/planning.ts` 解析目标、历史方案、排除物品、时间及反馈，得到真实可用库存与能力；`ideas.ts` 连接模型、去重及反馈；`capability-plans.ts` 和 12 类配方是有限离线兜底。`creative-evidence.ts` 区分官方事实、第三方短摘录/链接、用户经验及 AI 创意。Wikibooks 有适配但实际读取存在失败；国家档案馆照片保护公开参考曾实际读入并改编；Hackaday 账号/API 未接入，受限社区不绕过登录。

本轮 `idea-audit.ts` 对动作检查数码文件/纸质照片、计时、测量、剪贴、镜子、额外杂物、相机特定功能、结构、杯子矛盾摆位、行走取景及食品无据保证；错误最多一次原草稿局部补丁，不用免责声明掩盖。**这不是通用语义/物理证明器**：未登记小物件、只有笔记本却假定有笔、剥皮水果过夜、物理作用等仍有漏检，详见工作清单。

家庭事项沿用 `domain.ts` / `FamilyPanel.tsx`、会话交接和 `home/decisions.ts` 确认；礼物沿用 `life/gifts.ts`、Gift 快照及认领/撤销。共享物品不自动共享私人故事/记忆。Persona 在 `memory/store.ts` 的 owner/scope 下保存，风格不替代真实记忆。

`auth.ts` 的 `local-demo` 是明确标注的本机角色，不是真实认证。公开模式由 `cloud/request.ts` / `runtime.ts` 的服务端会话及访客库决定身份；不能相信 actor 前端参数。媒体访问再检查归属，URL 抓取限制公网目标，模型预算/并发、上传和总存储有上限。公开模式已做本机生产模拟，但 Docker/Linux/HTTPS 外网仍需新验收。

## 5. 启动、数据与测试操作手册

### 5.1 费用关闭的独立本机预览

新机器首次安装后；已有 node_modules 不必反复安装。为避免覆盖正在运行的旧构建，使用独立构建目录：

```powershell
$env:WUJIAN_BUILD_DIR='.next-handoff'
$env:AI_ALLOW_PAID_CALLS='false'
$env:WUJIAN_ALLOW_PAID_CALLS='false'
npm.cmd run build
$env:PRODUCT_AGENT_DATA_DIR=(Join-Path (Get-Location) '.runtime\handoff-preview')
$env:PORT='3203'
npm.cmd run start:life
```

浏览器打开打印的地址。`npm run start:life` 尊重明确的 WUJIAN_BUILD_DIR；不设置时可能读取 `.runtime/latest-life-build.json`，所以不能把旧构建当最新代码。仓库当前构建未包含最后修复；新开发者须先 build，交接阶段没有重新运行大型构建。

`START_LIFE_RC.cmd` 设置首选 **3201** 并以离线启动器运行；`START_LIFE_CLOUD.cmd` 默认首选 PORT 或 **3200**，检查当前项目配置，输入 **CLOUD** 才授权本次进程。端口占用时在后续 5 个端口选择空闲端口，不杀旧进程。本机原3200、早期候选3201、故事书3202可能仍属于不同构建/数据；3203只是上述建议，不是已验收新服务。

`START_LIFE_RC.cmd` 的启动器要求先有构建；`npm run build:rc` 固定写 `.next-rc`，**不要在使用该目录的服务运行时重建它**。开发可 `npm run dev:life`。默认数据 `data-life-v1/demo.sqlite`；从新库首次启动不会复制本机私人数据。通过 UI 明确载入演示，合成案例默认不会冒充真实库存。

### 5.2 本地模型配置

只在当前项目被忽略的 `.env.local` 配置，空模板为 `.env.example`。禁止读取 api.txt、复制其他工作区密钥、把 Key 发聊天或写入前端。

| 变量 | 用途/边界 |
|---|---|
| `AI_API_KEY` | 当前项目自己的百炼凭证，仅服务端使用 |
| `AI_BASE_URL` | 北京兼容接口 `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `AI_MODEL` | 本机已配置模型；本轮实测 qwen-plus / qwen3.7-plus，不自动改写用户选择 |
| `AI_ENABLE_THINKING=false`、`AI_JSON_MODE=true` | 当前协议配置；JSON 要求由 Provider 添加，工具路径有独立协议 |
| `AI_REQUEST_TIMEOUT_MS` | 请求上限，代码还取调用者上限与90秒上限；网络失败不自动无限重试 |
| `AI_VISION_MODEL` | 可选视觉模型；存在配置不等于照片上云授权 |
| `AI_ALLOW_PAID_CALLS`、`WUJIAN_ALLOW_PAID_CALLS` | 本机启动默认false；`--cloud`仅本进程开启。云端需部署者同时明确启用 |
| `WUJIAN_ALLOW_PUBLIC_FETCH`、`WUJIAN_ALLOW_SEARCH` | 公网原文读取与百炼搜索分开；搜索默认false且需另核费用/权限 |
| `PRODUCT_AGENT_DATA_DIR`、`WUJIAN_BUILD_DIR`、`PORT` | 独立数据、构建、端口；测试不得指向真实库 |
| `AUTH_MODE` | 本机 local-demo；云端 public-demo 配套变量见 deploy/cloud.env.example |

停止自己启动的窗口（Ctrl+C），以不带 `--cloud` 重启可恢复离线。本轮测试授权不继承给下一位开发者；再次真实调用必须获得当前任务授权。不要把 Key 已配置或旧 `--cloud` 服务当无限额度。

### 5.3 可复现测试

```powershell
# 快速针对性回归，无真实模型
node --experimental-strip-types --test tests/intelligence-acceptance.test.ts tests/life-unified-persona.test.ts tests/knowledge-task-search.test.ts
npm.cmd run typecheck
# 按需完整回归，不要并行多构建
npm.cmd test
npm.cmd run test:benchmark
```

生产构建完成后，保持相同 `$env:WUJIAN_BUILD_DIR='.next-handoff'`，顺序运行：

```powershell
node scripts/verify-local.mjs life
node scripts/verify-local.mjs rc
node scripts/verify-local.mjs storybook
npm.cmd run test:acceptance
npm.cmd run test:cloud
```

verify-local 创建 `.runtime/verification-*` 独立库/随机端口，费用关闭；storybook 使用实际安装的 Edge，检查1365px/390px、CRUD、返回/焦点/图片尺寸和滚动，不等于人工美观评价。cloud 测试使用独立 Volume、假 Provider 与两个访客，不能证明公网或真实云端费用链路。完整构建、OCR、浏览器请串行，避免内存争用。

真实重现（**以下会付费，交接不执行**）：先检查 `node --experimental-strip-types scripts/intelligence-live.ts --group=config`，只显示配置状态，再经授权选择一个 group：

```powershell
node --experimental-strip-types scripts/intelligence-live.ts --group=product-maf --run
node --experimental-strip-types scripts/intelligence-live.ts --group=product-textile --run
node --experimental-strip-types scripts/intelligence-live.ts --group=writing --run
```

可选 `--reuse-latest` 复用该组的合成库/资料缓存；`INTELLIGENCE_MODEL` 仅测试进程覆盖模型，不改 `.env.local`。**不要一次执行 creative/personal 等大组来“检查接通”**，一次生成可能触发有界补丁而超过一个 HTTP 请求。`scripts/intelligence-live.ts` 的本地 ledger 会记录每次请求；其 historical authorization 只是账本说明，不能代替新的用户授权。

### 5.4 备份、恢复和清理

本机 local-demo：先停止使用对应数据目录的所有服务，然后备份整个独立目录（含 demo.sqlite、迁移备份以及可能存在的 WAL/SHM），不要只复制活跃数据库主文件。恢复先复制到**新目录**，设置 PRODUCT_AGENT_DATA_DIR，检查 integrity/schema 并启动；不要覆盖原库。媒体 BLOB、资料正文和知识缓存在同一库，无需寻找一个并不存在的“照片上传文件夹”。

公开演示的受控维护脚本仅支持 public-demo。停服并设置正确 Volume 后：

```powershell
node scripts/cloud-ops.mjs backup --server-stopped
node scripts/cloud-ops.mjs cleanup
# restore须新空Volume，显式 --from <快照目录> --apply --server-stopped
```

cleanup 无 apply 是预览；真正清理需再次显式停服/apply，只删除已过期访客，保留备份。不要拿 cloud-ops 清理本机私人库。测试清理也先核对绝对路径是本项目的 `.runtime/<具体测试目录>`，没有自动批量清空命令。

## 6. 验收证据：版本和失败不能混在一起

| 证据/版本 | 实际结果 | 如何使用 |
|---|---|---|
| [原23项矩阵](../engineering/wujian-rc-acceptance.json) | 原编号/等级保留 | 不擅自用本次测试数覆盖原结果 |
| [前轮最终 JSON](../engineering/wujian-final-validation-2026-10-21.json)、[报告](../engineering/wujian-final-2026-10-21.md) | 原93次百炼：91 HTTP200、2失败，含5视觉；168/168当时领域测试、类型/构建和生产回归通过 | 对应 JSON implementationHead，**不是6d385df的全量结果**；原日志不改写 |
| [故事书阅读验收](../engineering/storybook-reading-2026-10-21.json) | d9a343f 阶段真实 Edge，桌面/390px、单/多图/纯文字、章节/返回/CRUD | `artifacts/storybook-reading/` 在原机器；未纳入此次公开推送的新截图。电脑版方向已由用户接受，主观品质仍人工判断 |
| [RC定向与分层故事](../engineering/wujian-rc-targeted-2026-10-20.md) | 候选、章节、撤销、30合成故事等专项记录 | 对照对应测试文件，不能把CRUD通过当整体体验通过 |
| 本轮完整 npm test | **175项中174通过、1失败** | 当时未排除风险错误的补丁请求，导致 Persona 替身协议断言失败；修复后相关测试通过，但**未重跑完整套件** |
| 本轮最新针对性 | 最后 12/12；此前含来源、任务的26/26；类型检查通过 | 覆盖引文、参数/禁令、纯进度续接、动作依赖、Persona/记忆政策；最后短引文修复只有离线验收 |
| [本轮脱敏逐结果快照](INTELLIGENCE_RESULTS_20261021.json) | 新增114请求，113 HTTP200、1网络失败；143个场景/资料/重放记录 | 最终可见步骤/方案、来源、库存、请求数、Token、耗时可查；完整独立质量评分尚未完成 |
| [安全扫描](HANDOFF_SAFETY.json) | 全可达历史文本扫描，初检1071个文本blob、37个二进制blob，凭证模式发现0 | 二进制按公开演示资产/旧验收截图来源另查；扫描不是所有隐私的数学证明 |

本轮请求平均17.105秒、P95 37.160秒；出现约83秒的网络失败/长等待，不能声称已解决尾延迟。按已知用量保守估算 **¥0.7517252**，2次缺用量/无法计价不等于免费，真实账户账单未知；费率与范围在 JSON 中。不同模型/代码阶段、Prompt和并行机器负载不同，不能将这些样本当受控速度优劣实验。[百炼价格来源](https://help.aliyun.com/zh/model-studio/model-pricing)。

原始新账本 `.runtime/intelligence-20261021/ledger.json` 只含本轮合成人物/物品及公开资料，但有完整模型输入/摘录，仍不上传。快照仅导出脱敏可见结果及请求哈希/用量，不含 Key、请求头、完整 Prompt/手册、数据库或真实照片。

### 6.1 已能指出的结果，而非HTTP成功

以下编号对应新 JSON 的 cases.id；同名测试可多次运行，不能只挑一次成功覆盖失败。

- **MAF10**：case84（qwen-plus）首用包含首次清洁、开机语言、空篮、明确食材装入、选程序、结束和清洁；因缺食材/份量保留追问，仍不是实机完成。case112（qwen3.7-plus）又丢装料/后清洁，说明稳定性未达标。最后 `6d385df` 修复短引文/省略摘录后未做在线重测，不能提升其等级。
- **纯进度续接**：case113/117/121（电器/家具/纺织品）均0模型请求、沿用已核验剩余步骤；重复 requestId 也0调用。**底稿缺步骤仍然缺，不能以续接成功掩盖底稿不完整**。新故障/条件变化不走该复用。
- **IKEA LACK / GURLI**：官方 SKU 页面可自动取得；家具维护及纺织洗护可提供真实参数。case116/120 仍有有效操作被短引文拒绝；最后修复离线通过，完整指导在线复验待办。
- **新保留商品 VITMOSSA703.048.90**：case79–82，型号自动取得官方资料，首次/续接有信息且参数有据，准备/干燥细节缺口未补成假说明，完整首洗仍部分通过。
- **Sony/Patagonia**：官方说明书网络失败/官网排队页不能当有效资料；Sony早期曾错误回到普通模型问答，修正路由后诚实降级、0多余调用。失败保留，不伪称已解决来源网络。
- **未知/地区不一致**：case36–43，有界降级、续问不重复检索或重复要型号；不是成功取得专属说明。
- **开放创意**：case124 连续线杯口画框、126纸折痕迷宫、130文字寻宝、134首个数字摄影宾果有可复核操作；没有实物试玩，不能宣称稳定有趣。case123杯透镜光斑、129剥皮香蕉待明早、132未登记小物件、133只有笔记本却书写，均不满足严格标准，仍有漏检。case97倒扣杯后插杯口已被新增规则拦截，但没有用真实新结果证明通用修复。
- **个性化**：case135/136 相同目标库存下，确认建筑细节偏好后变为慢走几何/材质搜集，纸上编号+相机回放比“导出拼图”更可执行；收益限这次规划差异，不能证明用户满意。阅读138/139、文字创作141/142仍有风格/实际收益不稳定及未登记参照物，三组全面增益未通过。撤销后的137/140/143使用无该偏好的新请求，权限边界可查，但生成主题相似不能据此推断“还偷用了记忆”。

完整逐结果独立评分是明确未完成工作。下一位应以 JSON 的最终可见结果、库存和来源逐行动打分：事实有据、未确认资源、关键遗漏、目标达成、回退、个性化增益、总调用/耗时；评分由确定性检查和独立人工复核组成，不能以生成模型的 rationale 当事实证据。

## 7. 明确的接手清单

| 优先级/事项 | 现状与复现、失败证据 | 源码与建议方向 | 完成标准 |
|---|---|---|---|
| P0 商品首用闭环 | 录入MAF10/uk问从准备完成烹饪；case84较全、112丢装料；短句误拒已离线修复 | `document-help.ts`、`knowledge-task.ts`、`agent/graph.ts`；先回放既有请求定位每条拒因，不先加Prompt或硬编码；按实际任务依赖/逐断言取证补齐 | 三类别首次+续接、再一个新商品；不漏关键动作、不猜食材参数，最终UI真实通过 |
| P0 来源可靠性 | Sony PDF服务器读取失败；Patagonia排队页；未知型号/地区需降级 | `knowledge.ts`、`acquisition.ts`、`sources.ts`；有界官方HTML/PDF备选、识别排队/无正文、地区冲突；保留原失败 | 全链区分检索/URL/原文/型号/回答，缓存不重复失败请求，无跨型号操作 |
| P0 续接和超时 | 纯进度0调用已真实验证；底稿不完整会原样延续，真实长尾仍37秒以上 | `guidance-continuation.ts`、`service.ts`、`graph.ts`、`provider.ts`；新条件必须触发真实任务调整；定位连接/响应体/图预算超时，保持完成ID | 新条件、失败报告、授权/版本变化均不误复用，UI可恢复且不重复付费/记完成 |
| P0 任务驱动物品组织 | 当前创意文本/早期简单Plan≠持久任务执行，容易把出行准备变为游戏 | 从下一节设计、`domain.ts` Plan、`life/planning.ts` 资源选择、现有Graph/确认动作扩展 | 真实多物品清单、逐项完成、刷新保存、约束变更保留完成及调整依赖 |
| P1 资源与现实可行性 | case129水果过夜、132小物件、133笔记本当笔、光学假机制；部分已修但不全 | `idea-audit.ts` / `ideas.ts` / `planning.ts`；统一动作依赖，笔记本不等于书写工具，食品存储需真实条件；局部修复后再次全部核对 | 开发样本防回归+新的未调试保留目标，无新增隐藏工具/错误机制，保留趣味与失败 |
| P1 理解与Context | 候选证据、scope、撤销已做；重复倾向/章节仍有限，三对增益不稳定 | `organization.ts`、`context/builder.ts`、`memory/store.ts`；相关性控制、证据去重、拒绝指纹；以资源/行动调整评估收益 | 3组相同目标/库存/模型对照改善可执行性，撤销后输入无私文，无关商品指导不泄露 |
| P1 开放创意质量 | 固定配方可兜底；云端仍回退/误拒、不同方案有时只是改写 | `ideas.ts`、`creative-evidence.ts`、`capability-plans.ts`；先修实际失败的局部动作，来源只短摘录，检验多个方向成果 | 10个独立目标与新保留集、来源/无来源分层、反馈影响后续，不以本地方案冒充模型成功 |
| P1 结果评估 | 新114请求/143记录已保留，逐结果独立评分未完成 | `INTELLIGENCE_RESULTS_20261021.json`；补一份版本化评分旁表，原账本不改 | 每场景最终UI答案、逐行动理由/成本和评者可追溯，失败不改期望掩盖 |
| 后续 真实账户/部署/性能/UI | 家庭仍本机模拟；未公开部署，最新代码未新构建/浏览器全回归；手机非阻断细节待办 | `cloud/`、Docker/deploy、`FamilyPanel.tsx`；先稳定本机闭环，再Linux/HTTPS、账户及并发/备份演练 | 账户权限/跨设备、公网SSRF/限额/媒体隔离实测通过，明确收费/保留/清理规则 |

## 8. 下一轮 P0 专项实施方案：围绕生活任务组织物品（尚未实现）

这是**交接设计**，不是此次新增功能。与开放玩法平等但分开：现实任务先完成目标，创意只在用户要求时作为可选扩展，不再默认把“明天去拍照，帮我准备”改为摄影游戏。

### 8.1 路由与最小合同

在现有 `home/router.ts` / LangGraph 增加任务规划意图及 `skills/registry.ts` 中的任务 Skill，复用已有 Provider、Context、物品授权、行动确认及反馈。需要解析 goal、deadline/timeBudget、场景、明确条件、排除/不购买等硬限制、完成标准与未确认问题；只问会影响下一步的条件。

例如“半小时后去附近拍照，只带家里的东西，不买新的”：完成标准是**相机等必要资源可用且准备清单已确认**；不是必须拍出某种作品。半小时后出发与半小时活动时长分开。模型提出任务候选，服务端校验资源/权限，用户确认保存。

### 8.2 资源匹配必须区分的事实

复用 `Item`、`availability.ts`、已确认 Product Pack/获取资料和 `itemAffordances`。分别保存 owned/shared-permission、registeredQuantity/unit、consumableRemainder、capability+basis、currentAvailability、onsiteCondition、unconfirmedResource、missingResource。相机支持拍照不证明有电/卡空间/未损坏；笔记本不等于笔；公共场地不是持有物；“准备背包”不能默认另有钥匙/杂物。

偏好只在获准、相关时排序已有资源/选择适合动作，不能覆盖预算、禁止物品、期限或安全条件。缺额外物品先说明缺口和替代，不自动下单或改变真实库存。

### 8.3 数据增量，不先建第二套系统

首先评估 `domain.ts` 中 `Plan {id,actor,goal,itemIds,at,checklist?}` 和 workspace JSON。可以在同一 Plan 以可选字段增量加入 revision、status、deadline、constraints、completionCriteria、steps、missing、history、originSessionId；旧Plan读时提供默认值。**这些字段目前未添加。**

每 TaskStep 提供稳定 stepId、action、依赖 stepIds、itemBindings（实例ID/数量/能力依据）、conditions、status(pending/doing/done/blocked/skipped)、completionReport(source=user)、revision。Task-Item Relation 可先是步骤内关系，不强制新SQL表；事件/媒体仍用原ID，不复制故事。Missing Requirements 区分资源/状态/权限/信息。Revision History 保存变更原因与保留/失效步骤，不只改文本。

Plan 保存/修改/标记通过现有事务和 owner/revision/requestId 保护；用户逐项确认现实完成。早期家庭 Task 目前单 itemId，不应直接当完整多物品计划；可增量引用 planId/stepId，跨家庭成员仍走原负责人、确认和最小摘要授权。共享计划不附带私人Context/原故事。

若 workspace JSON 后续并发/索引成为实际阻塞，再将 Plan/Step 按稳定ID规范化到专表并备份迁移；不要同时引入新数据库、队列或向量系统。

### 8.4 动态变更与执行闭环

“相机没电了”先记为本计划中用户报告的受阻条件，检查可用充电资源与时间；无法确认充电条件则提供不带相机的现实替代或告知任务受阻，不凭此永久把物品设损坏。“只剩10分钟”重排必要步骤，舍弃可选项，保留已完成；“不带手电筒”移除相关依赖并重新检查剩余动作，而非仅删一行文字。

模型只对受影响子图建议补丁，服务端验证后以 revision 提交。物品赠出、共享撤销、数量消耗、Context撤销使对应待执行步骤需重新确认；已发生的真实事件按原隐私保留。失败重试复用requestId，不重复完成或重新扣资源。没有IoT时不自动证明现实动作。

推荐最小前端：从“问物间”保存任务 → 轻量准备清单（必要/可选/缺口）→ 展开一步的物品/条件 → 用户标记完成或受阻 → 对话修改 → 刷新恢复；保持统一会话，避免第二套聊天系统。先做旅行准备一个闭环，再扩展整理/做饭/赠礼。

### 8.5 下一轮端到端验收设计（全部待开发/待真实验收）

| 场景 | 真实库/模型/浏览器操作 | 成功标准 |
|---|---|---|
| 出游准备 | 合成库存相机、背包、充电资源；自然语言提出出游，确认电量/空间，逐项准备，刷新 | 必要/可选分明，Plan与进度持久，无隐含资源，不抢占成创意活动 |
| 日常生活 | 分别整理/准备做饭，库存不含假定杂物或刀具 | 明确环境未知/资源缺口，依已有物品给实际步骤，食品条件不瞎猜 |
| 动态变更 | 完成一步后报告相机没电，再缩至10分钟并排除手电 | 保留完成记录，受影响依赖重新规划，无重复请求/完成，剩余清单可执行 |
| 个性化 | 同目标库存/模型/预算，比较无Context和获准摄影偏好 | 改善资源优先级/准备步骤而非只提“建筑”，硬限制一致；撤销后新请求不含原偏好 |
| 家庭任务 | 本机模拟身份分配、交接物品、负责人确认完成 | 权限正确、变更日志可复现；明确仍非真实跨设备云家庭 |

每例需要领域测试、独立数据库持久化、有限真实百炼预算和真实浏览器路径。保存最终可见结果/模型成本，逐行动核对与人工评分，不能只看HTTP200。新测试建议从 `tests/task-planning.test.ts`（待创建）和一个 `tests/task-planning-integration.mjs`（待创建）开始，并复用 `scripts/life-validation-fixture.ts`、既有 verify-local 启动设施。

## 9. 上线前外部条件与交接安全

已有 Docker、Railway单实例Volume、云环境/备份/预算配置见 [部署文档](../engineering/cloud-demo-2026-10-21.md)、`Dockerfile`、`deploy/`。没有购买或公网部署。仍需负责人确认平台/费用、账号权限、持久Volume、地区和模型账户、域名/HTTPS、访问邀请、保留/清理策略、最低安全预算；实际Linux镜像/外网、重启持久化、两访客隔离、上传与SSRF、全站费用停机及备份恢复都要最终验收。SQLite不能多个无共享锁协调的副本同时写同一个Volume。

Git忽略真实.env、api.txt、数据库、依赖、缓存、测试运行目录及原始模型账本；模板无密钥。公开配图来源见 `public/demo/stories/SOURCES.json` 和 `public/demo/life/` 相关来源文件，旧review-evidence为演示截图。没有把本机私人照片/数据库/商业访谈纳入本次提交。扫描覆盖可达历史，不是只删当前文件。如果发现历史凭证必须先停推送并报告/吊销，不能悄悄改共享历史。本次只推交接分支，不推开发分支或 main，不 force，不自动PR/合并。

## 10. 接手者的十个答案

1. **第一步运行什么？** Node24 + `npm ci --cache .npm` + `npm run typecheck`，再按第5节独立构建/独立合成库启动，先别调用付费大组。
2. **哪些稳定不轻改？** Stories唯一正文/多物品与章节关系、媒体权限、作者/赠出隐私、Memory epoch及遗忘、防重放事务、家人负责人/确认、默认费用关闭及legacy兼容。相关单测是回归底线。
3. **最大问题在哪？** 商品逐断言验证/完整任务在 document-help/graph；创意隐含资源/现实动作在 ideas/idea-audit/planning；Context收益不足在候选/相关选择与生成后行动复核。数据可保存不代表任务已完成。
4. **只有一天先做哪三个？** 回放/定向修好商品有效步骤误拒与装料；做出游任务的持久清单/完成/刷新最小闭环；用一套小预算真实浏览器验收和逐结果评分锁定失败，不再整站换皮。
5. **只有三天能到什么程度？** 在一天闭环上补状态/时间/排除的依赖变更及家庭确认，补一个新商品与三类Context对照；形成限定场景可演示候选。不能承诺通用商品/通用创意或生产级跨设备系统。
6. **任务驱动从哪里开始？** 第8节；先识别现实准备意图，复用domain.Plan与事务、life/planning资源选择、Graph/Skill及fixture，新增一个独立测试而非复制Agent。
7. **数据结构保留/扩展什么？** 保留Item实例ID、workspace业务、life v6事件/章节/理解、media BLOB、personal_memories与epoch、会话requestId。Plan/Step/条件/版本按需增量，迁移前备份，不先上Neo4j/向量库。
8. **怎样重现真成功/失败？** 先查脱敏JSON明确case.id、模型、真实库存和最终可见答案；必要时经新授权单独运行脚本group。网络/资料可能变化，需记录新URL/hash/版本；不能用本地回放冒充在线通过。
9. **不能向评委宣称什么？** 全品牌自动说明书库、所有引用已语义证明、通用可靠物理创意、实机完成、稳定个性化增益、真实跨设备家庭、通用视觉实例识别、已上线公网、已完成多步骤任务驱动物品组织。
10. **公网还缺什么？** 明确购买/平台/账号、Volume/域名HTTPS及费用策略；实际Linux/公网安全、持久化/恢复与隔离回归；智能失败边界和对外承诺先收窄。具体清单见第9节。

**交接停止点**：最后小修复有针对性回归；其余智能质量、评分、最新全量/构建/浏览器和任务规划专项明确留给下一位。不要因本手册出现方案而把它写成已实现。
