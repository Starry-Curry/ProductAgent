# 测试与未达标结果

## 实际执行

| 检查 | 命令（均使用独立 Node24.22.2） | 结果 |
|---|---|---|
| 全量离线 | `node scripts/test-offline.mjs` | 371通过，较基准362新增9项；其中REA测试在本机实际运行，CI未安装时明确skip |
| 类型 | `node node_modules/typescript/bin/tsc --noEmit` | 通过；见归档日志 |
| 生产构建 | `WUJIAN_BUILD_DIR=.next-closeout node node_modules/next/dist/bin/next build` | 通过；隔离输出不替换旧服务 |
| benchmark | `node scripts/benchmark.ts` | 0 regressions；替身，不是真实模型质量 |
| 新浏览器 | `TEST_BASE_URL=http://127.0.0.1:3216 node scripts/product-foundation/browser.mjs` | 结果见 `evidence/browser.json`；真实Edge桌面/390px手机，付费关闭 |
| 旧入口回归 | `TEST_BASE_URL=http://127.0.0.1:3217 node tests/integration.mjs` | 结果以 `evidence/legacy-integration.txt` 为准，不用新文档检查代替业务测试 |
| 模型 | `node scripts/product-foundation/qa.ts --gateway=<当前隔离网关> --round=<保留历史的新轮次>` | 累计150次上游推理，已停止，不可重复执行增加本轮费用 |
| REA | 固定版CLI `analyze-javascript-application tests/fixtures/virtual-lamp --format json --analysis-timeout-ms 15000` | 实际静态分析；第一次未识别服务端路由，真实客户端加入后发现请求候选，未伪造发现 |

## 真实模型结论

两款非固定家庭SKU：JBL CLIP 5（官方QSG PDF）与 Sony WH-CH520（官方帮助页）。不是用户真实持有。官网来源与型号核对成功；JBL商品页、首次Sony PDF访问失败也保留在交接。最终浏览器又实际从Sony官网取回并导入资料。

初测暴露隔离网关继承了禁止stream限制，本地拒绝未送上游；修复后另存补测。30案候选轮见 `qa-live-stream-fixed.json`：18 answered、2 blocked、6 unavailable、4 needs_info。覆盖多问题、按钮区别、充电、未知材料、个人故障状态、官方资料缺失与安全；其中两例由本地安全路径阻止，不冒充调用模型。台账有29个不同question字符串，不能写成30个不同问题均由真实模型成功完成。

流式样本16例的服务首文本P50=610.9ms、P95=974.2ms；全30案服务总耗时P50=11134.3ms、P95=31115.1ms（包含失败/安全路径），**不是“完整正确回答”的P50**。六例直接同模型、同资料对照保留在同文件 `direct-same-model` 中。元信息不同，内容质量没有真人盲评；不宣称物间优于直接千问。

后续已定位英文资料丢失，修复后只复验相关子集。最后8例获得真实模型结果；剩余请求被150次上限阻止，不能算成功。原始轮次分别存放，不覆盖或拼成“全部通过”的新一轮。

总计150次上游返回，548881输入tokens、30350输出tokens，费率输入0.8/输出2元每百万tokens，估算0.4998048元，非账单。上游返回不代表校验成功。明显失败：资料缺失推导出不支持降噪、虚构保修条款和维修收费策略、添加未证实固件前提。**自由事实综合保持显式实验开关关闭。** 操作路径保留原文引用校验；校验仍不是完整语义证明。

## 浏览器与身份

账号通过真实注册/口令校验/HttpOnly会话，两个隔离浏览器分别登录，不是切换演示下拉。已验证：陌生SKU真实录入、官方资料保存、分身设置持久化、本地关系召回纠正遗忘、共享不共享私聊、事项已读接手完成状态、选择故事赠礼、独立实例与双向隐私、REA调光42及回读撤权。数字分身生成与创意质量没有新增真实模型浏览器结论。

发现并修复：Next本机Host转写被错误拒绝；录入表单的两个确认条件放错位置；浏览器脚本未等待分身保存/加载完成。修复后的生产浏览器才作为最终结果。手机截图经实际查看；无横向溢出与pageerror检查见JSON。

收口兼容复核另修复大字关怀页仍调用旧角色事项接口的问题。最终生产浏览器实际切换大字版，接手并报告完成，再返回普通版核对状态；见 `care-mobile.png`。这是独立账号兼容修复，不是新一轮分身或界面重构。

## 不足与验证边界

P1普通问答质量和完整耗时目标未达标；浏览器首个有意义模型内容的全链路P50/P95未测完。家庭任务/创造力的本轮细分性能未补齐。P4新增三类分身测试是权限与Context协议测试，不是三类真实模型体验验证。P6旅程B沿用冻结的创造力V2，未重新证明创意价值；五旅程不能宣布全部达标。

REA仅自有软件验证；没有原生固件、BLE、ADB或真实硬件。重复回执不重新执行；未完成操作保留pending/failed-or-uncertain，重启后不盲重放，尚未实现通用自动恢复平台。
