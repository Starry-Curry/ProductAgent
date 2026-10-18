# 物间：运行、验收与两个分支交接说明

更新：2026-10-18。本说明对应当前 Next.js 工程；功能实现提交为 `8a5c13e`，运行和交接说明的后续提交沿用同一最新分支。代码事实与限制见 [REVIEW_HANDOFF.md](../REVIEW_HANDOFF.md)。

## 1. 应该使用哪个版本

仓库：https://github.com/Starry-Curry/ProductAgent

| 分支 | 功能实现提交 | 本轮重点 | 数据版本与原验收 |
| --- | --- | --- | --- |
| `feat/household-demo-conversations` | `4394b06` | 家居案例、对话式记忆入口、一次性介绍 | SQLite v5；63/63 测试及三组浏览器旅程 |
| **`feat/home-scene-item-companions`** | **`8a5c13e`** | 家庭空间、物品动画角色、全屋路由和行动卡闭环 | SQLite v6；75/75 测试及四组浏览器旅程 |
| `main` | `53a4343` | 早期导入基线 | 尚未合并以上迭代，不能用它代表最新体验 |

两个功能分支是连续迭代。已经用 `git merge-base --is-ancestor` 确认：第二分支包含第一分支的全部修改。**运行、审查和后续开发直接使用第二分支，不需要分别合并或重复 cherry-pick。**

功能提交标识用于区分两次实现；最新分支可能继续增加文档提交，以 `git log -1 --oneline` 和 ZIP 清单确认实际 HEAD。网页不会因为 GitHub 的 `main` 还没更新而自动切换版本。

## 2. 本机怎样打开

本机工程目录：`D:\Project\Tianmao\ProductAgent`。

1. 先在浏览器打开 **http://127.0.0.1:3100**。如果已能访问，可以直接体验。
2. 如果打不开，在上述目录双击 **START.cmd**。启动时若需要构建，等待终端完成并出现服务地址，再打开浏览器。
3. 使用过程中保留手动启动的终端窗口。结束时在该窗口按 `Ctrl+C`；下次或重启电脑后再次启动。本项目没有安装为常驻系统服务。

PowerShell 等效操作：

```powershell
Set-Location -LiteralPath 'D:\Project\Tianmao\ProductAgent'
.\START.cmd
```

项目启动脚本会优先查找 `.runtime\node24\node.exe`，再检查系统 Node，要求 **Node.js 24**；本机已具备运行时和依赖。标准入口为 3100 端口，指南是 http://127.0.0.1:3100/guide 。服务只监听本机，链接不能直接给别人的电脑访问；对方需自行安装运行。

## 3. 新电脑或收到审查 ZIP 后怎样运行

先安装 Node.js 24。检查 `node --version` 输出 `v24.x`，并安装 Git（从仓库获取时需要）。

从仓库获取最新分支：

```powershell
git clone --branch feat/home-scene-item-companions --single-branch https://github.com/Starry-Curry/ProductAgent.git ProductAgent
Set-Location -LiteralPath '.\ProductAgent'
node --version
npm.cmd ci
```

若收到审查 ZIP，解压后进入**包含 `package.json`、`README.md` 和 `START.cmd` 的 ProductAgent 目录**，执行 `node --version` 与 `npm.cmd ci` 即可；ZIP 不包含依赖、Node 二进制、构建缓存或本机数据库。

如需配置千问，在自己的电脑创建环境文件：

```powershell
if (-not (Test-Path -LiteralPath '.env.local')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
}
```

自行编辑 `.env.local`，保留模板的北京百炼地址与 `qwen-plus` 配置，在 `AI_API_KEY` 填自己的北京地域百炼 Key。模板 `AI_ALLOW_PAID_CALLS=false`；需要并同意真实模型调用费用时，再设为 `true`。已有环境文件保持原配置，不重复覆盖。

未配置 Key 或不开启付费调用，仍可体验精选商品事实、有限步骤、本地故事回顾、房间摆放及行动卡；普通模型交流会显示不可用或明确的本地回退，不能据此判断千问已经接通。当前消息可能发给配置的千问；历史私人记忆仍默认不上云，需按现有规则单条授权。Key 只在服务端认证使用，不交给审查者，不入 Git。

