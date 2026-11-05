# 物间共同开发

当前 main/develop 使用 Python/FastAPI 智能后端与 React/Vite 前端；旧 Next.js 实现在归档标签中。首次接入先阅读 README 和两份 2026-11-05 审计，不以“基线已提交”理解为“智能底座已验收”。

## 本地准备

建议 Python 3.12、uv、Node.js 22.12 或以上。

```powershell
uv sync --frozen --cache-dir tmp/uv-cache
npm.cmd --prefix frontend ci --cache=tmp/npm-cache
npm.cmd --prefix frontend run build
.venv\Scripts\python.exe -m wujian serve
```

在本地从 `.env.example` 建立自己的 `.env`，不要覆盖已有密钥。未配置密钥时可以运行基本业务和离线测试，真实模型、搜索和向量调用需要配置与有效授权。默认访问 http://127.0.0.1:8000 。

每位成员使用自己的 `var/`，不要通过 Git 或网盘共用 SQLite 文件。旧 TypeScript `demo.sqlite` 不能直接用于当前应用。

## 分支和评审

从最新 develop 建立功能分支，提交前核对差异和不应上传的本地数据。小批提交，PR 到 develop；main 由负责人明确批准更新。公共接口、迁移和结果语义由底座负责人统一复核。

```powershell
git switch develop
git pull --ff-only origin develop
git switch -c feat/your-feature
```

此命令用于干净、已在当前实现基线上的检出。仍在旧 TypeScript 工作区且有未提交修改的成员，应先保存其分支，再使用新目录检出当前基线，不直接覆盖旧工作区。

## 必要检查

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -v
.venv\Scripts\python.exe -m wujian validate fixtures/development/catalog.json
.venv\Scripts\python.exe -m wujian openapi contracts/openapi.json
npm.cmd --prefix frontend run types
npm.cmd --prefix frontend run build
```

只改文档时检查链接、事实与引用；业务修改运行受影响的检查，集成时完整回归。新失败应有可复现证据；不要把已有34项通过当作覆盖全部缺口。

CI只进行离线工程检查，不设置真实百炼密钥，不连接设备。真实模型验收、独立样本与实机效果分别记录，不能以 CI 成功代替。

## 历史和恢复

`docs/2026-11-05_主线同步与分支归档.md` 列出旧分支与归档标签。每个归档标签固定原提交，包括当时的源码、文档和历史证据；无需把两套运行时叠放在当前主线。
