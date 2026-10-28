# ProductAgent development instructions

- This repository is the canonical Next.js application imported from the 2026-10-17 Wukaifeng delivery. Read README.md, IMPLEMENTATION_STATUS.md, REVIEW_HANDOFF.md and docs/README.md when present.
- Product specifications and old task prompts contain future goals. Confirm current behavior in code; the user's current task and authorization take precedence.
- Do not replace this app with older LocalFlow/Python/Windows distributions or merge their databases.
- Use Node.js 24 and package-lock.json. Never rewrite shared history without explicit authorization.
- Keep credentials, .env.local, api.txt, private material, databases, models, dependencies and build caches out of Git.
- Do not read or print the user's api.txt or secret copies. Applications may use local secrets for authentication, never as prompt/report content.
- Paid model calls require authorization for the current task. AI_ALLOW_PAID_CALLS defaults false; CI stays offline. Enforce per-task request and cost caps, including timeouts and retries.
- Integration/migration tests use a separate PRODUCT_AGENT_DATA_DIR and preserve migration backups.
- Relevant checks: npm test, npm run typecheck, npm run test:benchmark, npm run build, and affected integration/browser journeys. Locate failures and run necessary rechecks; report unavailable checks honestly.
- Keep model writes behind domain authorization and transactions. Demo actors are not real authentication.
- Distinguish mocks, deterministic rules, provider output, user reports and real-world verification. Valid citation IDs are not semantic proof.
- Update DEVELOPMENT_REPORT.md, REVIEW_HANDOFF.md, IMPLEMENTATION_STATUS.md and CHANGELOG.md for substantive changes. Preserve historical reports as dated evidence.

## 持续协作与Git授权（用户于2026-10-29确认）

- 常规开发从最新origin/main创建独立功能分支（默认codex/前缀）和隔离工作区。保护原项目、其他任务、私人数据及未提交工作，不把其他开发分支默认为业务基准。
- 自动完成相关检查、测试、失败定位与必要复验。通过后自动commit并push至独立功能分支，无须逐次询问；这项授权不覆盖系统/沙箱权限限制。
- 不直接合并main，不强推，不修改全局Git设置，不泄露秘密，不操作真实硬件或私人数据。发布前扫描拟推送文件，保留正常的合成测试证据。
- Git身份优先使用已核实的用户GitHub login及ID对应的noreply隐私邮箱，仅配置当前仓库；认证不一致或无法核实则报告，不冒用身份。
- 在分支中持续维护中文变更记录、实施状态、测试报告和技术决策；写明模型/替身/设备验证的区别、失败、限制与尚未验证的假设。
- 普通实现细节自行决定。涉及产品定位改变、整体Agent框架替换、破坏性数据迁移或危险设备操作，先给具体方案，不擅自实施。
- 向产品负责人用直白中文说明改动理由、实际改善和剩余问题，提供GitHub分支/文件链接，避免要求手动搬运报告。
- 物间旨在理解、利用、组合和重新创造用户已有物品的价值；库存与工具是手段，不为接工具而堆功能。