构建并运行：

```powershell
npm.cmd run build
npm.cmd run start:local
```

随后打开 http://127.0.0.1:3100 。`start:local` 显式启用本机演示角色和正确端口；顶部小林、爸爸、小夏仍是演示身份。

## 4. 拉取更新、切换分支与开发

先查看 `git status`，保存自己的未提交修改，再更新到最新分支：

```powershell
git fetch origin
git switch feat/home-scene-item-companions
git pull --ff-only origin feat/home-scene-item-companions
```

停止手动运行的旧服务，再重建、启动：

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run start:local
```

本机如主要依赖项目自带 Node24，可用脚本选择运行时并构建：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1 -Task build
.\START.cmd
```

**START.cmd 只在缺少 `.next\BUILD_ID` 时自动构建；已有构建时不会判断源码是否更新。** 所以拉取代码或切换分支后必须重建。更新环境配置后也应重启服务。页面仍旧时再用 `Ctrl+F5` 刷新。

开发模式使用 `npm.cmd run dev:local`，或 `scripts/windows.ps1 -Task dev`；与生产模式共用默认端口，同一时间选择一个。若 3100 已被占用，先访问现有服务确认，不重复启动；也可在新终端设置 `$env:PORT='3101'` 后运行 `npm.cmd run start:local`，访问对应端口。

只比较两次实现，无需切换或运行旧数据库：

```powershell
git diff --stat origin/feat/household-demo-conversations..origin/feat/home-scene-item-companions
git log --oneline origin/feat/household-demo-conversations..origin/feat/home-scene-item-companions
```

## 5. 五分钟体验与核实

1. **空间和角色**：首页切换客厅/厨房/书房；点开边桌或书架。角色按类别和身份呈现，思考、回应等动作表示对话状态。“角色与动画”中可关闭动画，系统减少动态效果也生效。
2. **使用帮助**：在物品对话中选一个有官方资料的示例问题，例如边桌承重，查看回答依据。资料地域和型号有范围，不代表已核对用户实物。
3. **故事与记忆**：对自己的物品自然讲述真实经历，再问“聊聊以前的故事”；首页“记忆与陪伴”可查看来源、纠正、忘记和暂停。演示物品中的故事是合成案例或案例内讲述，不进入真实画像；只做核实时可用演示物品。
4. **全屋安排**：返回全屋对话，说“帮我准备周末野餐”。核对候选与缺口，确认行动卡后去“活动准备”看已保存计划。有限可保存场景为野餐、旅行、阅读角，其他场景可由模型提出建议。
5. **家庭接力和摆放**：对自己已共享的物品说“请爸爸帮我处理”，确认摘要后到“家庭事项”核实；选择自己拥有的物品调整房间/摆放，刷新后确认保存。家庭事项创建不等于对方已完成处理，位置保存不等于实体家具自动移动。

原帮助与案例在首页“使用帮助与原有功能入口”展开；活动、家庭、发现、礼物与记忆功能保留，物品资料链接回到原档案。完整操作见 [本轮实现说明](engineering/home-companions-implementation-2026-10-18.md)。

## 6. 两次迭代分别改了什么

**第一分支：让内容更丰富，让记忆从日常对话产生。** 新增 8 件家居案例、16 段合成故事、24 条演示记忆、4 个家庭事项、2 个计划。新增 7 个官方资料包，知识目录总计 11 包/33 条事实/2 个有限预审过程，保留来源地域与型号范围。首次背景介绍仅一次且可跳过，移除反复添加画像的表单，日常以物品对话新增，记忆区保留查看/纠正/忘记/授权。版本化初始化不重置用户记录，案例不混入真实画像或物资。详见 [第一分支说明](engineering/household-cases-and-onboarding-2026-10-18.md)。

