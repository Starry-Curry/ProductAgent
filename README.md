# 物间 Wujian

释放人与物的价值：理解你实际拥有的物品、人与物的经历及现实条件，帮助兑现、创造、延续和传递价值。

- [当前工程状态与恢复点](docs/engineering/CURRENT.md)：哪些实际可用、哪些未通过验收。
- [产品共识定稿](docs/product/PRODUCT_FINAL_V1.md)：产品理念与完整范围。
- [团队接入指南](docs/engineering/TEAM_INTEGRATION.md)：分支起点、公共服务、离线Mock、专业工具与兼容边界。
- [贡献指南](CONTRIBUTING.md) · [工程规则](AGENTS.md) · [文档索引](docs/README.md)。

## 本地运行

使用 **Node.js 24** 与现有 package-lock.json，无需独立数据库服务。

```bash
git clone https://github.com/Starry-Curry/ProductAgent.git
cd ProductAgent
npm ci
npm run dev
```

打开 http://127.0.0.1:3200；Windows 可使用 npm.cmd。服务只绑定本机回环地址，默认本地演示身份与 data-life-v1/ 数据目录，不复用旧工作区数据库；可以用 PRODUCT_AGENT_DATA_DIR 指定独立测试目录。演示身份不代表真实用户认证。停止用 Ctrl+C。

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

修改公共契约或权限事务前先协调底座负责人，按 [贡献流程](CONTRIBUTING.md) 使用独立功能分支与 PR。main 保持稳定；develop 的实际状态看 CURRENT，未建立前不要假定能从其开发。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

开发期优先相关定向检查，集成时集中回归；涉及用户流程需实际浏览器验证。付费调用和实体操作必须单独符合授权，CI 不产生模型费用。自动检查通过不等于真实任务或整个产品验收通过。

[历史文档及固定恢复链接](docs/HISTORY.md) · [第三方声明](THIRD_PARTY_NOTICES.md) · [变更记录](CHANGELOG.md)。
