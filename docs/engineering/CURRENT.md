# 当前研发：Qwen-first 统一智能底座（2026-11-02）

独立分支 `codex/wujian-qwen-foundation-v1`，基线c18b26d。Gate0/1离线检查通过，Gate2–4尚未验收；新授权150次/80元，先12次/8元路线证伪，独立新台账，不能将上一轮预算复用。

- [当前实施、调用链、恢复与限制](qwen-foundation-2026-11-02/STATUS.md)
- [冻结独立验收说明](qwen-foundation-2026-11-02/acceptance/README.md)

---

# 上一轮历史：Qwen-first 产品结果闭环（2026-11-02）

独立分支 `codex/wujian-outcome-qwen-v3`，基线 f0e3114。**BLOCKED_AUTHORIZATION：250次已用完；产品NOT_ACCEPTED，G1/G2/G3等仍失败。** 下方为上一轮历史，不代表本轮发布。

- [本轮结果与运行方式](outcome-qwen-2026-11-02/DELIVERY.md)、[逐门槛质量复核](outcome-qwen-2026-11-02/QUALITY_REVIEW.md)、[实际测试及失败](outcome-qwen-2026-11-02/TEST_REPORT.md)。本轮不标“产品全面完成”。

- [冻结结果契约](outcome-qwen-2026-11-02/OUTCOME_CONTRACT.md)
- [技术取舍与实际失败](outcome-qwen-2026-11-02/DECISIONS.md)
- [可恢复清理](outcome-qwen-2026-11-02/CLEANUP.md)
- 本轮费用授权：新轮次250次/100元；历史台账不变，逐请求原始记录在该目录evidence/model-calls.json。模拟持有人、用户报告与实体测试严格区分。

---

# 上一轮历史状态（2026-11-01）

产品权威：[产品共识 V1](../product/PRODUCT_FINAL_V1.md)。工程规则：[AGENTS.md](../../AGENTS.md)。

当前交付分支`codex/wujian-integrated-agent-v1`，基线`84f601b8b68bc52471a96cc6c6f6475531e816d6`；沿用已有隔离工作区，原项目未改。**可运行工程交付，质量部分达标，不是产品全面通过。**

- 最新：[集成交付及体验](integrated-agent-2026-11-01/DELIVERY.md)、[测试](integrated-agent-2026-11-01/TEST_REPORT.md)、[质量复核](integrated-agent-2026-11-01/QUALITY_REVIEW.md)。R8操作、获准经验影响行动、领域写入/Task连续性、家庭赠礼和REA软件边界已实际验证；Sony自主获取与开放新组合仍未全面达标。
- 历史：[Practical追加轮次](practical-continuation-2026-11-01/ADDITIONAL.md)。原始失败、费用与恢复点保留，不重复四份顶层摘要全文。
- 历史 `docs/PRODUCT.md`、`docs/ARCHITECTURE.md`、V2 RFC、V3 实验是历史描述/候选，不覆盖产品定稿和最新运行事实。历史原文、失败与台账保留。
- 真实设备未操作；模拟、用户报告、实际模型、离线替身分别标记。新授权轮次150次/50元，交付快照58次/估算18.156276元（含未知预留）；旧60+20次哈希不变，全部台账保留。
