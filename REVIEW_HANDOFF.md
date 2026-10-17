# ProductAgent统一仓库交接

更新：2026-10-17。先读README.md、IMPLEMENTATION_STATUS.md、docs/README.md。

## 唯一主线与来源

- 本机D:\Project\Tianmao\ProductAgent；远程Starry-Curry/ProductAgent，main。
- 源码来自Wukaifeng导出包内Product-Agent-Review-20261017.zip，SHA256：cb610240630dcd218f81358a5459bb73bb33514618d46bb40518fa646f7d1726。
- 原报告记录f0584882769bd85a143b3756ff8e1db2845591c6、基线118e295d6f513fc439daaa67870c4f186ac1df69。没有原.git，仅记录来源，不伪造历史。
- 旧LocalFlow/Python/Windows包留作历史，勿覆盖当前源码或合并业务库。

## 当前架构与运行

根目录为Next.js应用；page/components→API→domain/db/service-store，harness/provider组织受控模型调用，Product Pack/Context/discovery提供资料、偏好和有限组合。SQLite业务仍以workspace JSON为主，另有服务记录和反馈表。

Node24；npm ci/build/start:local，默认127.0.0.1:3100；开发dev:local。Windows可用scripts/windows.ps1和本机忽略目录.runtime/node24。真实身份未接入，模型付费默认关闭。数据data/demo.sqlite，测试用独立PRODUCT_AGENT_DATA_DIR，保留迁移备份。

## 文档与验证

完整产品说明、总任务书和主提示已补齐，旧交接所说“任务书缺失/上游未知”是历史状态。旧报告原文保存在docs/archive/import-2026-10-17。

默认测试、类型、基准和构建不产生真实模型费用。集成需独立服务/数据库及现有Edge路径。真实模型还需费用授权和脚本开关；不能把历史截图/离线替身算作本次在线验收。新复验见迁移记录。

遵守对象授权、只读模型工具、故事作者/持有人区分；用户报告不等于客观完成。凭证不入库，不工具读取或展示用户api.txt及秘密副本。

## 后续

按CONTRIBUTING.md从main建分支并PR，更新报告、交接、状态、CHANGELOG。任务书中的视觉、本地9B、Skill循环和多人功能仍是后续工作；用户当前任务优先，不因整理仓库擅自实施整个Backlog。
