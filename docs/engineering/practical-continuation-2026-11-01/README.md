# Practical Agent 续作（2026-11-01）

基线：`codex/wujian-practical-agent-v1@042eae3ccea79351dabb736fad8e2ee21d05c6a0`。继续同一隔离工作区，没有切换框架、迁移私人数据库或控制硬件。所有持有、状态和经历均为明确标注的合成测试数据。

## 切片一：陌生商品自主资料发现

**尚未完成真实验收。** 真实浏览器录入此前未预置链接的 Sony SRS-XB100 后，官方通用支持地址不可读；百炼搜索返回 HTTP 400。模型拒绝编造操作，用户仍不能获得指导。原始输入、输出、截图及 6 次上游请求保存在 `evidence/discovery-v1.json`，不是成功案例。

已修改：失效种子不阻断后续发现；同 URL 不重复读取；实际官方域名、完整型号和地区仍需核对；保留说明书图片替代文字，缺失图示明确警告；允许沿已取得手册中的实际章节链接继续读取。原执行器会因“手机”泛词误选手机云台，现对原生路径限制为当前物品、任务物品、完整名称/型号或工具明确选择的物品。型号目录仍可供模型自主选择。

搜索失败定位：[百炼官方文档](https://help.aliyun.com/en/model-studio/web-search)明确 Qwen3.8 原生搜索要求 `multimodal-generation` 端点及 SSE，原实现使用 `text-generation`。已修正协议及分块来源解析；**新协议目前只有离线验证，尚不能宣称真实搜索成功**。搜索结果只用于发现 URL，必须继续读取官方原文；模型摘要不认证事实。公开 Bing RSS/HTML有限探测返回泛化无关结果，Google读取失败；没有接入这些不可靠结果，也未绕过访问限制。

## 费用与恢复点

延续授权轮次 `practical-agent-20261031-r1`，上限 60 次 / 15 元；开始时49次，当前55次。包括失败在内本次新增6次；失败搜索保守费用预留计入总额，历史49条哈希不变。详见 `evidence/start.json`、`evidence/discovery-v1.json` 以及上一轮目录中的追加式 `model-calls.json`。新额度申请尚未收到答复，不默认扩充。

浏览器脚本：`node scripts/practical/continuation-discovery-browser.mjs --stage=<新的唯一名称>`。付费预览仅在有效额度下使用 `node scripts/practical/preview.mjs --authorized-60-cny15 --enable-official-search --record-synthetic-evidence`；仅合成数据测试允许记录内容，普通预览默认不保存聊天原文。预览绑定本机3232、30分钟自动关闭，重启不清零台账。环境变量、启动隔离数据目录及安全读取既有密钥方式沿用原报告；不提交环境文件、身份Cookie或数据库。

## 验证边界

`slice1-offline-protocol.txt`：13项通过，模型/搜索为替身，只证明协议、权限和错误恢复。`slice1-build-protocol.txt`为生产构建。真实失败记录保持原样。跨物品数值来源约束与跨功能经验闭环继续推进，其真实结果将在本目录补充；不能从离线通过推断产品质量已达标。
