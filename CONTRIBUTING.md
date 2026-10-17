# Git协作流程

统一在本仓库开发。main为团队集成主线；每项工作从main建立功能分支，经PR审查后合并。

```powershell
git switch main
git pull --ff-only
git switch -c feat/item-recognition
# 修改、验证并更新文档
git add src tests docs
git commit -m "feat: add confirmed recognition candidates"
git push -u origin feat/item-recognition
```

未提交改动先提交或妥善保存再切分支。不要force push覆盖队友。

- 分支：feat/...、fix/...、docs/...、chore/...。
- 提交：feat:、fix:、docs:、test:、chore:，说明一个完整变化。
- PR说明实际变化、测试、已知限制及迁移影响。离线替身不能算真实模型成功。
- 在已验收提交建立版本标签，标签不移动；通过GitHub Releases分发ZIP，模型/运行时另行管理。
- 不再用“最新/最终版2/某人版本”文件夹作为开发主线。

Node24、npm ci；CI运行离线测试、类型检查、基准及构建。集成测试用独立数据库；真实模型请求需要当前任务授权。提交前检查git status、git diff --cached --stat，不提交凭证、私人材料或运行产物。

原交付没有.git。f058488与118e295是来源记录，不是本仓库恢复出的历史；此后以当前仓库真实commit/PR为准。来源见docs/engineering/import-provenance.json。
