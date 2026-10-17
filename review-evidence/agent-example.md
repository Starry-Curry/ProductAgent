# Agent 执行材料说明

所有输入都为审查用虚构案例，没有真实模型请求或实际设备信号。

## 成功路径（测试替身）

- 复现：npm run test:benchmark；源码 scripts/benchmark.ts。
- 输入：演示 actor=lin、itemId=lamp、question=电池是什么、mode=service。测试刻意把 fixture 的 lamp 绑定 M185 资料，不能作为实物识别/确认的证据。
- 检索：logitech-m185-m-r0061 的版本化 Product Pack；来源链接、完整 claims 和限制见 agent-success-synthetic.json 的 evidenceSnapshot。
- 步骤：resolve_item → lookup_product_pack → text_assist（offline-test-double）→ validate_answer。
- 输出：资料第一条事实原文及对应 evidenceId，见 validatedAnswer。阶段、哈希和耗时在 trace 内。
- 验证：严格原文支持检查通过，不证明实物状态、回答对所有场景适用或千问实际可用。
- 成本/token：null；真实模型调用为 0。不是模型自主工具选择，也没有业务写工具。

## 失败路径（实际本机 API，未请求模型）

agent-failure-example.json：测试赠礼认领后绑定被清除，以收礼人请求；422 needs_identity。必须再次确认型号，不能沿用旧授权绑定。

agent-unconfigured-example.json：新建虚构 M185 档案并人工绑定资料；问题“电池规格是什么？”；503 not_configured。包含检索来源、工具/阶段、失败码及只读 replay；没有模型输出，不制造答案。

复现缺配置示例可运行 review-tools/error-example.mjs。它会写虚构物品，必须先启动独立空测试数据服务并禁用模型，不得指向业务库。

## 错误断言基准

benchmark.json 的七例展示原 ID-only 规则与新策略：五条错误断言全拦截，正确改写有一条被误拒。输入/预期/实际均保留；它是小规模合成回归，不能代替独立准确率评测。

## 回放边界

成功只重新验证已留存的公共事实；失败只重放阶段。私人问题/失败原文默认不落库，本包问题正文是辅助脚本中的人工测试输入，不是从用户日志恢复。模型内部推理不可复现。
