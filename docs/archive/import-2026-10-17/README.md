# 物间 2.0 深化开发：第一批交付

本目录直接基于用户提供的 Windows 分发包源码修改，保留同学的页面、长辈模式、活动准备、家庭事项与售后入口，不是另起前端。

## 启动

```powershell
cd 'D:\D盘桌面\Product-Agent\imports\wujian-2.0-20261017\Wujian-Windows-Demo\app'
npm.cmd ci
npm.cmd run build
npm.cmd run start:local
```

打开 http://127.0.0.1:3100 。Node.js 24。默认数据在本目录 data，与原版 Product-Agent/data 隔离。`dev:local` 用于开发；不要同时构建同一个 .next。

`start:local` 明确设置 AUTH_MODE=local-demo，服务器只监听 127.0.0.1。普通 start/dev 不自动启用演示身份；真实账号认证尚未实现。不要使用上层旧 START.cmd 运行修改版，它仍是原分发启动器。此版本不支持公开部署。

## 已实现与验证边界

- 恢复领域测试；独立 Git 基线 118e295；源码来源记录见 docs/engineering/baseline-provenance.json。
- 引用 ID 不再足够：回答只能逐条等于版本化资料事实原文。自由改写、额外结论、危险步骤和 uncertainty 文本不能绕过校验。
- 这是一项保守的提取式策略，不是通用语义蕴含验证。会误拒正确改写，暂不生成任意操作步骤。资料本身也仍需人工核对。
- Harness 分阶段持久化，记录证据快照、tokens、耗时与失败。成功事实可以重新校验，失败记录可回放阶段；没有保存私人问题和原始失败回答，不能宣称复现了模型内部推理。
- 缺少型号、缺少配置、超时、限流或输出无效均显式失败；不使用预设答案冒充 AI。
- 三类实际商品的官方资料：Logitech M185（两个版本）、JBL Go 4、IKEA RÅSKOG 指定货号。尚无三件实物操作验证。
- 新录入并确认型号的物品可以触发有依据的规则组合；检查室内/室外、载荷、数量与共享权限。规则候选非真实 AI 创意，未经实物验证。
- 私人 Context 区分 explicit / inferred / unknown，当前只主动设置 explicit/unknown。用户逐项允许后才可向模型提供本人偏好，默认不发送。
- 礼物故事分离 author 与 owner，传递原作者/原记录来源，接收者后续记忆仍独立。旧来源不可确定时标记未知，不猜测。
- 增量迁移前 VACUUM INTO 备份，包含已提交 WAL；原版数据不导入、不重置。服务运行和反馈已有关系表，业务主体仍为 JSON 工作区。

## 自动验证

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:benchmark
node scripts/verify-baseline.mjs
```

离线 benchmark 输出 artifacts/benchmark.json 与 artifacts/trace.json；测试替身不是实际千问调用。用量未知时 cost 为 null，不伪造人民币成本。浏览器集成测试必须使用独立 PRODUCT_AGENT_DATA_DIR。

## 真实千问验收（尚未运行）

先得到用户对三次可能计费请求的明确确认，再根据实际开通地域/工作空间在本地 .env.local 配置 AI_BASE_URL、AI_API_KEY、AI_MODEL。不要把密钥发到聊天或提交 Git。

官方接口配置参考：[阿里云首次调用说明](https://www.alibabacloud.com/help/en/model-studio/first-api-call-to-qwen)。地址随账户地域变化，不将某一地域地址写死。

设置 AI_ALLOW_PAID_CALLS=true 和 LIVE_SMOKE_APPROVED=3-public-cases 后，执行：

```powershell
node --experimental-strip-types scripts/live-smoke.ts
```

最多顺序请求三次，每次 max_tokens=1500，不自动重试，仅发送公开商品事实与测试问题，不读取家庭业务数据库。输出 artifacts/live-smoke.json。只有三次真实返回且校验通过后，才可声称该验收通过；真实费用按账户账单核对。

## 需要继续完成

总任务书指定路径未找到，待用户提供；上游源仓库/原分支未知。真实付费 API 需授权与本地配置。拍照/OCR/条码识别、真人创意案例、实物可行性测试、账号与跨设备、影音分享、完整赠礼状态机、维护推迟关闭、通知事件和全关系迁移尚未完成。完整任务不能以本批代码提交视为完成。

详见 docs/engineering/第一批深化_契约验收与回滚.md。
