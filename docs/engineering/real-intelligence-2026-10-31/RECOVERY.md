# 运行、恢复与下一步

## 本机现场

- 工作区：`D:\ProductAgent-LifeContext\.runtime\real-intelligence-eval-v1`。
- 分支：`codex/wujian-real-intelligence-eval-v1`；基线`c31a535b54f1e0e97b484af5910f34e67eb132d7`。源码恢复点`797b1a3`。
- 原目录仍是旧handoff分支，`?? deliverables/`完整保留；上一轮工作区clean。未修改主分支、Instructions或私人库。
- 数据只在本工作区`.runtime/`。`eval-*`、`journeys-*`、`real-eval-browser`、`real-live-browser`为不同合成数据空间，不复制旧数据库。迁移备份由原机制保留。
- 应用Node24.22.2，当前独立构建`.next-real-intelligence`。旧3224及旧构建未覆盖；本轮离线账号预览3226保留。真实模型浏览器3227已关闭。
- 正式密钥只由网关应用进程读取原有本地配置认证，未读取api.txt，未把密钥交给App/模型、复制进新工作区或提交。App仅使用fixture-only测试凭证。

## 离线启动

在本工作区、Node24环境下：

```powershell
npm ci --ignore-scripts --no-audit --no-fund --cache .runtime/npm-cache
$env:AI_ALLOW_PAID_CALLS='false'
$env:WUJIAN_ALLOW_PAID_CALLS='false'
$env:WUJIAN_BUILD_DIR='.next-real-intelligence'
npm run build
node scripts/real-intelligence/preview.mjs --accounts --port=3226 --data=real-eval-browser --build=.next-real-intelligence
```

构建会自动改next-env.d.ts和tsconfig的类型输出路径；本轮已恢复这些生成性改动，不污染提交。验证用REA junction只复用本机已有固定工具；其他机器无该工具时可选REA用例会skip，必须如实报告。

## 真实评测恢复原则

**本轮已交付并停止付费进程，不自动启动下一轮。** 新运行仍须当前有效授权并共用`real-intelligence-20261031-r1`现有台账，上限不会因脚本stage名字变化而重置。当前137次，最多余13次；不同任务新预算必须另获授权、保留旧记录，不能删除台账/锁绕过限制。

先重新运行`source-audit.ts`、`prepare-sources.ts`取得公开资料快照（不计模型推理，但网络可能变化），不要把新来源回填称作旧测试已见。`evaluate.ts`、`journeys.ts`、`resume-feedback.ts`只在带明确授权标志时运行；stage证据已存在会拒绝覆盖。恢复需沿用原始轮次台账，不用空目录重开150次。

网关台账写入发生在上游发起前；未知用量保持预留。新网关固定版本/本轮目录并使用排他锁，关闭后锁已释放。`stop-real-eval-preview-3227`是本轮关闭标记；不要为了重启删除它并自动继续消费，先核对授权及预算。历史旧网关和旧台账不使用。

## 后续优先级

1. **统一任务Context到可核对主张/行动的最小通路**：多物品任务带齐每件物品型号、范围、相关证据与用户报告；拆开“资料存在”“语义支持”“个人经验”“可执行条件”。先用本轮失败样本验证，不继续堆字段或把general当安全出口。
2. **端到端完成度**：将问题子项、已提供步骤、被拒原因和仍缺动作保留到呈现层。解决中文问英文、多问覆盖和个人经验实际改变下一步，而不是只显示Task ID或一段回忆。
3. 创意和REA暂不扩大。创意结构/物理机制存在基础错误；REA先需要统一授权范围、适配器证据、执行回读和幂等契约。保留既有软件实验，不以此宣称真实设备已适配。

无需产品负责人决定普通代码组织。需要产品判断的少数问题：是否接受当前更诚实但拒答较多的实验体验；何时组织匿名真人评审；待Context/事实门禁修复后是否批准下一轮真实质量评测。不能以新增页面替代这些门禁。
