# 物间 · ProductAgent

以真实物品、个人 Context 与生活经历为基础的本机个人/家庭 AI 生活助手。新版采用 **真实物品展柜＋生活故事（B＋C）**，在原有 Next.js、LangGraph、Qwen、Product Pack、Memory 和家庭/礼物能力上增量开发。

当前工作区：`D:\ProductAgent-LifeContext`；分支：`feat/life-context-v1-d`；基线 `4451ca2`。原版 `D:\ProductAgent-Dev` 的代码和数据保持独立。以下启动方式覆盖历史说明中的旧机器路径、3100 端口和二维空间默认首页。

## 启动

Node.js **24**，使用 package-lock.json：

```powershell
Set-Location D:\ProductAgent-LifeContext
npm.cmd ci --cache .npm
npm.cmd run build
npm.cmd run start:life
```

打开 [物间新版](http://127.0.0.1:3200)，也可双击 `START_LIFE.cmd`。开发使用 `npm run dev:life`。更新源码后须重新 build；启动器只在缺少构建时自动构建。默认仅监听本机、费用与外部 tracing 关闭。

独立数据库为 `data-life-v1/demo.sqlite`。程序拒绝旧 `data/` 和其他工作区；测试使用 `.runtime/verification-*`。不要复制旧数据库、照片或环境密钥。

## 可以实际做什么

- **录入与知识**：手动名称/品牌/型号、真实照片保存、条码/二维码图片解码、公开资料链接、PDF/TXT/MD 说明书文字提取；核对后绑定已有型号包。类别、生命周期、数量/有效期、材质、供电和维护信息分别保存。
- **智能帮助**：复用 LangGraph、来源筛选、受控工具、会话和反馈；未知型号不编参数。普通对话无需物品。默认无付费模型时，精选帮助、本地记录可用，模型不可用明确提示。
- **发现**：12 类本地能力配方动态匹配单件/多物品及当前时间/要求，支持收藏、尝试和反馈；另支持用户提交经验来源与模型生成路径。所有候选有条件，未验证不标成实物验证。
- **生活故事**：照片＋原话、一份片段关联多件物品、查看/编辑/删除、主动请求本地回忆；与聊天历史、待确认记忆分别处理。
- **家庭与礼物**：共享物品、负责人任务、动作确认、选中文字故事快照和认领；人物仍是明确标注的本机演示身份。

首页可载入 25 件合成展柜实例（10 个绑定型号），3 个生活片段（2 个图文）、家庭事项与礼物。资料沿用 11 包/33 事实/2 个有限过程，不能当作全品类完整说明书库。示意照片不冒充对应型号实拍或用户真实经历。

## 验证与交接

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:benchmark
npm.cmd run build
npm.cmd run test:life
npm.cmd run test:acceptance
```

按顺序运行，避免并行启动多项构建/浏览器。`test:life` 自动使用独立库与随机本机端口，包含 PDF、QR、EAN-13、照片录入/故事编辑删除；`test:acceptance` 回归旧版入口。旧页面保留在 [/legacy](http://127.0.0.1:3200/legacy)，操作指南在 [/guide](http://127.0.0.1:3200/guide)。

- [本轮架构、来源、数据边界与接续说明](docs/engineering/life-context-handoff-2026-10-19.md)
- [本轮端到端验收](docs/engineering/life-context-validation-2026-10-19.json)
- [实现状态](IMPLEMENTATION_STATUS.md)、[开发报告](DEVELOPMENT_REPORT.md)、[技术交接](REVIEW_HANDOFF.md)
- [文档索引](docs/README.md)、[此前 README 历史快照](docs/archive/README-before-life-2026-10-19.md)

当前没有付费视觉识别、扫描 PDF OCR、通用条码商品库、订单/社区全站 API、真实家庭同步、IoT 或后台通知。真实模型和实物效果须另获授权后验证；不得用离线测试证明真人留存或模型准确率。密钥、数据库、缓存和私人材料继续排除 Git。
