# ProductAgent · 物间

围绕具体物品提供使用帮助、活动准备、家庭协作和礼物记忆。

**本仓库是后续开发的唯一源码入口。** 本机目录：`D:\Project\Tianmao\ProductAgent`；远程：<https://github.com/Starry-Curry/ProductAgent>。

应用以2026-10-17 Wukaifeng交付为起点，原交付记录提交`f0584882769bd85a143b3756ff8e1db2845591c6`。旧Windows包、Python工程及LocalFlow作为历史参考。

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

从`.env.example`复制`.env.local`并仅在本机配置AI_BASE_URL、AI_API_KEY、AI_MODEL等。真实付费另受AI_ALLOW_PAID_CALLS控制，默认关闭。没有模型仍可体验本机业务与有限规则。当前没有接入本地9B、视觉识别或自动Skill迭代。

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
