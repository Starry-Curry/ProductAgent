# 真实测试记录

基准：远端行为版d02b35e，独立工作区与合成 SQLite；未触碰私人数据库、硬件或主分支。

| 实际命令 | 结果与边界 | 日志 |
| --- | --- | --- |
| `npm ci --cache D:/ProductAgent-LifeContext/.runtime/finals-audit/.npm --no-audit --no-fund` | Node24.16.0、package-lock，100依赖安装；无新生产依赖 | 本机执行输出；未保存完整安装日志 |
| `node --experimental-strip-types --test tests/personal-objects.test.ts` | 新增8项：产品识别/读取回退/SSRF、持有确认与事务、私密上下文、模式切换、故事派生记忆生命周期、单件目标路由、个人空间数值 | [全量记录](evidence/offline-tests.log)包含同组测试 |
| `npm test` | 315/315（基准307）；全程离线 | [日志](evidence/offline-tests.log) |
| `npm run typecheck` | 通过 | [日志](evidence/typecheck.log) |
| `npm run build` | Next15.5.28生产构建通过 | [日志](evidence/build.log) |
| `npm run test:benchmark` | 0回归，0真实模型请求 | [日志](evidence/benchmark.log) |
| `npm run test:acceptance` | 六条既有API/浏览器旅程通过，隔离生产服务、0真实模型 | [日志](evidence/acceptance.log) |
| `npm run test:cloud` | 八组访客/租户隔离、重启/快照恢复、登出、额度、原生工具循环检查通过；这里模型是替身，0真实请求；未验证Docker镜像构建 | [日志](evidence/cloud.log) |
| `npm run test:life` | 两条旅程通过，包含照片/图文/来源失败重试/连续会话/家庭/社交；0真实模型 | [日志](evidence/life.log) |
| `node --experimental-strip-types scripts/personal-objects/sources.ts` | 宜家2个官网正文读取/型号核对成功；JBL回缓存；0模型请求 | [来源回执](evidence/official-sources.json) |
| `node scripts/personal-objects/browser.mjs` | A/B技术流程、桌面/移动、记忆纠正遗忘、其他用户看不到私人分身/记忆，离线通过；不是智能质量验证 | [离线回执](evidence/offline-1793285538792/results.json) |
| `node scripts/personal-objects/browser.mjs --live --live-max=40-cny=10 --config=D:/ProductAgent-LifeContext/.env.local` | 最终A/B共6轮用户输入，技术流程通过；仅A两轮和B第一轮实际走云端，其余为明确标注本地回忆；质量部分失败 | [真实回执](evidence/live-1793286882827/results.json) |

## 不能被“通过”掩盖的失败

1. 首次两个离线浏览器运行在接口新增画作后，哈希导航未刷新数据，未找到画作。改成真实页面reload；保留[首次失败](evidence/offline-1793285052597/failure.json)、[第二次失败](evidence/offline-1793285450921/failure.json)。这是测试同步问题，不是模型或数据库失效。
2. 第二次付费浏览器运行完成A后，测试把原生Fetch的`response.ok`属性当函数，脚本退出；[失败原始记录](evidence/live-1793286153123/failure.json)。此前5次请求均已计费入账，没有回滚台账或伪装成成功。
3. 旧生活测试仍按旧录入契约传`packId`但没有明确持有，收到400。更新合成测试明确`ownsConfirmed:true`；新增单元测试保留未确认必须拒绝的验证。旧文本定位只匹配单条电池事实，行为版已返回完整资料包，改为核对实际助手消息包含该事实。手动录入现藏于“其他物品”展开区，文件旅程同步调整；最终两条均通过，未删业务断言。
4. **真实商品的个性化帮助仍失败**。模型原始输出混合厂家事实、建议数值与未经证实结论；现有校验有误判未知列表的情况，也阻止了无来源的10—15厘米建议，最终只呈现资料摘录。已修复“日常单件物品目标转全库存规划而得到0件”的路由；不等于回答质量已修好。
5. **B关系信息使用成功但生成质量不稳定**：实际回答引用小夏与40×30厘米，知道挂件/玻璃未知；却称呼用户“山山”，还给出未经验证的画架占地与胶粘建议。新会话同时问赠送者和摆放条件时，本地回忆遗漏后半问题。不能宣布个性化帮助成熟或实物方案可行。

## 真实模型预算

本轮累计14/40次，全部上游返回、0传输失败；其中2次为工具调用消息，2次为被采纳的赠画帮助回答，10次为未被采纳的商品回答草稿。两次完整浏览器运行加一次失败运行均计入。最终一轮6个请求，另8次来自之前两轮。没有模型自评分，没有真实设备验证，没有直接千问盲评（本轮是纵向功能开发，不能据此声称优于上一版或直接千问）。

输入65004、输出4571tokens，按北京qwen-plus非思考输入0.8/输出2元每百万估算0.0611452元，非实际账单；价格参考[百炼官方说明](https://help.aliyun.com/zh/model-studio/model-pricing)。[累计台账](evidence/live-ledger.json)保留每次输入、输出、模型、耗时、token和估算费用，[汇总](evidence/USAGE.json)。不包含鉴权头。预览若继续手动提问，会沿用原始同一台账，不会重置40次/10元限制。

## 隔离、权限与复现限制

所有运行使用`.runtime`下独立PRODUCT_AGENT_DATA_DIR；示例商品/绘画照片/经历均为合成持有。官网读取复用原有DNS固定、公网地址检查、跳转验证和大小/超时限制。来源内容不作为可执行指令。故事确认在既有SQLite事务中产生唯一关系记忆与幂等回执，原故事退出召回；修改/删除原文同步撤回派生记忆。切换关系使用时切断先前对话的模型上下文，防止通过历史回答绕回旧信息。

未迁移真实数据库，未触碰真实硬件；没有登录天猫或接平台接口，没有安装新Agent框架。测试通过不代表真实家庭认证或实体承重/粘接已经验证。全部测试最终代码使用同一构建；既有六旅程和八组公开演示检查在收尾数值条件小修前通过，随后数值修复由专项单测、315项全量、构建及最终真实浏览器覆盖，未重复声称最后一行修改后全套公开演示再跑过。

发布前又对本轮本机费用网关做零付费探测：无认证请求拒绝，带测试Provider标识的服务端请求通过；拒绝浏览器Origin。预览运行在3203，独立`.runtime/personal-preview`，费用继续累计；不复制既有密钥到新工作区。
