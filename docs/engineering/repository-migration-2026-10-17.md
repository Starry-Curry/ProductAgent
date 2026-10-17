# 统一源码仓库迁移记录

日期：2026-10-17。仓库Starry-Curry/ProductAgent，本机D:\Project\Tianmao\ProductAgent。

## 来源与范围

唯一源码输入是Wukaifeng/Product-Agent-Review-Exports.zip中的精简Product-Agent-Review-20261017.zip。内层SHA256为cb610240630dcd218f81358a5459bb73bb33514618d46bb40518fa646f7d1726，93项文件按FILE_MANIFEST原文逐项验证通过。原报告记录f058488、基线118e295，没有提供.git；新仓库从真实导入提交开始，不伪造此前历史。

逐文件原始与UTF-8/LF规范化摘要见import-provenance.json。应用src及测试以交付版为准，包名和依赖锁保持一致。旧源码不覆盖新应用，不导入业务数据库。

## 文档和本地整理

- V1.1产品说明去重，补齐完整技术任务书、配套主提示及交接说明。
- 原README/开发报告/交接/原文件清单保存在docs/archive/import-2026-10-17；之前本机docs归档在pre-repository。
- 重写根README和当前报告、交接、状态，建立文档优先级、CONTRIBUTING、AGENTS和CHANGELOG。
- 本机根目录README标明唯一正式工作区，旧目录保留历史；LocalFlow模型/Conda的绝对路径没有迁动。
- 默认系统Node20与本项目Node24要求不一致；本机在忽略目录.runtime/node24复制已有Node24。START.cmd/scripts/windows.ps1选择项目Node24并启动当前目录应用，不下载到C盘。
- 原依赖来自交付外层包的本机验证安装，复制到忽略的node_modules以复验；新克隆按package-lock使用npm ci。

## 工程整理变化

新增忽略规则、LF文本约定、Windows启动工具和离线GitHub Actions。CI先构建再独立类型检查，因为next-env.d.ts引用构建生成的路由类型。

verify-baseline.mjs不再依赖仓库外旧ZIP或无法取得的118e295对象；默认查本仓库导入提交并校验其业务源摘要，首次提交前可校验工作树。旧工具原文另归档。后续业务改动以Git diff和实际回归评估，来源校验不替代功能测试。

## 验证

本次新目录已运行26/26离线测试，全部通过；七例基准完成，五个错误样例从旧ID-only策略的五个误放行降为零，仍误拒一个正确改写。这是导入代码既有能力的复验，不是本次新增模型效果；真实模型请求为0。

本次正式构建、独立类型检查通过；35个业务/测试/依赖声明源文件与交付规范化摘要一致，零差异。提交候选扫描未发现凭证模式，排除运行时、依赖、构建、数据库和模型。结构化结果见repository-validation-2026-10-17.json。

原交付的Windows集成/截图证据保留在review-evidence，不能冒充本次新浏览器验收。本次不运行付费或实物测试，也不将此前回环网络限制当作业务验证通过。

## 发布边界

上传main之前检查忽略规则、逐文件清单和凭证模式。api.txt、.env.local、数据库、照片数据、模型、Node运行时、node_modules、.next、ZIP均不上传。历史截图是交付方标注的合成样例；原公开仓库设置由用户创建，本次不改变可见性。

本机Git网络访问失败，使用已连接且具有写入权限的GitHub接口上传；远程提交之后校验树与本机Git索引一致，并同步本地main及origin/main。以后正常联网时使用标准git pull/push，不需要继续互发ZIP。
