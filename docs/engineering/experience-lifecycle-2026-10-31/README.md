# 长期经验与跨模块闭环：交付入口

基线：`codex/wujian-unified-foundation-v2@7d682465eb91d4ead6a282852921a8d88b6fabc4`（2026-10-31核对远端）。开发分支：[codex/wujian-experience-lifecycle-v1](https://github.com/Starry-Curry/ProductAgent/tree/codex/wujian-experience-lifecycle-v1)，隔离目录 `D:/ProductAgent-LifeContext/.runtime/experience-lifecycle-v1`。未修改Instructions、main、原始未提交内容、私人数据库或真实硬件。

**可运行，长期经验缺陷已修复；真实模型智能增量尚未验收。** 产品理念严格沿用 [PRODUCT_FINAL_V1](../../product/PRODUCT_FINAL_V1.md)，不改变兑现、创造、延续、传递四种价值。本轮没有新的生产框架或视觉重构。

阅读：[实际改善与架构](DELIVERY_REPORT.md)、[命令、四条旅程及失败](TEST_EVIDENCE.md)、[风险与模型授权建议](REMAINING_GAPS.md)、[先失败再修复](STAGE_P0.md)、[跨模块接入依据](STAGE_INTEGRATION.md)。

## 体验

本机最终服务：<http://127.0.0.1:3224/>，独立本机账号、合成数据、模型关闭。旧3222未动。进入“继续我的事”，选择相关物品并保留进度；记录真实尝试结果，明确选择是否以后复用、是否允许云端使用。完成另一件物品的任务后，再开始原物品的任务，可展开“本次可参考的经验”。原经验可纠正、停止复用或忘记。

家人先接受邀请、获准访问具体物品，再核对摘要建立求助；家人接手和报告后，原任务显示处理状态。家人报告完成仍待本人核对，不冒充设备验证。赠礼仍需明确选择故事与收礼人确认持有。

所有测试人物、位置、经历及持有均为合成。真实型号和官网不意味着团队拥有或实测这些商品。开放创造的完整真实模型旅程仍阻塞；不要将离线生成替身样本当实际创意质量。

## 本机恢复

Node 24.x + package-lock；不修改全局Node/Git。独立分支检出后：

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund --cache .runtime/npm-cache
$env:AI_ALLOW_PAID_CALLS='false'
$env:WUJIAN_ALLOW_PAID_CALLS='false'
$env:WUJIAN_BUILD_DIR='.next-experience-final'
npm.cmd run build
node scripts/product-foundation/preview.mjs --accounts --port=3224 --data=experience-demo --build=.next-experience-final
```

不要加`--cloud`。不复制旧库、api.txt、.env.local或上传照片。preview强制独立`.runtime/experience-demo`和本机监听。当前预览实际数据名为`experience-final`；以上命令另建干净体验目录，不覆盖它。

可选REA复用既有固定6.8.0工具，仅运行自有JS软件灯。缺失时相应测试应明确skip/不可用，不能写成硬件验证。

恢复点：`40879e0`（经验生命周期）、`3c1f56b`（证据与专业接入）、`e26bb85`（范围化清理与集中工程回归）。V1→V2先保存`*.before-unified-v2.sqlite`，旧workspace不改；仅为当时仍有效的旧Outcome补有效性元数据。失效旧经验不自动复活。要退回旧版，应在新目录使用V2前备份；旧版拒绝直接写V2。真实用户数据迁移尚未执行。
