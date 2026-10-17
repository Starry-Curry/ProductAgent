# ProductAgent · 物间

围绕具体物品提供使用帮助、活动准备、家庭协作和礼物记忆。

**本仓库是后续开发的唯一源码入口。** 本机目录：`D:\Project\Tianmao\ProductAgent`；远程：<https://github.com/Starry-Curry/ProductAgent>。

应用以2026-10-17 Wukaifeng交付为起点，原交付记录提交`f0584882769bd85a143b3756ff8e1db2845591c6`。旧Windows包、Python工程及LocalFlow作为历史参考。

首次迁移已完成：2026-10-17 经 SSH 核对并执行普通 push，远程 main 与本地基线 `53a4343` 一致。上传过程与原限制保留在[迁移记录](docs/engineering/repository-migration-2026-10-17.md)。本轮建议见[架构审查](docs/engineering/architecture-review-2026-10-17.md)。

## 启动

技术栈：Next.js 15、React 19、TypeScript、Node.js **24**、内置SQLite。

新电脑安装Node.js 24后：

```powershell
git clone https://github.com/Starry-Curry/ProductAgent.git
cd ProductAgent
npm.cmd ci
npm.cmd run build
npm.cmd run start:local
```

打开 <http://127.0.0.1:3100>。开发使用`npm.cmd run dev:local`，Ctrl+C停止。两个命令均明确启用本机演示身份，只监听127.0.0.1；普通start/dev不自动启用演示角色。真实账号尚未接入，不支持公开部署。

本机默认Node为20；已在忽略目录`.runtime/node24`准备Node24，可双击根目录`START.cmd`，或使用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1 -Task start
# Task可选：dev、test、typecheck、benchmark、build
```

启动器优先使用本项目Node24，缺少构建时自动构建。新克隆不包含运行时与依赖；请安装Node24并npm ci。不要再从旧目录的START.cmd启动当前开发版。

## 模型、数据与验证

新克隆从`.env.example`复制`.env.local`，仅在本机填写`AI_API_KEY`并按账户地域核对地址与模型；公共模板默认关闭`AI_ALLOW_PAID_CALLS`，主动启用真实调用时设为`true`。本机已按用户确认的北京百炼准备`.env.local`，只有 API Key 留空，费用开关已为手动提问开启；填入后重启`START.cmd`即可尝试。配置不入 Git，详见[接入与审查](docs/engineering/architecture-review-2026-10-17.md#百炼北京地域接入)。

当前主帮助入口已接入 LangGraph.js 有状态执行：通用设置可先问，涉及型号再补条件；支持尝试反馈、关联物品、家庭摘要交接。首页可管理本人记忆、兴趣、关系和可选文字陪伴；忘记会使旧上下文失效。规格事实仍按相关来源呈现，增加两个有限官方过程；Key 不会自动扩展知识目录。尚无本地9B、视觉识别或自动Skill迭代。

修改、Prompt/Loop 与边界见 [实现说明](docs/engineering/foundation-implementation-2026-10-18.md)；明早按 [晨间验收](docs/engineering/morning-acceptance-2026-10-18.md) 体验。新增 `npm.cmd run test:acceptance` 会使用隔离数据库和随机本机端口运行旧交互与三条新旅程。

日常数据在`data/demo.sqlite`，测试必须指定独立PRODUCT_AGENT_DATA_DIR。凭证、私人资料、数据库、模型、依赖、构建缓存和ZIP不入Git。

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:benchmark
npm.cmd run build
```

集成测试会写数据，需独立服务/数据库，现有脚本还依赖Windows Edge。真实云端和实物验收不能由离线测试替代。

## 项目入口

| 目的 | 文件 |
| --- | --- |
| 文档目录与优先级 | [docs/README.md](docs/README.md) |
| 产品共识 | [产品说明书V1.1](docs/物品智能服务_完整产品说明书_V1.1_交付版.md) |
| 当前代码状态 | [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) |
| 本轮报告、工程交接 | [DEVELOPMENT_REPORT.md](DEVELOPMENT_REPORT.md)、[REVIEW_HANDOFF.md](REVIEW_HANDOFF.md) |
| Git协作规则 | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 本次来源和验证 | [迁移记录](docs/engineering/repository-migration-2026-10-17.md) |

src是应用，tests是测试，scripts是工具，review-evidence是交付方提供的合成样例与历史证据。后续通过main、功能分支、PR和版本标签迭代；ZIP仅作发行附件。
