# 实际测试报告

基线 `1cb97646cb8ea058af86515eb79d03d2b899f7b9`；最新远端 main `ea32c3f4c9e18992ca267b6dd74e26e418c9e95a`，RFC `69eb7c8`仅作设计依据。2026-10-29，Windows、Node24.16.0、锁定依赖、Edge headless；隔离工作区 `D:\ProductAgent-LifeContext\.runtime\alpha-app`。最初 Codex 管理工作区因写入自动审核超时而停止使用，初稿和首18条调用证据保留并转入当前累计台账，没有重置预算。

## 离线与浏览器

| 实际命令                                                                                     | 结果/证据                                                                                          |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm ci --cache D:/ProductAgent-LifeContext/.runtime/finals-audit/.npm --no-audit --no-fund` | 正常锁定依赖；未增加框架或修改全局 Node                                                            |
| `npm test`                                                                                   | 最终289/289：原265+新增24；[最终日志](evidence/logs/offline-delivery.txt)                          |
| `npm run typecheck`                                                                          | 通过，[日志](evidence/logs/typecheck-delivery.txt)                                                 |
| `npm run test:benchmark`                                                                     | 0回归，0真实请求，[日志](evidence/logs/benchmark-final.txt)                                        |
| `npm run build`                                                                              | 生产构建通过，[日志](evidence/logs/build-delivery.txt)                                             |
| `node scripts/verify-local.mjs`                                                              | 6组独立生产服务/API/桌面移动端旅程通过，0真实请求，[日志](evidence/logs/integration-release.txt)   |
| `npm run test:acceptance -- life`                                                            | 录入、资料、图片/PDF格式与390px旅程通过，0真实请求，[日志](evidence/logs/life-browser-release.txt) |
| `npm run test:cloud`                                                                         | 8组访客隔离、恢复、预算及原生工具往返通过；模型为测试替身，[日志](evidence/logs/cloud-release.txt) |
| `node scripts/alpha/sources.mjs`                                                             | 两张官方HTML及组装PDF由现有解析器读取；[哈希/提取证据](evidence/official-sources.json)             |

新增回归覆盖商品型号/版本、来源/未知、合成记录幂等与权限、来源引用覆盖、非法额外资源/个人认识、否定动作、自然记忆原话锚点、候选确认、跨会话、纠正锁定、遗忘不复活、费用提取开关/重放、选择范围丢失、虚构引语、反例否决不回收坏草稿、修复阶段私人库存过滤。替身测试证明契约/行为边界，不证明模型理解或创意质量。

## 真实百炼

在当前目录实际运行 `node --experimental-strip-types scripts/alpha/live.mjs --live-max=100-cny=20 --config=<现有.env.local> --stage=<阶段> --only=<组>`，以及 `live-extended*.mjs` 和 `browser-live.mjs`。每阶段准确参数和结果见对应日志，原始输入输出见 [累计台账](evidence/live-ledger.json)。`--config`只是配置路径，发布中没有凭证内容。

- 同一北京百炼 `qwen-plus`，非思考、温度0.2。72次上游尝试（含失败/重试），60次HTTP返回、12次传输失败。**60次返回不等于60次业务通过。** 共享台账互斥锁已复验；打开第二实例被拒、记录不重置，0额外请求。
- 返回用量：输入138,941、输出44,364 tokens；按输入0.8/输出2元每百万tokens估算约0.199881元，未计算缓存优惠。[官方价格](https://help.aliyun.com/zh/model-studio/qwen-plus)。失败用量未知保守预留9.092990元，预算累计9.292870元，低于20元。不是实际账单。
- 最早9次 `fetch failed` 未取得完整根因，不断言为提供商故障；同凭证在当前隔离目录恢复。后3次为本地30/40秒超时取消，已保留请求与费用预留，取消信号进入网关。单候选生成上限后调至60秒，未自动无限重试。
- 两款商品的模型提取能列出多项规格，但SAMLA一条输出把“未宣称密封”说成“不具密封”，因此不能宣称理解全部正确。正式资料面板展示人工核对事实；实际App型号问答走已核对资料，未算成付费推理成功。
- 自然兴趣/目标与赠画生成候选，确认前不进入长期个性化；获准后另一会话可使用赠画事实。首轮模型编造赠送者留言，已复现并修复事实型回忆路径；最终谁送的、纠正、遗忘走本地当前事实，真实测试不再造引语。[最终记忆输出](evidence/live-memory-final.json)。

## 浏览器结果如何解释

真实模型旅程使用独立生产服务与合成SQLite，假占位凭证经过仅测试子进程的网络转接进入唯一付费网关；真正凭证只在网关中。不是把替身回答当百炼输出。直接上游为非流式兼容接口，未检验原生SSE。

[真实页面结果](evidence/browser/live/result.json)：自然聊天、候选确认/纠正、其他角色隔离、赠画跨会话、1440px桌面与390px移动布局、0 pageerror均通过。**创意方案未发布，记录了明确失败；这项技术旅程通过不等于创意产品通过。** 正向的结构化创意存储/条件契约由单元替身验证，本轮最终浏览器未验得可靠创意发布与反馈闭环。

[桌面商品](evidence/browser/live/products-desktop.png)、[桌面记忆](evidence/browser/live/memory-desktop.png)、[移动端真实失败](evidence/browser/live/creative-mobile.png)。移动截图保留测试时展开的条件面板，没有修改图片隐藏失败。

## 失败定位与边界

1. 初始265测试中，新增商品使固定目录计数失效；扩展偏好召回又把无关兴趣送入具体整理目标。已修正目录断言和相关性门槛，未取消原权限/不相关信息回归。
2. 真实创意发现属性引用/官方引用混用、requirements类型不一致：新增有限协议兼容及具体格式错误定位；未知引用不被静默删除。
3. 勾选范围被部分短名匹配错误收窄：保留明确物品ID池，排除条件仍执行；新增回归。
4. 反例检查有时也生成无效修订；旧逻辑会在明确否决后取回旧草稿，已阻断这个分支。批量同方向候选不再只因方向相同被误去重。
5. **未解决**：动作/物理校验仍是有限规则，会把虚构故事词语当实际材料，也可能把同句中纸的性质归到铅笔。模型反例检查不能替代物理与人类判断。有的中间草稿虽过浅层规则仍不值得使用，详见对照报告。

全部数据由测试创建，私人库、原项目数据、真实硬件和外部账号权限均未操作。SQLite schema没有迁移。Docker镜像本轮未构建，物理设备验证0，人类创意盲评人数0。机器证据哈希见 [SUMMARY](evidence/SUMMARY.json)，日志只做换行/末尾空白规范化，模型JSON与截图保持原字节。
