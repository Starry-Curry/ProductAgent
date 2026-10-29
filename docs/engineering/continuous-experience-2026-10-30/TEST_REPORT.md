# 实际测试与失败记录

## 自动检查

| 命令 | 结果 | 边界 |
|---|---|---|
| `npm test` | 340通过，0失败 | 全部离线；较上阶段329新增11项，不能证明创意成立 |
| `npm run typecheck` | 通过 | TypeScript检查 |
| `npm run build` | 通过 | Next.js生产构建；最终本地预览使用构建产物 |
| `npm run test:benchmark` | regressions=0 | 离线基准，真实模型调用0 |
| `node --experimental-strip-types --test tests/unified-home.test.ts` | 最终22项通过 | 授权、跨用户、撤权、忘记、主题交错、单件偏好隔离、短引用、方案交接 |
| `node scripts/unified-home/visual.mjs` | 通过 | 最终桌面与390px手机、首页入口排序、空白新问题、保存的否定反馈、无横向溢出；0次生成请求 |

模型来源删除器另有3项离线契约测试，**只是实验代码测试**。真实六题内容复核并未证明有效，因此产品默认关闭。

首次全量回归曾失败2项：新增的自动反馈上下文把私人备注带入云端。已修为默认不发备注，只有本次明确同意的指定方案才发送；原有隐私测试保持通过。`offline-first-failure.txt`保留初次失败。短引用测试也曾因测试替身自身的断言先执行而失败，已修复替身后复验，未因此放宽业务授权。

## 真模型

总计98次，qwen-plus96、qwen-max2；提供者均返回HTTP成功，但这不等于应用接受或内容正确。已知输入887461、输出35306 token。估算0.8471632元，按中国内地非思考模式公开标价，不扣免费额度、不假装查询到账单。全部新增阶段共用100次/50元的更严格上限，历史52次留在原台账，不清零。

- `continuous-compare.ts --cloud --config=...`：三组双轮，共六个问题，直接模型/旧Agent/检索改动版。旧Agent读取0c6851a的两份历史模块，其余业务依赖相同；不是整个历史App镜像。直接及旧Agent各6次业务返回；检索版5次返回、1次因非法引用被拒。
- `continuous-compare.ts --cloud --improved-only --source-review --config=...`：六题独立来源复核实验。已有 `comparison-reviewed.json` 在默认关闭改动前运行了当时默认开启的同一删除器；现在复现必须加实验开关。6次返回仍有错误，未启用为生产默认。
- `continuous-browser.mjs`：首次目标切换原会话成功；开放新用途无合格候选。后来一次物品ID被模型拼错遭拦截。qwen-max小样本创意格式及物理机制失败。保留每次浏览器JSON，不覆盖为全部成功。
- `continuous-browser.mjs --recreation-only`：最后一轮用单件上下文生成、收藏、记录反馈、明确云端同意及交接接口均返回；但前端当时删除了旧会话的planContext，返回答案未利用选中方案；手机外部hash跳转也失败。已根据真实问题修复，见下一条。
- `resume-browser.mjs`：**修复后真实浏览器通过**。打开既有任务→查看已生成创意→标记不采用→写入具体否定理由→明确勾选云端使用→从该卡继续；请求实际带previousIdeaIds与feedbackIdeaIds，返回session ID仍为原任务，服务端known中收到该ID。桌面、手机、hash返回及宽度通过，没有页面脚本错误。

最后一条的回答能引用拒绝反馈，但又编造容纳及材料结论，见QUALITY_REVIEW。**软件闭环通过，创意内容失败；没有成功实物创意或真实设备结果。**

## 记录位置

全部为 `artifacts/continuous-experience/`：

- `model-calls.json` / `model-summary.json`：98次逐请求模型、token、延迟、原始输出、输入hash、费用估算。`providerReturned`和内容验收分开。
- `comparison.json` / `comparison-reviewed.json`：实际问答与失败；`BLIND_SAMPLES.md`为24份匿名样本，`review-key.json`为对应关系。未进行独立评审人的统计盲评。
- `browser-*.json`保留所有失败轮次，`browser-final.json`为修复后实际交接；`visual-final.json`为最后UI小修后的零付费截图检查。
- `home-desktop.png`、`home-mobile.png`、`home-mobile-viewport.png`、`recreation-mobile.png`、`recreation-reviewed-desktop.png`、`feedback-in-unified-task-desktop.png`为真实页面截图。
- `offline-tests.txt`、`typecheck.txt`、`build.txt`、`benchmark.txt`与定向日志为命令证据。

截图仅证明显示与操作。页面中的方案已标为“不感兴趣”，不是推荐实施。旧失败截图独立保留。

## 数据与网络

仅 `.runtime/home-preview/demo.sqlite` 与新建的 `.runtime/continuous-comparison-*` 合成数据。对照只复制前者中lin虚拟物品的公开官方文档缓存，未复制私人工作区或用户数据库。SQLite及缓存不提交。

本轮复用上一阶段实际获取的13份官方资料，不冒充每次重新联网。创意流程另尝试既有Wikibooks公开参考路径，失败时结果记录“未能读取或许可未确认”，没有伪造来源。价格核对使用阿里云官方文档：

- https://help.aliyun.com/zh/model-studio/model-pricing
- https://help.aliyun.com/zh/model-studio/qwen-max

付费测试完成后停止云端预览、改为模型关闭的本地预览。现有本地安全配置由网关进程使用，应用仅收到假凭证；报告和Git不含真实配置、Cookie、Token、数据库、依赖或构建缓存。

发布前对暂存区逐文件扫描：未发现凭证特征、禁止跟踪路径或单个超过5MB的文件。完整清单及SHA256见 [pre-push-scan.json](../../../artifacts/continuous-experience/pre-push-scan.json)。签名扫描是额外防线，不证明绝无任何未知形式的秘密。
