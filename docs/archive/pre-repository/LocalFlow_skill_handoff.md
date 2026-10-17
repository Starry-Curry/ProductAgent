# LocalFlow：设计、状态与后续 Agent 交接

更新：2026-10-05，日常个性化与商品修复阶段。此处为当前状态；2026-10-04及第一阶段报告为历史记录。

## 1. 目标、授权与密钥约束

用户授权Windows适配、DeepSeek真实调用、本地演示、个性化Skill与页面改进、网络修复和报告。全部环境/模型/下载/缓存/数据在D盘项目内。
工具不得读取、显示或上传D:\Project\Tianmao\api.txt或密钥副本。仅原先复制到LocalFlow/runtime/secrets/deepseek.key，原文件保留；运行中的应用用于API认证。后续不要cat/rg这些文件或打印带密钥的设置。
采用DeepSeek而非Codex登录。Task Skill为本项目内部版本数据，Qwen权重没有训练或更新。人物小林和材料均为虚构；演示反馈是人工口径模拟，不能当真实用户画像。

## 2. 已完成的实际运行

| 任务/材料 | 版本 | 检查 | 耗时 | 运行ID |
| --- | --- | --- | --- | --- |
| personal-expenses · 普通记账（无个人习惯） | v1 | 11/16 | 212.95秒 | e066ee1e2576407ea1be8ec9c0157cc5 |
| personal-expenses · 记住分类习惯（草案） | v2 | 11/16 | 214.23秒 | b77a1e7e154647c28b2627dddc0ac114 |
| personal-expenses · 根据纠错调整预算口径（草案） | v3 | 13/16 | 230.48秒 | eab78d6b177d42b8b2d75943f0273693 |
| personal-expenses · 明确预算条件（草案） | v4 | 16/16 | 242.83秒 | 0ebad446f4134cc29f6f384186532a73 |
| personal-expenses · 另一周 · 普通记账 | v1 | 11/16 | 208.62秒 | 797187c6ce3548aa8f927873ee2b9485 |
| personal-expenses · 另一周 · 记住习惯后 | v3 | 13/16 | 239.72秒 | f509c45eb37348bf976e639d0877a207 |
| personal-expenses · 另一周 · 修正预算条件后 | v4 | 16/16 | 270.2秒 | eeecc3f35a364a11979c5bf2a4f45c6d |
| product · 原版 Skill | v1 | 15/17 | 256.19秒 | 0a2c64f194e940d1be8bf08d5d69aea9 |
| product · 云端修订 Skill（草案） | v2 | 14/17 | 349.09秒 | 75e3e4e37fb8437d8534721485358603 |
| product · 修复契约与图像复核（草案） | v3 | 16/17 | 496.75秒 | 4ba7bfed835d45b8aa563ba093716691 |
| product · 配件累积合并（草案） | v4 | 17/17 | 465.55秒 | cb5c4399eb754ec1af2843247bf0a68c |
| procurement · 原版 Skill | v1 | 19/19 | 350.66秒 | e81fbf6727914c839cd7556b7c998c52 |
| procurement · 云端修订 Skill（草案） | v2 | 19/19 | 362.2秒 | 50a914ad3f8e42d1ae95c564e495e97a |

同一记账v2调整执行器后的单独检查：12/16，213.94秒，run=8d6b6bdc8e7349ca8ae4d1d3d2f2939e。仍有未判定字段，不能凭预算合计相同就判正确。

保留全部成功、退步和失败运行；商品两次v3视觉OOM尝试未评分，见comparison.case.failed_attempts。草案未自动启用，active仍为v1。另一周CSV没发给DeepSeek；v1/v3已跑过，v4是同类新材料复测，不是严格一次性盲测。

## 3. 退步原因与已落地修复

