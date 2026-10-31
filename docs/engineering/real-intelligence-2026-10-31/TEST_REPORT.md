# 测试与来源报告

## 工程检查

Node24.22.2；package-lock未修改。新增11项回归：来源适用2、未知值1、检索/引用/部分完成/经验5、general门禁1、超时窗口1、预算边界1。先观察失败再修复，具体在STAGE_FIXES。

| 实际命令 | 结果 | 证据 |
|---|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund --cache .runtime/npm-cache` | 100依赖安装；只在隔离工作区 | 正常依赖，未修改全局Node |
| `node --experimental-strip-types --test tests/source-applicability.test.ts` | 初始1失败/1通过；修复2通过 | 7秒错误索引可复现 |
| `node --experimental-strip-types --test tests/grounded-unknown.test.ts` | 初始null触发ZodError；修复通过 | 真实模型原始null见台账11/13 |
| `node --experimental-strip-types --test tests/operation-quality.test.ts` | 初始4失败；最终5通过 | 另加排版正规化保持数字/否定测试 |
| `node --experimental-strip-types --test tests/fact-gate-bypass.test.ts` | 初始发布无据结论；修复通过 | 真实默认路径QA‑05同样复现 |
| `npm test` | 最终409/409，0跳过 | evidence/offline-tests.txt；基线398 |
| `npm run typecheck` | 通过 | evidence/typecheck.txt |
| `WUJIAN_BUILD_DIR=.next-real-intelligence npm run build` | 生产构建通过 | evidence/build.txt；不覆盖旧服务构建 |
| `npm run test:benchmark` | 0回归；真实模型调用0 | evidence/benchmark.txt |
| `node scripts/real-intelligence/browser-regression.mjs` | 四项真实浏览器检查通过、0页面异常 | evidence/browser.json及桌面/移动截图；模型关闭 |
| `node scripts/real-intelligence/browser-live.mjs` | 实际UI发送、SSE、桌面与390px呈现通过；内容部分覆盖 | evidence/browser-live.json；2次真实上游请求 |

第一次全量离线406通过、1项可选REA跳过。随后复用已安装固定6.8工具的本地junction，该项定向通过；最终全量409项0跳过。没有安装新全局工具，也没有现实设备操作。

## 四条跨模块旅程

| 旅程 | 实际执行 | 未达标/不能宣称 |
|---|---|---|
| A 陌生耳机 | 真实Sony资料、真实模型指导；A用户报告→真实台灯B→新会话C；纠正/忘记后再调用；浏览器任务卡纠正/忘记 | 合成持有和经验；部分操作误拒与语义错误仍在，不是现实配对成功 |
| B 跨物品创造 | 真实Canon/SAMLA/米家资料、获准偏好；真实模型输出→反馈→保存Outcome→新任务再次利用反馈 | 第一次60秒超时；90秒显式实验成功返回但物理错误，反馈后仍失败。没有创意质量认证 |
| C 家庭协作 | 两个真实本机账号、明确授权摘要、接手/报告、原任务更新、撤权403 | 摘要为测试者提供并明确确认；未声称自动模型总结、短信通知或现实修理完成 |
| D 故事赠礼 | 选中合成赠画故事→礼物页面认领→独立物品实例；未分享故事与新主人私事隔离 | 模拟物权交接和合成故事，不是现实邮寄/赠送 |

C/D与账号授权应由确定性事务验证，并非必须增加模型调用。原有物品、分身、故事、赠礼、家庭、权限和REA软件实验保留。迁移和历史Context隔离回归由现有离线用例与上述浏览器覆盖，不触碰私人数据库。

## 来源适用性与取得情况

实际联网获取记录：`official-fetch.json`、`product-source-fetch.json`、`supplement-source-fetch.json`。官方审阅索引7次请求中6个正文可读，DJI规格只31字符；商品列表15次中10个可读、2错误、3空壳；补充2次中JBL PDF可读、DJI global FAQ空壳。统计含重复URL，不称24个不同资料。

- **Sony WH‑CH520 / YY2958**：配对/初始化英文帮助、英文完整PDF、中文首页与配对/部件页实际取得。初始化约10秒以上，与后续配对5秒和USB连接条件下的reset不同。错误英国URL退出当前索引。
- **Logitech M185**：马来西亚官方技术规格实际取得；1节AA碱性电池、接收器Bluetooth Feature N/A。N/A不扩展为所有罗技型号或售后服务政策。
- **IKEA SAMLA 494.408.37 / 11L**：日本站实际取得；食品接触明确未批准、外尺寸39×28×14cm。不是此前中国SKU194.408.48；不把外尺寸当KALLAX净格。
- **DJI Osmo Mobile 6**：V1.8英文PDF实际取得；170—290g、67—84mm、6.9—10mm。应用网页/FAQ取空壳，不冒充成功。网页工具另能读取[新西兰FAQ](https://www.dji.com/nz/osmo-mobile-6/faq)，用于复核答案，不回填成原模型已见资料。
- **JBL CLIP 5**：美国商品页受限；官方支持站QSG实际取得。QSG缺少完整Boost文字且部分图标字形损坏。另用[JBL品牌规格PDF](https://www.jbl.cl/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwbb89076c/pdfs/JBL%20Clip%205_%20Specsheet_EN.pdf)核对12+3小时与双机立体声/Auracast；它未进入旧模型输入。不得从QSG未写就否定。
- **Canon EOS R50**：中国产品页取得；英文手册索引只114字符，注明固件1.5.0以上。不能称读完操作正文或确认个人相机固件/镜头。
- **米家台灯1S MJTD01SYL**：阿联酋产品页和新加坡规格可读；旋钮动作、2.4GHz，地区来源明确，不推定已联网/已控制或所有地区智能平台一致。
- **Philips HD9252/90**：支持页跨站跳转，未读到正文。QA‑17为来源阻断，不能拿同系列步骤替代。
- **KALLAX 703.518.86**：日本站实际取得；锚固警告和柜体外尺寸有据，净格尺寸/用户墙体/实际固定未知。

## 费用与失败

137次真实上游推理，136次有usage。返回finish=stop128次、tool_calls6次、length2次；1次超时用量未知。HTTP200、tool_calls和length都不能当作完整任务通过。`model-calls.json`保留全部尝试、用量、时长、原始消息和输出；超时继续占一次和保守预留金额。

已知Token费用估算0.606245元；未知用量预留0.451952元；预算占用1.058197元。历史150次台账前后SHA256均为`f24bef4a70c079a01b47074ec374b9d3f72c8a5119693792903507ade41cb369`。没有请求新预算，也没有用剩余额度继续漫无目标打磨。
