# 独立验收执行准备（2026-11-03任务顺序更新）

状态：`prepared_not_run`。本准备只运行语法/冻结哈希核验，无真实模型请求、App启动或账号操作。18题、6准确型号、15/18首答门槛与4条旅程未变。

最新主任务允许在核心候选稳定后先做独立验收，再跑4条旅程。故脚本不再要求旧研究 Gate2/3 全部先完成，而要求明确的**候选验收释放记录**。释放不是宣布产品通过：来源、工具矩阵、浏览器旅程、删除回归和质量门槛仍需分别记录，未跑就是 `not_run`。

## 启动前

主线程先提交候选业务源码，完成对应生产构建，并写本轮 `evidence/gate4-release.json`（这只是建议形状，**本准备没有创建释放文件**）：

```json
{
  "released": true,
  "roundId": "qwen-foundation-20261102-r1",
  "purpose": "independent_core_candidate_acceptance",
  "candidateCommit": "实际已提交且src干净的完整SHA",
  "questionsSha256": "7991b81d681bbb3e1a38ca4ade30de002fa61b0921a67f619b8aeaa60373d6f8",
  "model": "qwen3.8-max-0902",
  "maxRequests": 64,
  "candidateEvidence": ["实际存在的离线输入/权限核验记录", "实际构建记录"],
  "priorGatesStatus": {"coreCandidate":"ready_for_independent_test", "browserJourneys":"not_run"}
}
```

`candidateEvidence` 限本轮 evidence 内已有文件，不能引用不存在的记录或把准备文档当产品测试。`candidateCommit` 必须等于执行时 HEAD，业务 `src` 不得未提交。沿用本轮 150次/¥80 总账；历史不重置。准备时已用74次，剩76，验收独立批次**最多64次转发**，给其余旅程留空间；执行时重新读取余额，取更小值，先到请求/金额上限即停。每次失败、重试、搜索/解析都经过同一总账；禁止并发另一付费任务。

## 命令

先激活项目 Node24，然后可零费用检查：

```powershell
node --check scripts/foundation/acceptance-run.mjs
node scripts/foundation/acceptance-run.mjs --max-requests=64
```

主线程释放后，确认3248空闲、对应构建存在，且没有其他网关持有本轮锁，再真实执行：

```powershell
node scripts/foundation/acceptance-run.mjs --execute --run-id=foundation-independent-r1 --max-requests=64 --port=3248 --build-dir=.next-foundation
```

若主线程明确复用仍在运行的同轮受控本地网关，额外传 `--gateway-url=http://127.0.0.1:实际端口`；不能猜端口、复制Key或并行另开台账。默认会通过既有安全 helper 获取认证，脚本自身只使用假凭证。每次执行创建全新隔离数据目录和独立测试账号，Cookie/口令只在内存，不写Git。

顺序：18个产品首答 → 余额允许时18个直接同模型对照。理想最低36次，检索/图文/语义工具可能增加；64不是保证足够18+18，超额时余题/对照明确阻断，不能报通过。每题先建START，最终文件用 `wx`，禁止覆盖。全局 `acceptance-runs/FIRST_RUN.json` 固定首次队列；修复复测必须 `--cohort=retest` 和新run-id，写RETEST而不是把二次纠正伪装成首答。

18题使用真实认证 App HTTP/SSE：经过正式API、服务端和模型网关，但**不是浏览器UI验收**。4条浏览器旅程需另行执行并补真实画面/权限/连续性证据。直接对照取产品最终工具回合实际提供的user/tool资料，去掉系统策略与助手草稿，保存原请求号和资料SHA；仅等同有效供料，不冒充直接模型另行自主发现成功。

生成独立评分模板（不调Qwen，不自动授予通过）：

```powershell
node scripts/foundation/acceptance-review-template.mjs --output=docs/engineering/qwen-foundation-2026-11-02/evidence/acceptance-runs/foundation-independent-r1/REVIEW_TEMPLATE.json
```

由独立评审按冻结答案/原文逐点核对，并填写原输出片段、来源定位、错误适用范围/安全/权限、检索失败与推理失败。不得仅凭模型自评、HTTP成功或工具名称宣布15/18及4/4通过；外部真人盲测仍独立标未进行。