- 商品v2字段漂移、导出步骤没有模型语义、最终标量拼接候选、说明正确但updates缺失。默认锁定active输出字段，支持选择基础版本，漂移纠正重试一次后拒绝保存。规则放实际validate。
- 商品v4的17项通过只检查配件包含项，当前底座/说明书文字仍重复，容量引用有一条精确匹配review。下一步加入去重与引用断言，不能称所有业务要求已验收。
- recheck_visual只恢复当前实体已有引用的图片页；不自动读入其他材料。v3到16/17仍漏原有壶体，v4改为已有配件起点的累积并集；只有明确纠错证据才能删除旧项。
- 日常v2只存习惯未生效；确认偏好现在作为run.plan.confirmed_preferences独立注入，validate明确优先与影响范围。单独复测仍不足，说明需要云端将习惯编译到一致步骤。
- 记账v3分类正确却预算误排除；v4用实际反馈把category与include_budget独立判断，正支出默认true，仅待报销交通false。source字段、金额保持。
- comparison显示四轮、实际预算、新周复测、未评分失败与单独执行器检查；未判定include_budget另行计数，null不等于false。

## 4. 环境与验收

- .conda Python3.11；PYTHONNOUSERSITE=1、PYTHONUTF8=1。后端82项测试通过，前端TypeScript/Vite构建通过。浏览器最终结果见reports/2026-10-05/browser-check.json。
- RTX4060 Laptop 8GB；Windows默认ctx8192、16GPU层、batch512、ubatch128、单并发、关闭思考。视觉投影CPU(--no-mmproj-offload)、flash off、no-op-offload、GGML_CUDA_DISABLE_GRAPHS=1；图片放长文本前。CPU单独调整也曾失败，不能归为唯一修复；日志位置警告不代表内容必错。
- Clash HTTP127.0.0.1:7897实际可用，保持TLS；localhost直连。backend/app/transport.py及runtime/network.json记录选路；未修改全局代理/Conda配置。
- 云端https://api.deepseek.com，deepseek-flash，JSON，thinking disabled；本轮新增云端修订均真实完成。日常材料不因本地失败自动转云。
- store导入只建表，应用启动才恢复中断任务。启动/安装GBK、Conda路径、BFSU403、pip用户目录、npm超时等问题已处理。

## 5. 文件与运行入口

- 主要报告LocalFlow/reports/2026-10-05/REPORT.md及report.html；日常专题PERSONALIZATION.md。历史INITIAL_REPORT.md、HANDOFF-before-personalization.md保持原有证据。
- 使用说明LocalFlow/docs/USER_GUIDE.md/html；GET /api/docs/guide；报告GET /api/demos/report；对比GET /api/demos/comparison。
- data/demo-comparison-latest.json与reports/2026-10-05/comparison.json；原始CSV/JSON/XLSX以task-version-run前缀保存。data/localflow.sqlite3保存原始运行、反馈、Skill。
- 日常样例scripts/create-personal-sample.py、samples/personal-expenses两周CSV；导入scripts/import-starters.py。
- 回放scripts/iterate-demos.py→refine-personal.py→refine-product.py；后两者支持--prepare只生成修订；生成报告finalize-studies.py、render-docs.cjs。会真实调用DeepSeek/新增run，不要同时运行多个写同一report的脚本。
- 前端frontend/src/main.tsx、Comparison.tsx、style.css；后端main.py/skills.py/cloud.py/executor.py/models.py；Windows模型scripts/windows_model.py。
- 当前服务http://127.0.0.1:8765、模型8080。PID读runtime/pids，不用本文旧PID；停止脚本核对进程路径。不要在运行中重启后端。
- 打开：powershell -NoProfile -ExecutionPolicy Bypass -File .\start-windows.ps1；全部停止：同样方式运行stop-windows.ps1；已有环境无需重复下载。

## 6. 下一阶段设计与边界

1. 习惯从文本升级为带scope/condition/target_fields/exception/confirmed_by的结构化规则，保留撤销、优先级和版本，避免分类习惯外溢到预算。
2. 反馈成为版本化回归集：事实保持、字段契约、个人口径、来源、误报/漏检分开计分。加入退款、模糊消费、普通通勤与报销边界、多个CSV、无关图片。
3. 候选先回放旧例和新例，无退步并人工确认后晋升；当前自动回归/自动晋升未实现。模型输出说明正确不算成功，必须检查实际字段。
4. 设计层明确执行器能力与候选事实容器，避免标量塞多个候选、export承载不可执行规则；结构化规则编译和语义一致性审计尚未实现。
5. 目前个性化改善包括Skill文字和执行器代码；商品还调整视觉参数。不能把全部改善归因于Skill、声称权重变强或扩展为通用准确率。

