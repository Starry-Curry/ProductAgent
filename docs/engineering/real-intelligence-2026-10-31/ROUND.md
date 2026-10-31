# 真实智能评测新轮次

- 轮次：`real-intelligence-20261031-r1`；用户于2026-10-31明确授权本轮付费。
- 上限：150次真实上游推理请求、估算50元，先到即停。失败、超时、重试计数；未回报用量的请求继续按保守预留计费。
- 基线：`codex/wujian-experience-lifecycle-v1@c31a535b54f1e0e97b484af5910f34e67eb132d7`。本轮在独立工作区和`codex/wujian-real-intelligence-eval-v1`进行；不改原项目、Instructions、私人数据或main。
- 历史150次文件`../product-foundation-evidence/model-calls.json`只校验哈希，不写入：`f24bef4a70c079a01b47074ec374b9d3f72c8a5119693792903507ade41cb369`。
- 新台账：本目录`evidence/model-calls.json`，新网关使用固定轮次和排他锁；不复用旧网关的台账位置。
- 两臂均使用账户`/models`已返回的固定版本`qwen-plus-2025-12-01`，非思考模式。0—128K输入按0.8元/百万Token，输出2元/百万Token估算；更高区间按官方阶梯计价，不扣缓存优惠。价格依据：[百炼官方价格](https://help.aliyun.com/zh/model-studio/model-pricing)。估算不是账单实扣。
- 直接臂接收物间首次上游请求的同一user payload；本地短路无模型输入时，两臂以同一context builder的资料为共同信息池。系统指令和输出契约是待比较对象，不声称完全相同。原始日志保留实际输入、输出、失败和耗时。
- 先8案、再26案，共原有34个唯一live_model场景。首8案的脚本参数失误单列，不算产品失败；已发生的直接请求仍计费，不删除。后续按真实失败定向复测，不用HTTP200或outcome字段替代逐案判断。
- `WUJIAN_EXPERIMENTAL_FACT_QA=true`只在明确标注的评测进程开启，产品默认仍关闭。实验结果与默认产品路径分开报告。
- 所有持有人、偏好、反馈和经验均为明确合成数据；官方资料是真实联网获取。用户报告不是现实设备验证。无硬件操作。

## 来源纠错

旧索引错误把英国站`wf-1000xm4/articles/00297348`路径的7秒记录注册为WH-CH520。失败测试已复现并移除。不能将这一条当作WH-CH520与其他资料的“有效冲突”。历史报告保留为历史，当前修正以本说明为准。

[WH-CH520官方初始化帮助指南](https://helpguide.sony.net/mdr/2958/v1/en/contents/TP1000783325.html)明确要求关机、移除USB线、电源与音量减键约10秒以上，并删除配对信息；型号和动作须一起核对，不能只记秒数。

JBL商品页受限制，改用真实取得的官方快速指南PDF；该PDF不包含完整商品宣传资料，不据此否定Auracast或续航增强。DJI规格/FAQ页面当前仅返回31字符空壳，即使HTTP200也标为正文不足；不冒充获取成功。Philips支持页跨站跳转未取得正文，保持资料阻断。
