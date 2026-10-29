# 小型框架实测

只用于合成数据与本轮决策，不是生产框架迁移。根应用仍使用 LangGraph；此子包独立锁版本，不影响根 package-lock。Node 24.16.0 可运行。

从仓库根目录运行：

```powershell
npm ci
npm ci --prefix experiments/framework-evidence
node --experimental-strip-types experiments/framework-evidence/offline.mjs
node --experimental-strip-types experiments/framework-evidence/offline.mjs --arm=pi-durable
```

数据在本工作区 `.runtime/framework-evidence`。四组读取相同登记/关系，复用现有领域授权与幂等；LangGraph 使用当前 checkpointer/provider 的最小宿主，完整产品另测。离线模型是明确脚本，不评价智能。Mastra memory 由宿主显式更新，没有宣称自动提取。Pi Core 的流程持久化由宿主实现。Pi Durable 为 **Experimental**；审批由宿主授权表与原生持久 sleep 配合，测试时钟只在该工作者中偏移，不改系统时钟。

故障工作者为新的进程；在领域保存后 `process.exit(73)`，验证恢复重放与业务效果去重。Pi 每个故障运行独立存储，避免历史未完成任务影响本例；共享库多任务和多进程并发没有认证。Mastra 恢复需区分 suspend 与 crash/restart，并等待所有权租约，不绕过锁。

`live.mjs` 只有带明确限额和现有配置路径才会读取凭证并发请求，默认不运行。不要直接重跑历史授权、删除台账或复制新目录绕开额度。预算网关保存所有 HTTP 尝试、错误与估算费用，提供本机 SSE 适配；原生百炼 SSE 未测。额外费用功能（搜索、视觉等）未启用。

`--stage=main-ui-baseline` 需要从固定 main 导出的 `.runtime/main-source/src`；本轮用 `git archive origin/main src scripts/life-validation-fixture.ts` 导出，不含配置或数据库。`--stage=product-slice` 调用当前产品服务。`collect.mjs` 只导出本轮已知合成 JSON/日志/截图，不复制数据库或配置。

结果、限制和下一轮代码清单：[实测交付](../../docs/engineering/framework-evidence-2026-10-29/README.md)。
