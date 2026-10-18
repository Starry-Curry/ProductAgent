# 2026-10-18 晨间验收

更新：真实百炼接口、工具循环与浏览器显示已于用户追加授权后验收通过；最新操作请见 [系统体验指南](system-experience-2026-10-18.md)。下方保留最初晨间验收与当时离线状态。

本轮保持原产品模块和交互，增加 LangGraph 有状态执行、有限来源过程、个人记忆管理和可选文字陪伴。详细修改、架构与 Prompt 见 [实现说明](foundation-implementation-2026-10-18.md)。

## 启动

在 `D:\Project\Tianmao\ProductAgent` 双击 `START.cmd`，打开 http://127.0.0.1:3100 。本轮已生成新生产构建。若已有旧服务占用端口，先在其窗口 Ctrl+C 后重新启动。

本机此前准备的 `.env.local` 只有 API Key 在创建时留空；在本机填写 `AI_API_KEY` 后重启。北京兼容地址仍可使用 `https://dashscope.aliyuncs.com/compatible-mode/v1`，模型默认 `qwen-plus`。新公开模板含 `AI_ENABLE_THINKING=false` 及关闭外部 tracing 的设置，现有私人配置没有被本轮检查或改写。

阿里云当前也推荐业务空间专属地址 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，[官方文档说明原域名仍可用](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)。因此本轮不额外要求你填写 WorkspaceId。Key 的地域必须与地址一致。

未配置 Key 时，精选资料指导、记忆与原有本机功能仍可验收；需要真实生成的请求会明确显示不可用。自动测试禁用了云端请求，本轮没有真实模型或实物验收结论。

## 建议按这三条旅程验收

### 1. 未建档提问 → 操作 → 反馈与交接

1. 首页不选已有物品，问“鼠标双击速度怎么调”。应先询问系统，不阻止你继续，也不强制建档。
2. 回答“Windows 11”。应给出设置路径的 3 步，并能展开 Microsoft 来源。
3. 点击第一步“这步试过了”，再问“还是不行”。应保留系统条件，只展示剩余步骤，不再给 AA 电池规格。
4. 点击“还没解决”，补充卡点后“继续排查”。应记录反馈、继续追问实际差异；不会自行宣布修好。
5. 打开一件家庭共享物品提问，再点“请家人帮我”。检查、编辑摘要后确认。家人只能看摘要、物品和尝试数量，不能直接读取你的会话或记忆。
6. 解决后点击“解决了”，可主动把有用方法保存到本地记忆。

### 2. 兴趣会被参考，但听从现在的你

1. 首页展开“关于我与记住的事”，保存兴趣“我喜欢手工和拼豆”，保持云端授权不勾选。
2. 进入“发现”，展开“结合我记下的兴趣，找点灵感”，问“用家里的东西找点灵感”。在演示物品仍可用时应优先出现手工相框候选。
3. 接着说“今天不想手工，换个方向”。应切到拍生活照的候选，不坚持原来喜好。
4. 可纠正这条兴趣、改为候选或忘记；候选和想象创作不进入真实记忆召回。

### 3. 故事、陪伴与忘记

1. 保存一条真实故事，例如“青色相框是毕业那天妈妈送的”。默认仅本地。
2. 展开可选陪伴，选称呼和语气，开启后保存，问“聊聊以前的故事”。应标明来自自己的记录，不假称 AI 当时在场。
3. 忘记该记忆。旧对话显示与 checkpoint 应清除；重新问同一故事，不应恢复已忘记的原文。
4. 无相关记忆且无 Key 时应坦诚显示云端暂未配置；不会预制一个假的共同经历。
5. 关闭陪伴后，对话入口收起；使用帮助、家庭事项和其他原模块仍可使用。

再切换手机宽度和长辈版，检查主要按钮、表单和导航；新增高级设置默认折叠。

## 可复现检查

使用 Node 24：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1 -Task test
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1 -Task benchmark
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1 -Task build
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1 -Task typecheck
.\.runtime\node24\node.exe scripts/verify-local.mjs
```

最后一项会自动在独立 `.runtime/verification-*` 数据目录、空模型凭证及随机本机端口启动生产构建，依次运行旧交互和新旅程；使用本机 Edge，可通过 `EDGE_PATH` 指定路径。新电脑用 Node 24 的 `npm run test:acceptance`。请先 build。

截图及详细运行输出位于忽略目录 `artifacts/`；可共享的脱敏结论保存在 [验证摘要](foundation-validation-2026-10-18.json)。迁移备份、私密配置和日常数据库未进入 Git。忘记应用记忆不会自动修改历史备份或原故事稿件。

## 本次执行结果

42/42 回归通过；类型、构建、离线新门禁与隔离 Edge/API 验收通过。未建档关联、家人摘要、有用方法、兴趣意愿、故事忘记及手机/长辈版都已走查。新门禁 7 例符合预期，旧接口仍报告 1 个正确改写误拒，详见验证摘要。真实百炼与实物验证尚未进行。
