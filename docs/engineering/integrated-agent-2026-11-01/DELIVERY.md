# 用户现在可以做什么

可以在同一物品里查适用官方章节、连续追问、准备待确认计划、保存私人故事，再回到同一件事。确认的计划不再只停留在聊天气泡：相关资源、来源与未知条件回到Task；用户报告的成功/失败在获准后能实际改变下一任务的建议。

最明确的修复：保存故事不再遮掉同Task的操作经验；确认领域写入后，对话接入已有领域Task，不建立平行任务；从另一个入口返回时方案与协作进度继续可见。旧准备清单仍可确定性更新，较早任务可展开查看，不再只有最近8件可点击。

## 体验与运行

本机工程自测入口 **http://127.0.0.1:3233/**。独立模拟资料库，需注册/登录独立账号；身份与持有不是现实用户资料。自测账号口令仅在忽略的本地配置中，不在报告/Git公开；用户可自行注册测试账号。

从“我的物品”录入准确型号，确认模拟持有，在详情自然提问。EOS R8可从官方目录发现手册。Sony发现失败时，明确提供核实的官方URL，不把模型生成链接当资料。复杂目标从“继续我的事”启动，选择实际资源；保存卡需点击确认。未来复用与云端使用分别勾选，不自动授权。

真实截图：[最终桌面](evidence/release-browser-v3-desktop.png)、[最终手机](evidence/release-browser-v3-mobile.png)、[完整回答](evidence/release-browser-v3-answer.png)、[经验影响回答](evidence/r10-experience-fixed-reused-desktop.png)、[纠正后回答](evidence/r10-experience-fixed-corrected-desktop.png)、[故事接续](evidence/natural-story-final-desktop.png)。均为真实浏览器，不是设计稿。旧对话在随后纠正/遗忘后可能必须重新提问；最终复验未绕过该隐私失效边界。

工作区 `D:\ProductAgent-LifeContext\.runtime\practical-agent-v1`，分支 `codex/wujian-integrated-agent-v1`。Node24.22.2、原package-lock；普通新检出用Node24执行`npm ci`。本机复用已有依赖，未改全局Node/Git或安装新框架。

```powershell
$env:PATH='D:/ProductAgent-LifeContext/.runtime/product-foundation-app/.runtime/tools/node-v24.22.2-win-x64;'+$env:PATH
$env:WUJIAN_BUILD_DIR='.next-integrated'
$env:AI_ALLOW_PAID_CALLS='false'
$env:WUJIAN_ALLOW_PAID_CALLS='false'
npm run build
node scripts/integrated/preview.mjs
```

预览网关内部通过现有根`.env.local`使用凭证，应用只拿本地替身凭证；不得复制密钥到源码。数据固定在当前工作区`.runtime/practical-preview`，不指向生产库。先检查独立授权与台账，再接上游；请求数与保守费用任一到上限即停止。60分钟自动结束，重启继续同一台账。

默认预览**不把用户聊天正文写入评测文件**；工程合成验收才显式使用`--record-synthetic-evidence`。最终预览关闭此选项。无凭证/授权时仅离线运行，不据此宣称真实模型通过。验收脚本依赖已创建的合成环境，复跑用新阶段名，保留历史原文。

REA复用已有6.8.0安装；忽略的`.runtime/rea-tools`为目录连接，不随Git分发。其他环境无CLI时应记录unavailable。软件灯状态回读不是实体硬件控制。

## 保留、改造和恢复

保留Next.js、SQLite、OpenAI SDK、LangGraph既有持久任务、身份、授权、物品、知识、记忆、故事、创造力V2、分身、家庭、赠礼与REA软件实验。无SQL结构迁移、无真实数据搬迁、无新生产框架。

改造相关章节检索、物品间片段预算、完整授权正文参与数值核对、轻量工具循环、确认业务命令、Task计划和经验连续性。未恢复第二模型审核、SKU答案表或强制所有聊天结构化。

本轮未删除历史代码/证据。不采用超时Responses搜索候选、过重嵌套计划契约和失败自由规划实验作为新默认。实验事实QA及V3继续默认关闭。

基线`84f601b8b68bc52471a96cc6c6f6475531e816d6`；治理恢复点`5d6b12c`，首个核心恢复点`c123409`，最终以独立分支HEAD为准。恢复时另建隔离worktree指向相应提交，使用独立`PRODUCT_AGENT_DATA_DIR`，不reset当前工作区、不覆盖数据库。无需回滚数据库结构。未合并main、未强推、未部署公网。

## 尚未解决

1. 官方资料自主发现不完整：Canon有限目录路径有效，Sony仍需降级；图示按键/符号未全面理解。
2. 来源适用不等于每句话正确。开放新组合仍会混淆控件、比例或添加额外资源；追问纠正不是首答成功。
3. 受控计划只覆盖明确启动、存在已知失败条件的多物品计划，不保证所有自由文字的物理可行性。
4. 循环上限4次模型/8次工具/150秒，但复杂任务仍约一分钟。应改资料选择和操作解释，不继续堆提示词。

本轮是**可运行、质量部分达标的集成交付**。下一步优先官方图文操作证据及短而完整的行动呈现；不换框架、不扩张功能。未经过真实用户盲验，未证明创意质量普遍提升。