---

# 2026-10-04 历史设计与安装记录

更新时间：2026-10-04（Asia/Shanghai）  
状态：Windows 原版 demo 已在本机跑通；交互简化、DeepSeek 接入和 Task Skill 初版的源码与后端验证已完成。新版前端仍待 npm 安装及构建；云端真实请求尚未验收，因为项目没有 DeepSeek Key。

## 2026-10-04 第一阶段实现快照

- 云端默认切换到 DeepSeek `https://api.deepseek.com` / `deepseek-flash`，沿用 `/chat/completions` 图文输入与 JSON 输出；支持 `DEEPSEEK_API_KEY` 环境变量，保留 Codex CLI 和其他兼容 API 选项。新增用户主动触发的小型真实连接测试。依据：[DeepSeek JSON 输出](https://api-docs.deepseek.com/guides/json_mode/)、[视觉输入](https://api-docs.deepseek.com/guides/vision/)。
- 前端源码重排为演示入口、添加材料、单按钮本地处理、复核与导出四步；高级规则与 Skill 修订收起。由于代理命令行无法连接 npm 且项目缓存缺包，当前新版前端还需在用户可联网的终端安装依赖并构建；旧 `frontend/dist` 不能代表新版已验收。
- 数据库新增 `skill_versions` 和 `feedback`；已有任务按需导入为 v1。运行记录固定 `skill_version`、已确认的偏好和 Plan 快照。字段可接受、更正、无法判断；问题可确认或标误报。原始运行不变，`reviewed=true` 导出应用人工更正并排除已确认误报。用户还可显式添加一条任务习惯，作为新草案本地试跑后启用。
- 云端修订接口只使用用户选中的反馈摘要，生成 draft Skill；可指定草案版本用本地模型试跑，并由用户明确确认结果符合要求后手动启用。版本历史支持恢复旧版。单纯 `completed` 不能触发晋升。尚未实现自动评测分数、习惯候选提炼或自动晋升；这些仍是下一阶段。
- 后端测试已扩展并通过 74 项；TypeScript 语法检查通过。前端需完成依赖安装、正式构建和浏览器验收；DeepSeek 真实调用需用户配置自己的 Key，不能把 MockTransport 测试当作云端验收。

## 1. 目标与产品边界

面向不会编程、但有高频重复任务的用户，把自然语言需求和少量示范转为可重复执行的本地工作流。新增的核心不是让 9B 模型无限自主，而是维护**版本化的 Task Skill**：记录用户认可的任务步骤、字段、术语、例外、输出习惯和验收方式；每次执行留下可核验的证据与反馈，再基于失败案例提出、测试和晋升新版本。

本文件中的 Task Skill 是 LocalFlow 产品内部的数据对象，不等同于 Codex 平台的 `SKILL.md`。云端可协助设计或修订 Skill；日常业务材料默认由本地模型处理。是否把某个失败案例发给云端，必须由用户明确选择。

首期场景仍限定为图文材料的提取、整合、核验与导出。工业安全、采购审批等结果由人复核；不把模型返回 `completed` 当成真实业务完成。

## 2. 初版 demo 的仓库快照和已核实状态

依据：[`docs/prompt.md`](prompt.md)、[`LocalFlow/README.md`](../LocalFlow/README.md)、[`LocalFlow/docs/DEMO.md`](../LocalFlow/docs/DEMO.md) 与源码。

| 项目 | 当前实现 |
| --- | --- |
| 交互 | React + TypeScript 通用页面；自然语言创建/修改任务、上传文件、查看进度/结果/引用、导出。见 `LocalFlow/frontend/src/main.tsx`。 |
| 云端规划 | Codex CLI 或兼容 API 生成 JSON Plan；只在创建时发送明确选中的搭建样例。见 `backend/app/cloud.py` 和 `/api/tasks/plan`。 |
| Plan 约束 | 字段、规则、`extract/reconcile/validate/export` 节点、`bundle/per_file`；Pydantic 校验结构。见 `backend/app/models.py`。 |
| 本地执行 | `executor.py` 调用 localhost 的 OpenAI 兼容模型服务；提取事实、逐实体核验、保存 issues 和 sources。`export` 节点目前只在日志中体现，实际导出由后端接口完成。 |
| 程序校验 | 类型、必填、来源 ID、文本引用子串等检查；明确包装乘法与升/毫升换算由 `Decimal` 计算。图片引用无法据此自动证明 OCR 正确。 |
| 保存（初版） | SQLite 保存任务、材料、执行记录；当时没有独立的用户习惯记忆、Skill 版本、反馈或评测数据表。第一阶段现已新增 Skill 版本、字段/问题反馈、草案试跑验收表；仍未新增自动评测数据集。 |
| 模型 | 默认公开 Qwen3.5-9B 社区 Q4_K_M GGUF + 匹配视觉投影，约 6.6 GB 文件；不是团队后训练权重。 |
| 样例 | 商品资料整合、采购规格与数量核验；另有未通过准确率验收的复杂采购条款样例。虚构材料，结果由模型现场生成。 |

需要特别注意：目前 `reconcile/validate` 对已有多行结果采用逐行 patch，**不能增减记录或改变实体身份**。因此抽取首轮若拆错或合错实体，后续节点不一定能修复。这是新 Skill 评测中必须单列的失败类型。

## 3. 本机运行可行性快照

2026-10-04 只读检查结果，动态资源数值会变化：

| 项目 | 观察 |
| --- | --- |
| 系统 | Windows 64 位，版本 `10.0.26200.0`；CPU AMD Ryzen 9 7945HX，32 逻辑处理器。 |
| GPU | NVIDIA GeForce RTX 4060 Laptop GPU，8188 MiB 显存；检查时约 7956 MiB 空闲。另有 AMD Radeon 610M。 |
| 内存/磁盘 | 物理内存约 15.19 GiB；检查时仅约 0.98 GiB 可用、负载 93%。D 盘约 61.8 GiB 可用。 |
| 开发工具 | Python 3.11.7、Node 20.16.0、npm 10.8.1、Git 可用。前端 `dist` 已有构建文件；无 `node_modules`。 |
| 当前缺口（初查） | 当时只带 macOS ARM64 的 llama.cpp 压缩包，无 Windows `llama-server`、模型、视觉投影或项目环境。下文记录随后已完成的安装。 |
| Python 环境 | 全局 Python 含主要后端库，但缺 `python-multipart`，`openpyxl` 3.0.10 低于项目要求；`pytest-asyncio` 也未就绪。运行 `python -m pytest LocalFlow\backend\tests -q` 在收集阶段因缺 `python-multipart` 中止，不能视为测试通过。 |

初查时 Windows 尚不能启动完整 demo。之后用户终端完成项目内 Conda 环境、llama.cpp CUDA 运行时、模型与视觉投影下载；代理执行环境依然无法访问外网。本机已成功加载 9B 模型并完成图文烟测、商品与采购样例；隔离环境依赖已补齐，正式 Windows 启动脚本可独立运行。细节见 `LocalFlow/docs/WINDOWS.md`。

建议的 Windows 适配顺序：

1. 增加 Windows 专用安装/启动脚本；下载并校验对应的 Windows `llama-server`，保持模型与视觉投影版本匹配。
2. 在 `LocalFlow` 内建立独立 Python 环境，按 `backend/requirements.lock` 安装；确认锁文件在 Python 3.11/Windows 可用。前端可用已有 `dist`。
3. 先启动后端、检查 `/api/status` 和界面；然后接入本地模型，跑文本与图片烟测。
4. 用小材料包跑商品和采购样例，记录真实 RAM/VRAM、延迟、结果和失败；最后再决定默认量化、上下文及 GPU 卸载参数。

第 1 项的脚本已完成，Python 编译和 PowerShell 解析通过，Windows 启动相关 8 项测试通过。第 2–4 项受网络限制和模型缺失影响尚未完成。曾尝试从 D 盘既有 Conda 环境离线克隆，但缺少缓存包；残留隔离于 `LocalFlow/runtime/failed-conda-clone`，没有视为可用环境。清理残留目录的递归删除被自动审批拒绝，后续可在允许的环境中处理。上述进度不是性能保证。

后续复查修复了 `setup-windows.ps1` 的 Conda 可执行路径调用；`conda 24.1.2` 可直接执行。完整安装进入 Conda 下载后被 `WinError 10013` / HTTP 000 阻断；Github/Hugging Face/PyPI 仍无法从该执行环境连接。已关闭 Conda 频道通知缓存以避免 C 盘写入。当前 Windows 相关与计算测试合计 17 项通过，真实模型推理仍未验收。

用户终端进一步确认其全局 BFSU Conda 频道 HTTP 403，Hugging Face 超时。安装脚本现自动探测其他 Conda/pip 来源并通过 `--override-channels` 避开全局 BFSU 配置；模型下载器增加备用地址及固定 SHA-256 校验。代理执行环境仍无法连外网，下一步应让用户终端重试安装并记录它选中的来源及后续错误。此时不要把网络探测成功等同于模型运行成功。

最终进展：用户终端已从官方 Anaconda/PyPI/GitHub/Hugging Face 完成项目内 Conda 环境、Windows CUDA 运行时、Qwen GGUF 和视觉投影下载，四个大文件通过固定摘要校验。Windows GBK 默认编码问题已修复，两套预置任务成功导入。首轮 pip 曾误用 C 盘用户级 `httpx`、`Pillow`、`h11`、`httpcore`；安装/启动脚本现设 `PYTHONNOUSERSITE=1`，并将这些同版本包及元数据复制进项目 `.conda`。隔离环境 `pip check` 通过、后端测试 65 passed、正式启动脚本及图文烟测通过。商品样例 177.19 秒完成，返回两款商品、容量冲突、功率缺失；采购样例 155.33 秒完成，返回三种物料并识别继电器同义规格和 180℃/150℃ 差异。两套结果 CSV/XLSX 导出成功。商品样例误报了部分纯格式差异，不能将 `completed` 当作业务正确。安装脚本已支持依赖齐全时离线重跑，运行期间重跑亦成功。

## 4. 用户新设想与初版 demo 的差距

| 维度 | 初版 demo（改造前） | 目标 |
| --- | --- | --- |
| 个性化 | 每个任务一份静态 Plan，可手工或经云端重写。 | 持续记录用户明确认可的偏好、步骤、例外和输出习惯，并区分个人、任务、组织范围。 |
| 行为学习 | 无操作事件、示范轨迹或习惯提炼机制。 | 从示范、人工更正、最终采用结果中提出候选习惯；用户确认后写入 Skill。 |
| 自迭代 | 失败后只能用户自己改描述/配置。 | 失败归因 → 候选修订 → 离线回放/对照 → 人审晋升 → 可回滚。 |
| 真实完成度 | `completed` 表示流程走完；有结构/来源检查，不等于结果正确。 | 对照期望输出、规则、来源和用户采用结果计算任务成功率；无法自动证明时标为待复核。 |
| 脚手架 | 通用前端、固定执行器、JSON 流程。 | 先做可配置界面与有限工具适配器；经验证后再考虑受限代码生成与沙箱执行。 |
| 模型选择 | 固定默认模型或手填 localhost 地址。 | 基于硬件测量和任务回放选择可用量化、上下文、运行参数；不只凭参数量推断。 |

关键判断：用户提出的“记忆”与“Skill”应分层。记忆存可变的用户事实和偏好；Skill 是有版本、可执行、可评测的任务契约。直接把所有操作日志追加进 prompt，容易产生冲突、泄漏和上下文膨胀，也无法可靠回滚。

## 5. 拟议架构

```text
用户描述/示范/纠错
       ↓
事件记录 → 候选习惯提炼 → 用户确认 → 分层记忆
       ↓                         ↓
   云端规划或修订 → Task Skill 草案（版本化）
                         ↓
              本地 9B + 受限工具执行
                         ↓
           结构检查 + 业务断言 + 证据核对
                         ↓
            用户复核/真实采用结果
                         ↓
             回放评测 → 晋升或回滚
```

### 5.1 Task Skill 的最小结构

建议沿用现有 `Plan`，外包一层 `TaskSkill`，避免一开始重做执行器。建议字段：

```json
{
  "skill_id": "uuid",
  "version": 3,
  "status": "draft|active|retired",
  "owner_scope": "user|team",
  "task_intent": "一句话定义任务",
  "plan": "现有 Plan JSON",
  "input_contract": "文件类型、分组规则、上限、必需材料",
  "output_contract": "字段、格式、空值与冲突规则",
  "preferences": "用户确认的排序、措辞、模板和例外",
  "validators": "可执行的白名单断言及参数",
  "examples": "经许可保存的输入、期望输出、反例引用",
  "abstention_policy": "证据不足时留空或请求复核",
  "provenance": "创建方式、依据、父版本、评测报告",
  "created_at": "时间戳"
}
```

`validators` 首期只允许内置操作，如必填、唯一键、行数/实体一致、字段来源、枚举、数值范围、单位换算、用户指定的词典映射；不执行模型生成的任意 Python、shell 或 JS。Task Skill 的每个执行记录都要固定引用其版本和模型版本，保证可复现。

### 5.2 记忆与示范

- **用户偏好**：输出列顺序、文件命名、报告措辞、冲突如何展示；来源为明确设置或用户确认的纠错。
- **任务知识**：该任务适用的术语词典、实体匹配键、样例和例外；不能无条件跨任务复用。
- **操作习惯候选**：记录用户在界面中的有意义操作与修改，例如“总是把功率缺失标成待补充”。先作为候选，展示“我观察到的规则”和具体例子，确认后才进入 active Skill。
- **执行经验**：每次运行的输入摘要、Skill/模型版本、输出、自动检查、用户纠错和最终采用状态。原始材料本地保存；上云修订时只传用户选中的最小必要样例。
- **覆盖优先级**：当前用户显式指令 > 当前任务 active Skill > 用户默认偏好 > 历史习惯候选。冲突时提示，不静默覆盖。

不建议首期自动录制整台电脑的操作。先从 LocalFlow 内的上传、字段修改、复核与导出行为获取高质量反馈；如将来加入外部应用操作，须明确范围、权限、失败恢复和审计。

### 5.3 何谓“真实完成”

设置五层可观察信号，不能用模型自评代替事实：

1. **运行成功**：请求完成、JSON 合规、无程序异常。仅代表技术通路正常。
2. **结构正确**：行数、实体对应、类型、必填、格式与导出可用。
3. **证据充分**：关键字段有可定位引用；文本精确比对、图片由用户或更强 OCR/视觉校验器复核。
4. **业务正确**：与人工标注的期望输出和业务断言对照；逐实体、逐字段算误报/漏报。
5. **用户接受**：用户保留或修改结果、是否完成后续工作。它是重要反馈，但“用户未修改”不能自动视为正确。

对每次运行记录 `pass/fail/needs_review/unknown`，以及失败原因：OCR/转录、实体关联、规则适用、计算、来源、格式、超预算等。材料或规则不足时以待复核结束，不能强迫模型输出肯定答案。

### 5.4 安全的自迭代闭环

1. 收集失败与人工更正，生成**候选修改**；保留原始证据和父版本。
2. 修订器只改 Task Skill 的白名单字段，说明“改了什么、依据哪个案例、预计解决哪类错误”。
3. 用固定回放集比较当前 active 与候选版本。包括失败案例、正常案例、边界案例和未参与修订的保留集；同一个案子的近重复文件不得跨训练/评测集合。
4. 评测优先级：致命错误数、实体关联正确率、关键字段准确率、漏检/误报、人工复核率、时延与资源。门槛由场景负责人定义；不以单次样例通过作为自动晋升条件。
5. 先在影子模式运行候选版；满足门槛且用户/管理员确认后晋升。保留一键回滚，历史运行继续指向旧版本。
6. 数据积累达到规模后，可把匿名/获授权样例用于模型后训练；这是独立于 Skill 修订的更慢循环，必须与当前公开基线的评测分开。

首期不要做“每次失败立刻自动改 active Skill”。小样本容易过拟合，单次用户改动也可能是特例。

## 6. 推荐迭代顺序与验收

### P0：Windows 可重复运行与基线

- 完成 Windows 安装/启动适配、依赖隔离、Windows llama.cpp 与权重校验。
- 记录本机文本、图片、商品、采购任务的实际耗时、内存峰值、结果；若不稳定，测较小上下文和部分 GPU 卸载。
- 在现有 `verify-demo.py` 之外建立人工标注的逐字段期望输出，覆盖实体合并错误和复杂采购条款漏检。
- **验收**：重新打开应用后可复用任务；两套主样例能够执行并导出；错误与资源数据可复现。准确率单独报告，不被“执行完成”掩盖。

### P1：反馈、版本与评测闭环（建议第一个产品增量）

- 新增 Skill 版本表、运行版本快照、事件/纠错/人工验收表；迁移现有任务为 v1。
- UI 支持逐字段“接受/改正/无法判断”，要求更正时选择原文依据或说明。
- 本地评测器回放标注案例，生成版本差异报告和失败分类。
- **验收**：同一批案例能比较 v1/v2；用户更正不会改写历史记录；可撤销新版本并恢复旧行为。

### P2：习惯候选与受控自迭代

- 从重复且一致的纠错中生成候选偏好或规则；用户确认后写入 Task Skill。
- 云端修订仅接收用户选择的样例和脱敏后的必要摘要；修订结果先进入 draft。
- 保留集回放、影子运行、人工晋升与回滚形成闭环。
- **验收**：至少一种真实用户偏好（如列顺序）和一种业务纠错（如实体匹配规则）能改善目标案例，且不使保留集退化。

### P3：有限工具与部署自适应

- 把转换、查表、外部读写等做成声明式、权限受控的适配器；先实现确定性功能，不引入任意代码执行。
- 基于设备实测和任务回放记录选择量化、上下文、GPU 卸载与批大小；报告相同案例的质量/时延/内存权衡。
- 只有当任务需要且评测证明确有收益时，再考虑自动生成专用界面或更开放的脚手架。

## 7. 下一位 Agent 的具体起点

1. 先读本文件及 `LocalFlow/README.md`、`backend/app/{models,cloud,executor,store,main,skills}.py`、`frontend/src/main.tsx`、`samples/starter-plans.json`。当前首要未完成项：在可访问 npm 的终端运行 `cd LocalFlow/frontend; npm.cmd ci --cache ..\runtime\npm-cache --no-audit --no-fund`，再从 `LocalFlow` 运行 `setup-windows.ps1 -SkipModel`，确认 `npm run build` 产物为新版，并做页面验收。代理终端访问 npm tarball 返回 EACCES，当前 `dist` 是旧版；启动脚本会拒绝旧版。
2. 不要把公开 Qwen3.5-9B 基线写成团队自训模型；模型替换必须有权重、projector、版本和回放结果。
3. P0 Windows 运行已通过；下一步为两套样例建立人工逐字段标注、评估误报及复杂采购条款，并记录资源峰值。当前机器内存紧张；8GB 显存上的图文烟测及 8K 样例通过，不代表 16K 多图任务稳定。
4. P1 的 Skill 版本、字段/问题反馈、人工试跑验收和回滚已做第一版，但未做自动回放评测。后续应保留 API 兼容性，补齐 `model_id`、运行参数、评测结果及结构化迁移；现有运行记录已经锁定 `skill_version` 和 Plan 快照。
5. 修复或明确限制当前 `reconcile` 不能改变行数的行为，否则“首轮提取拆错实体”无法通过后续 Skill 规则可靠纠正。
6. 配置用户自己的 DeepSeek Key 后，先通过界面“测试云端连接”做真实小请求，再用图文样例创建任务和反馈生成草案；当前 MockTransport 测试不能证明真实 API 的 JSON/视觉兼容。任何“自迭代提高成功率”的结论都必须有前后版本、固定回放集、保留集和人工核验结果；不要只展示单个成功样例。

待产品决策：是否允许上传失败样例到云端、个人与团队规则如何继承、各场景的晋升门槛和人工复核责任人、是否需要应用外操作记录。这些不妨碍先完成 P0/P1。
