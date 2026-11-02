# 当前物品 API 可见性收敛

日期：2026-11-02；零模型调用、零外网请求，测试数据位于本工作区 `.runtime/visible-*` 独立目录。

## 具体缺陷与修改

原 `domain.visible` 仅按 legacy `canRead` 判断。已存在过期/撤回 foundation grant，但 legacy `sharedWith` 仍在时，workspace/life/collaboration 的当前物品列表仍会返回该物品；这与新 Context 的 `authorize` 结果矛盾。

新增 `foundation/visibility.ts`，在复用原 `visible` 字段脱敏后，按数据库当前 `authorize` 过滤当前物品、当前协作事项、当前可操作计划卡和非本人的共享物品记忆。原作者的私人 memory、gift 和 attempt 正文保留；attempt 的当前物品链接仅保留获准项。失去资源的当前 plan 卡不作为可操作卡展示，原计划历史仍在原领域存储中，未修改或删除。

- `/api/workspace` GET 与 POST 返回同一当前可见投影。
- `/api/collaboration` GET workspace 使用相同投影；原成员/写入事务不变。
- `/api/life` root workspace、数量统计、当前 ideas 使用同一获准物品集合。本人故事正文保留，当前 itemIds 链接撤回。
- `/api/life?itemId=...` 在任何 sources/fragments 读取前调用 `requireVisibleItem`，未授权统一 403。
- `/api/life` updateItem 的返回 workspace 同样过滤；未修改 mutate 或领域写入权限。

不复制生产数据库、不增加表、不修改私人数据；这是查询投影，不是数据删除/迁移。赠礼不应删除作者历史，因此 gift 快照和作者私人记录不依据当前实物权限清空。

## 可复现验证

```powershell
node --experimental-strip-types --test tests/foundation-visible.test.ts tests/foundation-read-permission.test.ts tests/account-collaboration.test.ts tests/shared-item-knowledge.test.ts tests/personal-objects.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

`foundation-visible.test.ts` 新增 5 项测试：明确过期/撤权/空权限；有效跨账号分享；旧无授权表 schema；赠礼后原作者历史；真实 Next Route Request 处理器的三入口一致性。

Route 测试创建两个真实独立测试账号与会话 cookie，通过 `withDemoRequest` 身份检查执行实际 GET/POST handler；不是直接调用可见投影冒充 API 验收。使用 Node 源码 resolver 支持仓库 `@/` 和 `.ts` 导入，未启动服务、未使用真实浏览器，故不称浏览器验收。没有输出 cookie、口令或令牌。

- 三个 GET 入口均不再返回过期/撤权物品与当前事项；life 资料焦点返回 403。
- workspace POST 与 life updateItem POST 对合法本人修改仍成功，但不会顺带返回已失效的共享物品。
- 有效共享后，三入口重新可见，life 资料焦点返回 200。
- 本人历史正文与原始存储不变，未授权外人看不到物品，已有共享字段脱敏保留。

定向首跑 5/5 通过：`visible-api-regression.txt`。相关业务回归 29/29 通过：`visible-permission-business-regression.txt`。类型检查见 `visible-typecheck.txt`。

这些证据证明指定 API 的当前可见性与授权服务一致，不证明全仓所有入口均已审完，也不证明模型回答质量或实体任务成功。
