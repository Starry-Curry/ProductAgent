# 物间整体升级｜Codex 实施交接包 2026-10-30

## 最短使用路径

1. 阅读《物间_Codex_整体升级一次性执行任务书_V1.0_20261030.md》，将整包解压到 Codex 当前可访问的独立工作目录（不是生产数据目录）。
2. 在 Codex 对话中粘贴该任务书正文，或明确要求先读取任务书及同目录全部依赖文件。
3. 先执行：`python wujian_acceptance_preflight.py --suite wujian_realworld_acceptance_v1.jsonl --fixtures wujian_real_product_fixtures_v1.json`。
4. 以 `codex/wujian-product-foundation-v1@d8eee9306e8eb53975e80eb98d3b1ace812777b7` 为**检查基线**，启动前核实是否有更新；新建隔离分支/工作区，不覆盖原环境。
5. 同一轮允许持续完成 G0-G5，但须可恢复提交、复跑旧回归、保留失败证据。未经授权不调用新的付费模型、不部署、不真实控制硬件、不合并 main、不修改私人数据库。

## 文档阅读优先级

权威产品定稿（理念及功能边界） > V1.2 代码差距和迁移要求 > V1.1 接口设计 > RFC V1.0 背景 > 门禁和85案测试。

导航数量待真实受试者测试；当前 HTML 仅测试可达性，不是最终视觉设计。

## 测试集口径

- 9个真实厂商商品型号，15个厂家来源URL，85个用例；物品持有者、家庭与故事全是模拟。
- 34个 live_model 案例需要真实模型输出及内容审阅；23 browser、16 integration、9 prototype、3 software_lab 必须使用相应验证方式。
- 此包的预检工具**只验证文件结构与结果记录完整性**，不访问互联网、不调用模型、不运行应用、不判定答案正确。
- `wujian_acceptance_results_template_v1.jsonl` 初始85项全部 `not_run`；严禁把文件结构检验通过写成验收通过。

## 仍须单独批准的事项

新付费模型调用预算、真实设备控制/非模拟逆向授权、真实外部通知与对外公开部署、不可逆数据迁移、向main合并。
