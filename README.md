# 物间 Wujian

释放人与物的价值：理解你实际拥有的物品、人与物的经历及现实条件，帮助兑现、创造、延续和传递价值。

当前优先级：共享底座与共同开发前审阅。PR #4已于2026-11-05在远端合并，develop为`3285e8d`，代码树与本次审计的团队候选`32c6119`相同。历史材料不等于正式能力，Core/Full质量仍未通过；各组按公共接口独立开发和审查，不直接更新main。具体分工看下方说明。

- [当前工程状态与恢复点](docs/engineering/CURRENT.md)：哪些实际可用、哪些未通过验收。
- [产品共识定稿](docs/product/PRODUCT_FINAL_V1.md)：产品理念与完整范围。
- [团队接入指南](docs/engineering/TEAM_INTEGRATION.md)：分支起点、公共服务、离线Mock、专业工具与兼容边界。
- [分工开发说明](docs/engineering/TEAM_WORK_PLAN.md)：审计前暂停历史集成，角色分工、开工步骤和底座验收边界。
- 共同开发前审阅：[完整功能与交互](docs/review/2026-11-05/PRODUCT_FUNCTIONS_INTERACTIONS.md) · [结合源码的技术架构审计](docs/review/2026-11-05/CODE_ARCHITECTURE_AUDIT.md)，区分设计、落地、真实验证和未达标项。
- [贡献指南](CONTRIBUTING.md) · [工程规则](AGENTS.md) · [文档索引](docs/README.md)。
- [GitHub 协作操作](docs/GIT_WORKFLOW.md) · [后续研发规划](docs/engineering/NEXT_STEPS.md)。

## 本地运行

使用 **Node.js 24** 与现有 package-lock.json，无需独立数据库服务。先fetch最新远端，再从`origin/develop`创建自己的功能分支。接入方式见 [团队接入指南](docs/engineering/TEAM_INTEGRATION.md#从哪里开始)；其中“PR #4合并前”的临时分支说明已是历史。

```bash
npm ci
npm run team:dev -- --name=alice --port=3251
```

打开 http://127.0.0.1:3251，注册自己的本地测试账号。团队命令强制关闭付费模型、公开联网和设备实验，使用 `.runtime/team-dev/alice` 和 `.next-team-alice`，不读取其他人的数据库；同机运行另一成员时换名字和端口。Windows 可使用 npm.cmd。停止用 Ctrl+C。原 `npm run dev` 仍保留为本地演示身份入口，不等于账号权限验收。

不需要 Key 就能测试工具往返、Task 和确认反馈：`npm run team:mock`；四方向公共接口与权限回归：`npm run test:team`。Mock 不能证明真实模型质量。

```bash
npm run build
npm start
```

生产方式本地启动也不代表已公开部署。构建目录与当前候选的具体启动参数以 CURRENT 为准。

## 模型与数据

默认付费关闭，未配置模型时可运行本地物品与业务界面；不把本地规则或模型替身称为真实智能。可参考 .env.example 配置当前工作区安全环境，.env.local 和 Key 不进入 Git。真实千问、搜索、抽取等收费能力须有当前任务授权、两个费用开关及有效网关台账，操作方法看 CURRENT，不能仅以启动参数替代授权。

商品官方事实、用户报告、合成家庭、模型设想与实际设备验证必须分开；物品来源及能力不代表已拥有或已获设备控制授权。不上传私人数据库或秘密，安全说明见 [SECURITY](SECURITY.md)。

## 在哪里改代码

| 位置 | 内容 |
| --- | --- |
| src/app、src/components/life | 页面、接口和生活体验 |
| src/lib/context | 物品事实、来源、能力与任务相关上下文 |
| src/lib/agent、src/lib/ai | Agent 调用、工具及模型接口 |
| src/lib/life、src/lib/foundation | 物品、关系、任务/结果与领域业务 |
| tests、scripts | 回归测试、启动和隔离验收 |

GitHub 分工：main 为稳定演示、develop 为团队集成；feature/*、fix/*、docs/*、codex/* 为独立开发分支。通过 PR 合入 develop，需 CI 通过及一名组员审查；main 由负责人批准更新。分支命令与提交流程见 [CONTRIBUTING](CONTRIBUTING.md#github-协作)，底座调用与 Mock 直接见 [TEAM_INTEGRATION](docs/engineering/TEAM_INTEGRATION.md)，不在这里复制。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

开发期优先相关定向检查，集成时集中回归；涉及用户流程需实际浏览器验证。付费调用和实体操作必须单独符合授权，CI 不产生模型费用。自动检查通过不等于真实任务或整个产品验收通过。

[历史文档及固定恢复链接](docs/HISTORY.md) · [第三方声明](THIRD_PARTY_NOTICES.md) · [变更记录](CHANGELOG.md)。
