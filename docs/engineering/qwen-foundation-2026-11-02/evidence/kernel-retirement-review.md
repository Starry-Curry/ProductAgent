# 旧 Kernel V3 生产退役清单

日期：2026-11-02。阶段恢复基点：`79d6a5e30a6fb5016e96d9b770ad3aa10f8e315f`；原始 V3 重现基线：`0432ace33cc333bbbbe4bd9db59d3ec20760c7c7`。

## 退役前提与实际改动

先在当前 AgentScope 新运行器与相关业务路径运行 23 项定向测试，全部通过，记录 `kernel-retirement-precondition.txt`。这些是模型替身/权限/协议验证，不宣称真实模型质量已达标。

随后实际移除：

| 路径 | 处理 | 原因 |
|---|---|---|
| `src/lib/agent/graph.ts` | 删除 `executeKernel` import 与 experimental 环境开关分支 | 不再留下能重新打开的旧草稿→第二模型审查执行链 |
| `src/lib/agent/kernel/execute.ts` | 删除生产执行器 | 唯一生产调用边是 graph，已由 AgentScope 工具运行器替代通用执行职责 |
| `tests/kernel-v3.test.ts` 两项旧执行测试 | 改为明确退役负例与当前执行器在途遗忘保护 | 不把新版正确答案冒充旧 Kernel 的成功；保留其余纯函数历史失败回归 |
| `scripts/kernel-v3/{compare,evaluate,experience,preview}` | 启动前核对历史 runtime，当前分支明确拒绝 | 防止环境开关已无作用后，把新版本回答错误标成 V3，对照脚本保留历史用途 |
| `scripts/kernel-v3/retired-runtime.mjs` | 新增零费用前置检查及固定历史 Git 引用 | 在任何费用网关开启前解释如何恢复历史复现，不复制旧 runtime 回生产 |

没有删除 HomeTask、graph 其他业务节点、Practical、任何数据/账目/历史模型输出。`verify.ts`、`contracts.ts`、`physical.ts`、`retrieval.ts` 等仍被纯函数回归或现有业务引用，保留；它们存在不表示旧执行器仍可启用。

## 验证

```powershell
node --experimental-strip-types --test tests/kernel-v3.test.ts tests/foundation-tool-runtime.test.ts tests/practical-agent.test.ts tests/outcome-context-actions.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

- 退役后 55/55 定向回归通过；日志 `kernel-retirement-regression.txt`。
- 类型检查退出码 0；日志 `kernel-retirement-typecheck.txt`。
- 实际导入四个历史脚本，全部在 gateway 前明确退出，网络请求 0；结果 `kernel-retirement-scripts.json`。
- 旧 `WUJIAN_EXPERIMENTAL_KERNEL_V3=true` 不再触发 Kernel Prompt、TaskFrame、ClaimCheck 或 kernel trace。
- 同时打开旧开关和当前 native 执行器时，模型在途遗忘仍导致权限/Context 失效，迟到模型替身结果不能提交。

这只证明退役边界与现有回归，不将 55 项离线通过称为产品或真实 Qwen 验收成功。

## 恢复与历史重现

历史执行器、Prompt、旧执行测试可从上述 Git 提交完整取回。需要旧版本对照时，在新的隔离历史工作区检出固定 V3 基线，使用其当时的源码与测试；不要只在当前分支设置已无效的旧开关。核对历史台账及本轮有效费用授权后才能发起真实模型请求，恢复代码不自动恢复额度。

若需回退当前退役，使用该阶段提交的正常 Git revert；不要覆盖私人数据库或强推共享历史。此次改动无数据迁移，因此数据回滚无需复制/替换数据库。
