# 物间 Product Agent｜给开发同学的交接说明

## 请接收两份资料

1. 用户发送的原始 `Product-Agent-Review-Exports(1).zip`（或者其中 `Product-Agent-Review-20261017.zip`）：作为**唯一最新代码基线**，不是用旧物间2.0重建，也不需要处理别人版本的合并。
2. 本小包：主 Prompt、产品说明书 V1.1、上一轮完整技术审查及深化任务书。

原始审查 ZIP 含 `REVIEW_HANDOFF.md`、`DEVELOPMENT_REPORT.md`、`docs/...V1.1...md`、源码及测试。若使用外层导出包，优先提取里面的 `Product-Agent-Review-20261017.zip`，该内层文件才是精简的完整源码审查包。请核对代码版本，勿覆盖现有其他目录或运行中数据库。

## 阅读顺序

1. `Wujian-Friend-Codex-Master-Prompt.md`（当前任务）
2. 代码包内 `REVIEW_HANDOFF.md` 与 `DEVELOPMENT_REPORT.md`
3. `物品智能服务_完整产品说明书_V1.1_交付版.md`
4. `物间2.0_产品技术全维审查与Codex深化任务书_V1.0.md`
5. 代码包内源码、测试、其他 docs

## 两个报告各自职责

`DEVELOPMENT_REPORT.md`：让产品负责人了解本轮修改了什么、哪些是真实能力、剩余问题。

`REVIEW_HANDOFF.md`：让下一位开发者/审查者了解代码路径、接口、技术约束、测试及复现方法。

当前产品的关键区别：已实现本机业务与部分可信 AI 底座；真正识物、真实模型在线运行、跨设备家庭和通用物品创意尚待验证。请始终保持事实与模拟能力的边界。