**第二分支：把分散能力收进空间、物品角色和全屋对话。** 在第一分支基础上增加预设房间、位置与档案同步、二维角色/身份配色/状态动画、同一窗口里的帮助/故事/陪伴，以及全屋找物/规划/家庭路由。继续使用已有 LangGraph 和千问适配器，新增 route 节点、有效目标与 Skill 分流；模型工具仍受控。位置、计划、家庭事项先预览、确认后事务执行并回读，带权限/身份/版本/期限检查和幂等回执。切换物品隔离排障条件与私人反馈，记忆回填尊重来源，保留原模块与授权规则。

这两次迭代没有更换产品定位；仍围绕物品、人与物的故事、人与人的协作。当前路由与记忆提取为有限规则，主 workspace 仍 JSON；没有真实登录/跨设备家庭、OCR/识物、语音、IoT、订单和后台通知，不能把页面展示、规则通过或模型成功调用当成实物/健康验证。

## 7. 数据与测试交接

- 日常数据库是 `data/demo.sqlite`。新代码增量升级到 v6，保留 `.before-v5-to-v6.sqlite` 等升级前备份；合成案例由已上传的初始化代码重建。依赖、Key、数据库和构建输出不随 Git/审查 ZIP 上传。
- 第一分支仅支持其 v5 数据；新版本升级后的 v6 库不能直接交给旧分支运行。需要对照旧版本时使用独立目录和独立数据，不覆盖日常库。回退与已遗忘内容/备份的边界见实现交接。
- 功能版本 `4394b06` 的记录为 63/63 测试及三组浏览器旅程；`8a5c13e` 为 75/75、生产构建、独立类型检查、离线基准和四组 API/Edge 浏览器旅程。两轮自动验收真实模型调用均为 0；历史其他阶段的在线百炼证据单独保留，不重复计入。
- 本次运行说明整理未重跑上述全量测试；只核对分支关系、启动脚本、文档链接、当前服务健康和已提交证据，不把历史测试写成本次新增验收。

需要自行复验时：

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:benchmark
npm.cmd run build
npm.cmd run test:acceptance
```

`test:acceptance` 自动使用独立数据/端口并关闭费用；依赖本机 Windows Edge，可通过 `EDGE_PATH` 指定。四组旅程覆盖旧功能、静默记忆、家居案例和家庭空间。勿将单独的 `test:integration` 随意指向日常服务，它会创建和修改验收记录。

## 8. 可以直接转发的一段话

> 物间项目已完成两个连续迭代，并推送到 GitHub。第一分支 `feat/household-demo-conversations`（功能提交 `4394b06`）补充了有官方资料来源的家电/家具案例、合成故事与记忆，并把日常记忆新增统一放到物品对话中，首次介绍只保留一次。第二分支 `feat/home-scene-item-companions`（功能提交 `8a5c13e`，后续文档提交也在该分支）在此基础上加入家庭空间、每件物品的二维动画角色、统一物品对话和基于现有 LangGraph 的全屋路由；位置、计划与家庭事项通过预览、确认、事务执行和真实回执接回原模块，保留原有功能与记忆权限。第二分支已包含第一分支全部修改，请直接使用第二分支验收和继续开发，`main` 尚未合并。该功能版本已通过 75/75 测试、构建、类型检查、离线基准及四组浏览器旅程；两轮自动验收均未新增真实模型调用。运行请先读 `docs/RUN_AND_BRANCH_HANDOFF.md` 与 `REVIEW_HANDOFF.md`，安装 Node24 后执行 `npm ci`、`npm run build`、`npm run start:local`，浏览器访问本机 3100。路由/记忆仍是有限规则，识物、IoT 和真实跨设备家庭尚未接入。

仓库入口：[最新分支](https://github.com/Starry-Curry/ProductAgent/tree/feat/home-scene-item-companions)。审查阅读顺序：本说明 → [技术交接](../REVIEW_HANDOFF.md) → [迭代设计](engineering/home-companions-iteration-2026-10-18.md) → [实现/API/边界](engineering/home-companions-implementation-2026-10-18.md) → [验收摘要](engineering/home-companions-validation-2026-10-18.json) 与源码。
