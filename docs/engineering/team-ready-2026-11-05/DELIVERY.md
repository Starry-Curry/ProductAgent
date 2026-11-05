# 团队开工底座与协作交接

## 组员今天能做什么

基于现有 `foundation-services/1`，各自开发页面与专业业务，复用物品/知识/能力、Context、Agent、Task、反馈和授权，不用再写一套模型或记忆系统。入口与可复制示例见 [TEAM_INTEGRATION](../TEAM_INTEGRATION.md)。本轮只补团队运行工具和协作入口，不开发其他产品功能，也不声称智能质量已通过。

```bash
git clone https://github.com/Starry-Curry/ProductAgent.git
cd ProductAgent
git fetch origin
# 最新底座同步进 develop 前使用这个明确候选：
git switch -c feature/alice-your-feature origin/codex/wujian-team-ready-v2
npm ci
npm run team:dev -- --name=alice --port=3251
# 浏览器打开 http://127.0.0.1:3251，创建自己的测试账号
```

Node.js 24；Windows 可用 npm.cmd。合并集成 PR 后，新功能改从 origin/develop 分支；已开始的功能合并团队更新，不删除工作重来。临时基线的个人 PR 指向候选，集成后改向 develop。不要多人/多个Agent同时写一个文件夹；同机用不同 clone/worktree、名字和端口。Git 分支隔离代码，`.runtime/team-dev/<name>` 和 `.next-team-<name>` 隔离本地运行状态。

付费、搜索/公开获取、设备实验和未验收问答实验由团队启动命令强制关闭；启动不会读取其他工作区配置，不连接别人的数据库。零模型 UI 不会生成真实智能回答。`npm run team:mock` 使用既有独立示例和 Mock Provider；`npm run test:team` 覆盖共享服务四方向和启动安全配置，不能当真实千问/实物通过。真实模型统一由底座负责人在有效费用授权下安排。

## 公共边界

- 服务端只从 `src/lib/foundation/services.ts` 进入；页面使用现有认证 API，不能把服务端模块/数据库打入浏览器包。复制 `examples/foundation/goal-feature.ts` 组合自己的服务，`run-mock.ts` 演示隔离初始化。
- `Provider` 可替换，资料检索、来源、Context 内部可升级；上层不导入具体 SDK/运行器。新工具先实现独立领域函数，再由底座负责人接入现有 Schema/权限分派，无需新框架。
- 共享语义、权限/身份、迁移、费用、工具协议和 lockfile 变更要在小 PR 协调。可兼容的可选字段不要求所有页面同时改；不兼容变更须列消费方、迁移例子和适配期。
- 私人经历不因共享物品自动共享；反馈必须确认，复用和上云分别授权，修改/遗忘/撤权继续走现有服务。HTTP200 不等于任务成功。

## GitHub 集成与分支清理

本次开始时 main=`dbd93cfc9f684ccac7b0f80727cdaebcea898ca9`，develop=`f449067ce939d7fe82a3e48bab15df046d6eb2bc`，后者是前者祖先。main 的历史保护分支 `codex/main-backup-20261105-ea32c3f` 保留。准备团队候选→develop 的同步 PR，必须最新 CI 通过且一名组员独立审查，作者不替代组员审批、不直接更新 develop。旧 PR #1/#2/#3 保留，本轮未修改它们；新的同步 PR 包含它们已进入 main 的成果，组员应审查最新候选，不重复合并旧候选。

已创建 [PR #4：最新底座→develop](https://github.com/Starry-Curry/ProductAgent/pull/4)。这是当前团队同步入口，尚未合并；组员从该 PR 源分支即可开始独立开发。最终是否符合合并条件，以最新 HEAD 的 CI 与一名其他组员实际审查为准，不因创建 PR 自动放行。

用户本轮另行授权清理旧分支。完整分支名、40位 SHA、main 包含关系、开放 PR 与保留原因见 [BRANCH_SNAPSHOT.json](BRANCH_SNAPSHOT.json)。14个旧Codex分支符合清理条件；只删除远端分支引用，所有提交已被 main 包含，本地分支/worktree/未提交修改/原始费用证据不删除。`codex/wujian-real-intelligence-eval-v1` 有未提交评测记录，保留；开放 PR 的源/目标、独立成果、其他成员 feat/*、main、develop、旧 main 恢复点都保留。

删除前先推送本清单作为恢复锚点，再重新核对远端 SHA，以普通 atomic push 删除；不强推、不 filter-repo、不改历史。实际删除是否成功以提交后的 [分支结果](evidence/branch-cleanup-result.json) 为准，不能把清单当执行完成。

实际已执行：恢复清单先发布于 `29eb3301ac18d3e086ff237c93bd960ad4dce6d8`，随后14个目标分支普通原子删除成功；含新团队候选后剩16个远端分支，所有保留分支SHA一致，main/develop未变化。未清空/删除任何本地worktree或数据库；原评测工作区的未提交调用/费用文件原地保留。

恢复单个旧远端分支（先检查是否已有同名分支，不覆盖新成果）：

```bash
git fetch origin
git show <BRANCH_SNAPSHOT里的完整SHA> --no-patch
git push origin <完整SHA>:refs/heads/<原分支名>
```

本轮代码/文档回滚使用新的 revert PR，不 reset/clean 用户工作区，不回滚私人数据库。没有 schema/数据迁移，无新模型费用，无真实设备操作，无公开部署。

## 验证与限制

实际记录集中在 [evidence](evidence/)：`team-tests.txt`、`team-mock.txt`、`team-config.json`。第一次 typecheck 因测试夹具的环境变量类型推断失败，原日志 `typecheck.txt` 保留；已将启动配置参数明确为字符串环境映射，复测另存 `typecheck-r2.txt`。最终回归/生产构建、实际团队启动记录以本目录后续日志为准。

本地 Node24 实际通过：`npm run test:team` 7/7；`team:mock` 的 Task/Run/确认反馈/重复写入幂等且0上游请求；typecheck复测；完整离线回归683/683；独立 `.next-team-release` 生产构建。`team-browser.json` 记录实际 `team:dev`→浏览器注册→首页、390像素移动端无横向溢出、匿名API401、0页面异常；截图为 `team-desktop.png` 与 `team-mobile.png`。均未调用真实Qwen，不新增智能质量结论。构建自动改写的 Next 类型引用/配置只恢复为本轮开始时的已提交内容，不提交个人构建目录。

截图独立检查发现首轮截在首页数据加载中，故首轮只能证明账号和页面外壳，不能据此声称物品工作区已加载。另存 `team-browser-r2.json` 与 `team-desktop-r2.png` / `team-mobile-r2.png`：明确等待加载结束，实际通过表单确认录入合成物品，物主读取200、匿名读取同件物品401，移动端无横向溢出、0页面异常。没有覆盖首次日志/截图，也没有调用模型。这一复验才支撑“组员能在独立工作区实际录入并读回物品”的结论。

main 的 `dbd93cf` 在 GitHub 的 [Validate](https://github.com/Starry-Curry/ProductAgent/actions/runs/41956944131) 已成功；不把上一提交 CI 冒充本次新 HEAD 通过。Core/Full 和全产品质量仍 NOT_ACCEPTED：陌生型号来源覆盖、语义操作正确性和物理创意可靠性尚有失败，旧18题0/18及全部费用/失败记录不改变。团队能够并行开发是工程接入结论，不是产品可靠性认证。
