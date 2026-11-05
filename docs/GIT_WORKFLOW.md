# 物间 GitHub 协作与使用指南

本指南将用户提供的《Git协作与使用指南》适配到 **ProductAgent / GitHub**。原文面向 SynapseTask、CodeArts 和 master；这里沿用当前仓库的 main，不另建 master，也不迁移托管平台。产品和安全规则仍以 [AGENTS](../AGENTS.md)、[贡献指南](../CONTRIBUTING.md) 为准。

## 分支和合并规则

用户最新要求（2026-11-05）：先完成共享底座，审计前不再次接入历史模块或过程材料。PR #4暂停为Draft；各组可以独立开发和提交Draft PR，但暂停期间不合并候选/develop/main。解除暂停和确定基线后才执行本节通常合并流程。见 [分工开发说明](engineering/TEAM_WORK_PLAN.md)。

| 分支 | 用途 | 更新方式 |
| --- | --- | --- |
| main | 稳定演示 | 负责人明确批准后更新 |
| develop | 团队集成 | 功能 PR，CI 通过，并经一名组员独立审查 |
| feature/*、fix/*、docs/*、codex/* | 独立开发 | 从当前有效团队基线创建，推送自己的分支 |

**2026-11-05 更新：** 负责人已将最新成果 `dbd93cf` 更新到 main，develop 仍为旧版 `f449067`。本次团队同步候选为 `origin/codex/wujian-team-ready-v2`。同步集成 PR 经 CI 和组员审查、合入 develop 前，大家从该候选开始；之后统一从最新 develop 开始。旧 PR #1 的候选不再是最新底座。实际集成状态见 [CURRENT](engineering/CURRENT.md)。

## 首次加入

```bash
git clone https://github.com/Starry-Curry/ProductAgent.git
cd ProductAgent
git remote -v
git fetch origin
# 只设置当前仓库，使用自己的 GitHub 身份和隐私邮箱
git config --local user.name "你的GitHub用户名"
git config --local user.email "你的GitHub隐私邮箱"
```

邮箱从自己的 GitHub Settings → Emails 复制，不猜用户 ID，不使用其他人的身份。不要输出全部 Git 配置来排错，其中可能包含认证信息。

develop 同步最新底座前的临时起点：

```bash
git switch -c feature/your-name-your-feature origin/codex/wujian-team-ready-v2
```

同步集成 PR 合并后的正常起点：

```bash
git fetch origin
git switch -c feature/your-feature origin/develop
```

运行、离线 Mock、公共服务和专业工具接入见 [TEAM_INTEGRATION](engineering/TEAM_INTEGRATION.md)，这里不复制。

## 日常提交与同步

开始前先看分支和修改：

```bash
git status --short
git branch --show-current
git fetch origin
```

提交时逐项检查，只暂存自己确认的文件，不把秘密或他人的改动一起加入：

```bash
git diff
git add path/to/changed-file
git diff --cached
git commit -m "feat: describe the user-visible change"
git push -u origin feature/your-feature
```

提交前缀使用 `feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`chore:` 等，说明这次具体改变。后续推送当前已跟踪分支使用 `git push`。

自己的分支需要吸收团队更新时，先保存工作，再合并基线；不必切换或改写其他人的分支：

```bash
git fetch origin
git merge origin/develop
```

develop 同步前，将上面的合并来源换成 `origin/codex/wujian-team-ready-v2`。不要在有未保存修改时盲目合并，也不要强推解决冲突。每人使用独立 clone 或 worktree、自己的端口和测试目录，不能共用同一个正在修改的工作区；启动命令见团队接入指南。

暂时不能提交时，可使用命名 stash；确认恢复成功之前不要删除 stash：

```bash
git stash push -u -m "wip: before syncing team baseline"
git merge origin/develop
git stash apply
git status
# 核对全部改动恢复后，再 git stash drop
```

`-u` 不包含已忽略的数据库、环境文件和缓存。它们保留原地，不作为 Git 备份；不得上传私人数据。重要未提交工作也可以在自己的分支保存明确标记的恢复提交。

发生冲突时逐段理解双方修改，保留应有的业务与权限检查，再 `git add` 对应文件并完成提交。无法判断时与该模块负责人一起核对，不整份选择“我的”或“对方的”，不使用 reset/clean 丢弃工作。

## 发起和审查 PR

在 GitHub 打开 Compare & pull request，通常选择个人分支 → develop。按 [PR 模板](../.github/PULL_REQUEST_TEMPLATE.md) 写用户收益、范围、实际检查、失败/未测项和恢复点。CI 离线运行，不启用付费模型。

- 最新底座尚未进入 develop 时，个人功能 PR 先指向 `codex/wujian-team-ready-v2`，说明依赖同步集成 PR，先供评审。
- 同步集成 PR 合入后，个人 PR 改向 develop，重新核对差异并检查最新 HEAD 的 CI，不能沿用旧 HEAD 的绿灯放行。
- 同一个 PR 只解决一个可验收问题，尽早集成，不把全部人的工作拖到最后一次性合并。
- 作者不能代替另一名组员批准自己的 PR。CI 绿灯是工程检查，不表示真实智能质量通过。
- 更新 main 仍需负责人批准；本指南不授予自动合并、改保护规则或公开部署权限。

## 清理和恢复

日常只清理已确认无用且可恢复的文件。删除分支前核对完整 SHA、提交是否已保留、开放 PR 和使用者；历史费用、失败证据、冻结题、许可证及私人数据不能按“旧”字直接删除。

本轮用户另行授权清理旧分支。只处理已被 main 包含、无开放 PR 且无未提交工作的旧 Codex 分支；完整 SHA、保留原因和实际删除结果见 [团队底座交接与恢复](engineering/team-ready-2026-11-05/DELIVERY.md)。不删除本地其他任务的 worktree、独立成果分支或历史提交，不强推或重写历史。

恢复旧文件可先查看固定提交，或建立独立恢复分支；已发布修改需要撤销时用新的 revert 提交经 PR 审查，不覆盖当前工作区：

```bash
git show <commit>:path/to/file
git switch -c fix/revert-change origin/develop
git revert <commit>
```

图形操作可用现有 VS Code Source Control 或 GitHub 网页，无需为了协作额外安装插件。无论使用哪种界面，都要核对当前分支、差异、目标分支与审查结果。
