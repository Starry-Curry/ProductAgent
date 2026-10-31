# 新型号与资料适用性

本轮额外选择七个此前未预置的型号，录音笔、打印机、键盘、推车、机械拼搭、空气净化器和搁板插件。持有人及生活场景全部合成。正文经应用的安全公开网络读取器实际获取；不冒充实物验证，不复制完整说明书入Git。

| 型号 | 官方来源 | 当前应用读取情况/适用范围 |
|---|---|---|
| Sony ICD-PX470 | [帮助指南规格](https://helpguide.sony.net/icd/p47/v1/en2/contents/TP0001155309.html)、[连接电脑](https://helpguide.sony.net/icd/p47/v1/en2/contents/TP0001155225.html) | 两个正文成功；索尼美国规格入口被限制。规格含2节AAA，不能仅凭USB接口推充电。 |
| Canon SELPHY CP1500 | [装纸章节](https://cam.start.canon/en/P001/manual/html/UG-01_Preparations_0030.html) | 英文具体操作正文成功；美国产品支持入口受限。18张、光面方向与内外盖必须同时保留。此章不证明供电/保修政策。 |
| Logitech K380 | [香港英文入门](https://support.logi.com/hc/en-hk/articles/360024158554-Getting-started-K380-Multi-Device-Bluetooth-Keyboard)、[规格](https://support.logi.com/hc/en-hk/articles/360023464473-K380-Technical-Specifications) | 两个正文成功，有大量通用站点导航噪声；不是K380s。 |
| IKEA RÅSKOG 405.821.81 | [英国黑色推车](https://www.ikea.com/gb/en/p/raskog-trolley-black-40582181/) | 正文成功；35×45×77cm是外形尺寸，不能替代托盘净空间与稳定性。不是旧203.829.32或小号805.867.90。 |
| LEGO 42179 | [商品](https://www.lego.com/en-us/product/planet-earth-and-moon-in-orbit-42179)、[官方目录PDF](https://www.lego.com/cdn/cs/set/assets/blt40a94cbfd3d42e57/LEGO_CAEN_SpringCatalog2024_Cropped.pdf) | 应用商品页访问受限、PDF超时；网页检索能读取不等于这些正文已进应用上下文。留出相关题保留来源阻断，不补假fixture。目录不是操作说明书。 |
| Xiaomi AC-M16-SC | [香港规格](https://www.mi.com/hk/product/xiaomi-smart-air-purifier-4/specs/) | 正文成功但仅187字符，能回答尺寸、净重、面积等；不能据此补清洗、地区平台或售后。 |
| IKEA VARIERA 405.429.58 | [英国白色搁板插件](https://www.ikea.com/gb/en/p/variera-shelf-insert-white-40542958/) | 正文成功；45.5×14×16cm，不是相似旧SKU。 |

取回时间、最终URL、字符数、哈希和错误分别保存在 `evidence/new-product-fetch.json`、`supplement-fetch.json`、`additional-source-fetch.json`。历史九型号采用上一轮公开正文缓存，明确标记缓存，并非本轮实时抓取。

## 标准答案与评分规则

开发集12题的期待依据列在 `evidence/development-cases.json`。冻结留出集30题和SHA256保持不改；未按其运行结果逐题调整规则。某题实际未取得所需正文，其内容评分必须标 `blocked_source`，不能把保守未知计为正确完成。

事实覆盖按用户真正询问的关键子问题计数。数值/原文锚定、模型语义核对、工程审阅、独立真人盲评及真实物理试验是不同验证层次。后两项未开展，不能由模型自评分替代。

费用按[百炼价格页](https://help.aliyun.com/zh/model-studio/model-pricing)本轮核对的 `qwen-plus-2025-12-01` 非思考全球档：≤128K输入0.8元/百万、输出2元/百万；较高阶梯沿用页面价格。失败usage未知保守预留，不是实际账单。
