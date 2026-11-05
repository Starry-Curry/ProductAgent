# 团队独立接入示例

分支、公共类型、错误和工具扩展规则见[团队接入指南](../../docs/engineering/TEAM_INTEGRATION.md)。该示例只导入公共服务，不导入内部模型运行器。

Node.js 24，安装仓库锁定依赖后，在仓库根运行：

```powershell
node --experimental-strip-types examples/foundation/run-mock.ts
```

这是零网络、零模型费用的协议示例，数据库仅在 `.runtime/team-example-cli-*`；不代表真实千问或实物验证。

`goal-feature.ts` 不依赖商品问答页面，直接使用 `src/lib/foundation/services.ts`：发现获准资源 → 同一 Task → 注入 Provider 的现有执行器 → 用户明确确认 Outcome。生产接入使用应用已认证的 actor、既有数据库与最新 state，不从请求正文信任身份，不复制数据库或权限逻辑。

- `readReality` / `discoverCapabilities`：统一事实、来源、状态与条件化能力。无匹配可不带 goal 分页浏览；词法匹配不证明库存缺失或物理可行。`scopeItemIds` 只能进一步缩小权限。
- `startGoal`：传稳定 requestId；重试同一输入复用已有任务与回复，变更输入必须新请求。Provider 为依赖注入，未来更换模型/工具实现不需要重写该专业模块。
- `confirmGoalOutcome`：稳定 requestId、用户确认、复用与云端许可分别表达；旧 revision 发生冲突时返回 409，调用者重新展示最新状态供用户确认，不能静默重放写入。
- 读权限失效返回 403。能力不是设备操作许可；图示模型识读为未验证观测。实际执行仍走既有授权、幂等和回读。

HTTP 读入口 `/api/life?itemId=...` 与 `/api/life?capabilities=...&cursor=0` 使用同一服务并验证账号。不要把服务层的服务端 actor 参数当成公开身份 API。Mock 的两轮工具往返只用于开发和自动化，不用于产品质量评分。
