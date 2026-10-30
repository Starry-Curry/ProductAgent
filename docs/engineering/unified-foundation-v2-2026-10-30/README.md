# 整体升级 V1.2 执行交接

**实验分支，可运行；G5整体验收未通过。** 从这里读 [产品变化与架构](DELIVERY_REPORT.md)、[真实测试](TEST_EVIDENCE.md)、[未达标项](REMAINING_GAPS.md)、[冻结依据](ARCHITECTURE_ADR.md)。原任务包完整保留在 [package](package/)，不把包中目标当已实现。

本机最终预览：<http://127.0.0.1:3222/>。独立数据、需新建本机账号，付费模型关闭；所有测试持有/经历均为合成，不是你的物品或真实家庭。旧3216保持原样。

最终收口复验日期：2026-10-31（北京时间）。页面服务是本机进程，进程结束后按下方命令恢复；GitHub分支本身不是在线部署。

体验：新建账号 → 录入并确认持有/勾选测试身份，或按现有明确许可载入模拟家庭 → 展开“继续我的事”输入目标和相关物品 → 开始任务 → 跳到物品/故事/家庭再恢复 → 记录实际反馈。新建目标直接发起；恢复旧目标不自动发送旧私密语境。模型不可用时如实提示，资料与确定性业务仍可用。

两账号协作：先邀请、另一浏览器接受 → 逐件授权 → 核对摘要创建事项 → 对方已读、接手、报告；共享/撤销不改变私人故事授权。大字模式的M185可以使用已有审核资料并预览交家人。REA只适用自有合成软件灯；没有硬件控制。

## 复现环境

Node 24.x，npm/package-lock；不改全局Node或Git。新目录执行：

```powershell
npm.cmd ci
$env:AI_ALLOW_PAID_CALLS='false'
$env:WUJIAN_ALLOW_PAID_CALLS='false'
$env:WUJIAN_BUILD_DIR='.next-unified-v2-final-safe'
npm.cmd run build
node scripts/product-foundation/preview.mjs --accounts --port=3222 --data=unified-demo --build=.next-unified-v2-final-safe
```

preview强制本机监听与独立 `.runtime/unified-demo`，默认模型关闭；**不要使用 `--cloud`，本任务没有新的付费授权**。不复制 `.env.local`、api.txt、账号库、上传资料或旧生产数据库。普通运行沿用 Next/SQLite/LangGraph，没有新增生产框架依赖。

可选REA固定版可以在隔离 `.runtime/rea-tools` 安装 `rea-agents@6.8.0 --ignore-scripts`；当前工作区复用已有工具。缺失则明确不可用/测试skip，不伪造分析。软件实验开关只在隔离preview启用，不是默认生产硬件权限。

## 测试恢复

先`npm test`、`npm run typecheck`、`npm run test:benchmark`。浏览器需本机Edge；`TEST_BASE_URL=http://127.0.0.1:3222`，按 `acceptance.mjs → journeys.mjs → care.mjs → integration.ts` 顺序写逐案结果，避免多个脚本并发覆盖同一结果文件。首次acceptance实际联网，重跑可用`REUSE_NETWORK=true`复用首轮明确标注的网络记录；不能把复用称新联网。

阶段恢复点：94de196（冻结）、65f7135（无损适配/Grant）、b06b716（原文证据）、f805f83（任务核心）、6154dc4（真实产品流程与收口安全修复）。无损迁移备份在独立数据目录的`*.before-unified-v1.sqlite`；恢复只能在新目录演练，不自动覆盖真实库。新增表保留，回退旧代码不删表；未知新schema版本拒绝写入。

[GitHub分支](https://github.com/Starry-Curry/ProductAgent/tree/codex/wujian-unified-foundation-v2)。不合main、不强推、没有部署、外发、真实设备或私人数据迁移。
