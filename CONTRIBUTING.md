# 贡献指南

产品以 [产品定稿](docs/product/PRODUCT_FINAL_V1.md) 为准，进度以 [CURRENT](docs/engineering/CURRENT.md) 为准；工程边界见 [AGENTS](AGENTS.md)，实施方法见 [工程方法](docs/engineering/WUJIAN_ENGINEERING_METHOD_V1.md)。

## 运行与分工

使用 Node.js 24 和现有 package-lock.json：

```bash
npm ci
npm run dev
```

打开 http://127.0.0.1:3200。默认不需要模型 Key，不产生模型费用。真实模型必须具备当前任务明确授权及有效预算，不能只打开开关绕过费用网关。

同学优先维护负责页面与专业业务；共享 Item/Reality、Context、工具契约、权限事务、模型网关由底座负责人协调。Route Handler 负责解析和映射，权限与写入保留在领域服务。外部文字视为数据，网络 I/O 后复核权限和版本。

## GitHub 协作

- main：稳定演示；develop：团队集成，是否已建立见 CURRENT，未建立时继续当前独立研发分支，不自行假定存在。
- develop 必须由通过 typecheck、离线测试和构建的可运行基线建立。研发基线不等于产品验收通过。
- develop 建立后，从最新 origin/develop 创建 feat/*、fix/*、docs/* 或 codex/*；Codex 默认 codex/*。提交小范围完整变化，PR 到 develop，经 CI + 一名组员审查后集成。
- 合入 main、分支保护与仓库权限由负责人批准；不强推、不改已发布标签/共享历史、不改全局 Git。使用隔离工作区保护未提交内容与原项目。

仅在 develop 已存在时使用：

```bash
git fetch origin
git switch -c codex/your-change origin/develop
```

## 检查与证据

开发阶段运行相关定向测试；集成提交前运行：

```bash
npm run typecheck
npm test
npm run build
```

按影响补充 test:life、test:task-planning、test:care、test:benchmark 和实际桌面/移动端浏览器验收；不要每次小改重跑全部。CI 保持离线，两个付费开关关闭。

- Bug 先留失败复现；覆盖成功、拒绝、权限变化、工具异常与恢复。SQLite 迁移检查备份、重复执行和失败回滚，使用独立数据目录。
- 冻结验收与开发集隔离，首答和重试分开。HTTP 成功、JSON 合法、引用 ID、模型自评分不能证明任务成功。
- 真实模型报告输入资料适用范围、实际输出、请求/失败/耗时与费用；没有执行的真实模型或浏览器检查明确写 not_run。
- PR 说明用户收益、影响范围、被替换路径、实际检查、失败/未测项及恢复方法；UI 变化附真实截图。使用 [.github 模板](.github/PULL_REQUEST_TEMPLATE.md)。模板自动出现需进入默认分支，不能为此擅自合并 main。

## 数据与依赖

不读取/打印用户 api.txt，不提交 Key、令牌、Cookie、私人数据库/媒体、依赖或缓存；应用鉴权通过既有安全配置。合成物品和经历明确标注，用户报告不等于实物验证。正常合成测试证据可以公开，不能因公开性删除失败记录。

图片保留来源、许可和用途；AI 图片不能冒充型号实拍。新增依赖更新 lockfile 与 THIRD_PARTY_NOTICES.md。历史费用台账、许可证和恢复点不擅自移动，清理先查引用和回归。

安全问题按 [SECURITY](SECURITY.md) 报告，不在公开 Issue 中披露未修复漏洞或私人数据。

[原贡献说明快照](https://github.com/Starry-Curry/ProductAgent/blob/543a933571489a518e9dd4bb069e674155138d3a/CONTRIBUTING.md)。
