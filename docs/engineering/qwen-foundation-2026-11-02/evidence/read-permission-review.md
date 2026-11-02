# 正式读取权限分叉复现与修复

日期：2026-11-02。仅使用独立 `.runtime/read-permission-*` 合成数据库，未读取私人数据库、未发起付费模型或公开网络请求。

## 已证实问题

同一物品仍有 legacy `shared=true/sharedWith`，同时 `foundation_grants` 已过期时，`authorize` 拒绝，旧 `readItemContext` 和 `readKnowledge` 仍按 `canRead` 读取。此结论是服务级复现，不将其夸大为所有 HTTP 入口均可越权。

`read-permission-before.txt` 保存修改前的真实失败：4 项测试，1 通过、3 失败。包含明确授权过期、无数据库纯投影绕过授权、旧 schema 缺少 grants 表。

## 修复

- `accessibleItemContexts(state, actor, demo?, db?)`、`readItemContext(state, actor, id, demo?, db?)`、`itemContextPage(state, actor, demo?, offset?, limit?, db?)`：传数据库时调用当前 `authorize`；无数据库仅允许物主，不能以纯快照认证跨人分享。
- `sharedItemKnowledge(..., { demo?, db? })` 沿用上述契约。
- `buildContext` 明确物品无权限时立即 403，不降为无物品的全局 Context；资源目录与共享知识调用传数据库。
- `readKnowledge`、`indexOfficialSource`、`acquireKnowledge` 开始与异步结束均使用当前授权。异步期间撤权，不返回新资料且不落库。
- `authorize` 在正常旧 schema 没有 `foundation_grants` 表时兼容 legacy 分享；表存在且有明确拒绝、过期或撤回记录时，不能回退 legacy 分享。明确授权仍不能覆盖撤回的 legacy 分享。

`itemContext(item)` 仍是调用者已授权后的纯格式投影，不独自宣称提供访问控制。底层 `storeOfficialDocument` 保留原 server-side helper 契约；上层获取和索引服务负责当前权限检查。

## 实际验证

Node.js 24.22.2：

```powershell
node --experimental-strip-types --test tests/foundation-read-permission.test.ts tests/shared-item-knowledge.test.ts tests/intelligence-alpha.test.ts tests/foundation.test.ts tests/acquisition.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

- 修复后定向回归：60 项通过，0 失败。日志 `read-permission-after.txt`。
- 新增 6 项：过期/撤回/空动作拒绝；有效共享与无数据库拒绝；旧 schema 兼容；legacy 撤回/转移边界；异步获取中撤权且不落库；无焦点创意资源过滤。
- TypeScript 检查通过；`read-permission-typecheck.txt` 无诊断输出。
- 原共享物品、记忆纠正/遗忘、家庭交接、LangGraph checkpoint 与云端最小化测试保持原断言。

这证明读取权限契约收敛和指定回归通过，不证明模型问答质量提高或完整产品已验收。新生产 reader 调用必须传 `db` 才能保留有效跨人共享；遗漏会安全拒绝，不会扩大数据权限。
