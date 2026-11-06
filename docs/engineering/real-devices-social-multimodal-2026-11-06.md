# 真实电器、好友、待办日期与多模态问答（2026-11-06）

## 交付范围与运行

默认 App 为 http://127.0.0.1:3210/ ，使用独立 data-companion-v1。启动 `node scripts/companion-start.mjs start --cloud`，Node.js 24。启动器仅监听本机；`--cloud` 启用真实文本、视觉和可用的检索接口，会产生模型服务商费用。密钥从本机 .env.local 读取；本报告、截图和验证 JSON 不包含凭据。原 3203 服务和 data-life-v1 不作迁移。

本轮是前一版物伴 App 的增量：保留浅雾蓝与暖白、阿圆、家庭/私人物品分区及大字关怀版。没有将好友互动、购买入口或售后入口假装成真实支付、外部消息或已经转接客服。

## 真实型号与资料

按用户要求，为当前演示库存中九类电器/电子设备指定明确的参考商品。它是演示档案的选型，不表示 AI 已确认用户现实设备就是这个型号。照片取自品牌官方站点，保存本地 WebP；不再用生成图冒充这些具体商品。商品图版权仍归原权利人，本轮未取得额外商业授权。来源与文件哈希见 public/products/real-v1/SOURCES.json。

| 物品 | 具体型号 | 地区 / 变体 | 官方来源 |
| --- | --- | --- | --- |
| 米家 LED 智慧台灯 1S | 小米 MJTD01SYL | 台湾版 · 白色 | [产品](https://www.mi.com/tw/mi-led-desk-lamp-1s/) · [说明书](https://user-guide2024.cnbj1.mi-fds.com/user-guide2024/Taiwan/N/Mi%20Smart%20LED%20Desk%20Lamp%201S%20User%20Manual.pdf) |
| 飞利浦 RO 净饮机 | 飞利浦 ADD6910 | ADD6910/90 · 香港版 | [产品](https://www.philips.com.hk/en/c-p/ADD6910_90/ro-water-dispenser) · [说明书](https://www.documents.philips.com/assets/20221003/bd20017ac37440a48eb4af23012764c5.pdf) |
| 小米 Electric Kettle 2 电热水壶 | 小米 MJDSH04YM | UK/EU 220–240V · 白色 | [产品](https://www.mi.com/uk/product/xiaomi-electric-kettle-2/) · [说明书](https://cdn.alsgp0.fds.api.mi-img.com/cwdq/2025/Xiaomi%20Electric%20Kettle%202/EU/Xiaomi%20Electric%20Kettle%202.pdf) |
| 小米 Smart Air Purifier 4 Lite 空气净化器 | 小米 AC-M17-SC | 国际版 · 白色 | [产品](https://www.mi.com/global/product/xiaomi-smart-air-purifier-4-lite/) · [说明书](https://cdn.azams0.fds.api.mi-img.com/xiaomi-b2c-i18n-upload/User-Guide-Upload-mi.com/Air_Purifier/35053-Xiaomi-Smart-Air-Purifier4-UserGuide-EU.pdf) |
| 小米 Smart Air Fryer 6.5L 空气炸锅 | 小米 MAF10 | UK/GB 版 · 白色 | [产品](https://www.mi.com/uk/product/xiaomi-smart-air-fryer-6-5-liter/) · [说明书](https://cdn.azams0.fds.api.mi-img.com/xiaomi-b2c-i18n-upload/EU-ERP-Userguide-upload/Kitchen-and-bathroom-appliances/47711-Xiaomi-Smart-Air-Fryer-6.5L-Black&White-UserGuide-GB.pdf) |
| 小米 Vacuum Cleaner G20 Lite 无线吸尘器 | 小米 C203 | UK 版 · 白色 | [产品](https://www.mi.com/uk/product/xiaomi-vacuum-cleaner-g20-lite/) · [说明书](https://xiaomi-b2c-i18n-upload.azams0.mi-fds.com/xiaomi-b2c-i18n-upload/EU-ERP-Userguide-upload/Vacuum-Cleaner/55018-Xiaomi-Vacuum-Cleaner-G20-Lite-UserGuide-UK.pdf) |
| 罗技 M185 无线鼠标 | 罗技 M-R0061 | M185 · M-R0061 硬件版 · 灰色 | [产品](https://www.logitech.com/en-us/products/mice/m185-wireless-mouse.html) · [说明书](https://www.logitech.com/assets/42356/5/m185-quick-start-guide.pdf) |
| JBL GO 4 便携蓝牙音箱 | JBL GO 4 | 国际版 · 白色 | [产品](https://www.jbl.com/GO-4.html) · [说明书](https://global.jbl.com/on/demandware.static/-/Sites-masterCatalog_Harman/default/dw4e5b74f6/pdfs/PA_JBL_GO%204_QSG_Global_SOP.pdf) |
| 索尼 Cyber-shot 数码相机 | 索尼 DSC-WX350 | DSC-WX350 · 黑/白/粉官方产品展示 | [产品](https://www.sony.jp/cyber-shot/products/DSC-WX350/) · [说明书](https://helpguide.sony.net/gbmig/45298511/v1/en/print.pdf) |

说明书在本轮从官方 URL 获取，提取为 resources/product-manuals-v1 的可检索文本，保留 PDF SHA256、页码和来源。扫描页和关键图示另经查看，录入明确标识的中文转述，不将其冒充逐字引用。M185 快速指南是系列级文档，M-R0061 的适用关系来自已有核验资料，不能据此推断任意接收器兼容性。

服务端核对品牌、型号、地区、内容哈希和参考 ID 后才使用对应缓存；人工修改型号会解除旧绑定。已保存的参考型号直接进入问答，不再重复要求输入同一个型号。补全其他未知设备仍可能需要照片或额外信息。

安装器仅升级已知合成演示记录，幂等执行；不会批量覆盖用户上传照片。两个原来没有型号的现有“烧水壶”“音响”经本次用户选型授权，通过 updateItem 显式绑定。迁移前已用 SQLite VACUUM INTO 创建本机备份。

**检索边界**：本轮已真实获取以上官方资料，优先读取核验缓存。原生联网检索测试虽返回 HTTP 200，却没有结构化来源，因此不把“任意商品随时联网找到说明书”列为已验收能力。保留安全地址校验，不绕过保留地址/内网限制。

## 问答连续性与演示回答

- 模型输入使用短引用别名，返回后恢复真实证据 ID，再校验。
- 正式资料回答、官方中文转述、模型通用建议和本地演示建议分开标识。
- 对少数审核过的日常流程，模型引用校验失败时可返回带页码的中文转述步骤；仅覆盖录入过的主题，不随意扩展到故障或危险拆修。
- 用户已明确完成的步骤会从继续指导中排除；模型纠正失败不会重新交付此前被拒绝的回答。
- 按用户“演示优先、有回答”要求，物伴启动器启用 WUJIAN_DEMO_ANSWERS。模型超时/资料不足时仍提供可继续的步骤，显示“演示建议”，不伪造说明书引用或已执行操作。异常设备以暂停操作、记录和售后作为可用回答。

## 多模态引导

首页「看图一步一步」及问答步骤中的「看图跟着做」打开同一个引导窗口：

1. **看图跟着做**：每次一条步骤、一张图片和红色箭头/圈选；上一/下一步、朗读、上传面板近照和手动调整位置均可操作。实拍图由 qwen3-vl-plus 输出归一化位置，标为视觉模型定位；未看清目标时使用明确标识的布局示意，不声称来自该型号真实面板。通用洗衣示例是五步示意，不冒充已保存设备的专属说明书。
2. **实时识别**：用户主动开启摄像头，再主动启动分析；约每 5 秒发送一帧，最多 12 次后暂停，可继续或手动识别一帧。返回目标叠加到当前画面；切换步骤排除过期结果，切换标签、关闭窗口或隐藏页面停止识别/摄像头。物间不把帧写入数据库；帧会发送到配置的视觉模型服务商。页面提供明确标记的示例画面，便于无摄像头现场演示。它是定时视觉识别，不是逐帧跟踪的 AR。
3. **演示视频**：浏览器 Canvas + MediaRecorder 将实际步骤、已定位照片或明确标记的示意图、红色箭头和字幕合成视频，可直接播放/下载；不是厂商实录，也不是调用生成视频模型。浏览器不支持编码时给出换用 Chrome/Edge 的可操作提示。视频不包含配音；当前步骤另有朗读按钮。

真实视觉 API 已识别示例面板电源位置，约 3.3 秒返回；浏览器合成视频解码成功，960×720、约 12.48 秒，已下载本机验收。实际物理摄像头权限与不同设备的手持跟踪未在本轮硬件实测，不以示例代替硬件验收。

## 好友与日期

「朋友」顶部新增“我的好友”头像列表、自己的好友编号和“加好友”。输入编号搜索，发送请求；接收者接受/拒绝，发送者可撤回。只接受后进入好友列表，刷新后保留。演示编号 WJ-LIN、WJ-YU、WJ-DAD。它们是同一本机中的演示成员，不是真实账号注册、跨设备邀请或已发出外部通知。

待办新增可选 YYYY-MM-DD 日期；创建时可选日期，卡片可改日期或清空，显示今天/明天/日期/逾期。按上海时区的日历日期判断，不把日期偷换成 UTC。仅创建者/负责人可修改；大字版直接看到重要事项与日期。知晓提醒不代表任务完成或设备修复。日期只是任务字段，不等于已接入系统定时推送。

## 验证与保留问题

- 223/223 离线测试通过；覆盖型号绑定失效、资源哈希与权限、好友请求/接受权限、日期有效性与幂等、演示答案和视觉提示转发。
- 现有 benchmark 0 新增回归，0 真实模型请求。
- 生产构建与 TypeScript 检查通过；生产进程使用新构建重启。
- 隔离 QA 数据验证九类型号、15 条物品对应图像/资料可读，好友搜索→申请→接受→刷新，日期创建/修改/负责人读取。浏览器另验证好友双身份流程与日期编辑持久化。
- 官方资料真实模型用例先有失败，修复引用别名与中文转述后定向复测；保留初次失败记录，不把全部结果描述为模型完全理解了任意说明书。
- 未绑定型号的洗衣指导 API 复测约 3.7 秒返回五步演示答案，不反复要求型号；标记为本地演示建议。
- 多模态浏览器验收和生产烟测结果见 [脱敏验证记录](real-devices-social-multimodal-validation-2026-11-06.json)；图片与视频保存在忽略的 artifacts/companion-app。最终 1280×720 布局可同时看到步骤标题、图与翻步按钮。
- 未接入真实多用户认证、云同步、支付、客服会话、系统推送或系统级浮窗。摄像头需要设备、浏览器权限及安全上下文；远程手机访问通常需要 HTTPS。本机演示不是公网发布。
