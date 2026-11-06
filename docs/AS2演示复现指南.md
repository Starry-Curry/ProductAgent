# AS2 演示复现指南

对应 `feat/as2-adaptive-lessons`。下载该分支即可获得演示所需实拍、静音视频、手册页、完整录像、3D 几何、渲染器与追踪小模型。不能用 main/develop 的旧文件替代本分支资源。

## 1. 环境与首次启动

需要 Git、Python 3.11+（本轮验证使用 3.12）、uv、Node.js/npm（Vite 要求 Node 20.19+ 或 22.12+ 的受支持版本）。核心演示不要求 Intel/NVIDIA GPU、OpenVINO 或 FFmpeg；首次安装依赖需要访问 Python/npm 包源。

```powershell
git clone --branch feat/as2-adaptive-lessons --single-branch https://github.com/Starry-Curry/ProductAgent.git
cd ProductAgent
Copy-Item .env.example .env
```

只在本机编辑 `.env`，填写自己的 `DASHSCOPE_API_KEY`。Key 需要能访问所配置地域的 `qwen3.6-plus`、`qwen3-vl-plus` 和问答所用搜索/embedding 服务；收费使用自己的阿里云账号，不提供共享密钥。若账号配置不同，修改 `DASHSCOPE_BASE_URL`、`QWEN_MODEL` 等即可，不修改源码。

```powershell
.\demo.ps1
# 默认 PyPI 域名无法连接时，可指定镜像；运行时版本与 SHA256 仍取自同一 uv.lock：
.\demo.ps1 -PythonIndex https://mirrors.aliyun.com/pypi/simple
```

脚本默认依次执行 `uv sync --frozen`、`npm --prefix frontend ci`、前端生产构建，然后校验本地资产、生成独立 SQLite 档案和第一步教学，再启动 `127.0.0.1:8021`。指定 PythonIndex 时，从同一锁文件导出带哈希的运行时依赖，用 `uv pip install --require-hashes` 通过镜像安装；本地项目按 pyproject 构建依赖安装，锁文件不改写。如 PowerShell 执行策略阻止本地脚本，可直接按下面的 Python/Node 命令启动；不需要修改整台电脑的执行策略。

终端会打印带实际 task ID 的链接。页面选择“**小林的物间**”，然后打开打印的链接。不要复制其他机器旧的 task ID。

安装完成后的快速启动：

```powershell
.\demo.ps1 -SkipInstall
# 端口占用时换一个，脚本不会结束已有服务：
.\demo.ps1 -SkipInstall -Port 8024
# 保留旧对话，追加一份从第一步开始的新教学：
.\demo.ps1 -SkipInstall -NewSession
```

## 2. 手动启动与无 Key 的资产预览

```powershell
uv sync --frozen
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run build
.venv\Scripts\python.exe scripts/run_as2_demo.py --port 8021
```

macOS/Linux 可用相同命令，Python 路径改成 `.venv/bin/python`，npm 去掉 `.cmd`。本轮只在 Windows 验证，未声称完成其他系统实测。

```powershell
# 不使用任何云 Key，只查看已准备好的第一步、照片、手册、3D、参考视频：
.\demo.ps1 -Offline
# 只生成数据库与第一步、不启动服务器，便于部署前检查：
.venv\Scripts\python.exe scripts/run_as2_demo.py --offline --prepare-only --data-dir tmp/as2-preflight
```

无 Key 模式仅为**资产预览**：自由问答、自然语言确认和步骤完成 API 会明确提示配置 Key，不会播放伪造的模型回复。参考图匹配可本地运行；匹配失败时云端重定位不可用。也可以直接播放 [`walkthrough.mp4`](../demo/as2/walkthrough.mp4) 看原版完整流程。

## 3. 建议的展示流程

1. 第一屏先看电源键的实拍箭头和说明书原页。打开“3D 图解”，可以拖动整机和切换“看操作处”。
2. 打开“相机辅助”，使用内置 AS2 实拍视频；它自动寻找控件，不需要逐帧点击识别。视频只有外观拍摄，不能证明按键已按下。
3. 用户确认第一步完成后才进入材料核对。可以自然输入“衣服和塑料的片片，具体参数我不是很清楚”；系统应解释并保持待核对，不复读原话、不默认它就是刻字膜。
4. 说明“包装写普通刻字膜”，可按手册对应预置继续；也可报告包装上的非预置条件，系统保存实际参数并核对屏幕。参数例子只检验软件输入处理，不代表对任意材料的热压建议。
5. 说“没看懂”“还没找到”应继续解释/补充核对；说“暂停”“继续教学”可保留进度。每次明确确认只推进当前一步。
6. 继续模拟完整软件流程时，明确说明完成反馈为演示输入；实物是否达到温度、压板是否升起、作品是否成功，仍由现场观察确认。

## 4. 测试其他物品

在“物品”中记录真实物品、品牌/型号或照片，再从名片问阿圆；或直接在物伴提问并说明是哪件物品。没有 AS2 数据包的物品走通用 Agent 问答、资料搜索与动态 plan，不会自动套 AS2 的 12 步或使用它的图片。

普通问答可不创建计划。明确要求“陪我一步步排查”时生成当前操作与观察点；反馈进入同一任务。其他物品的自动 3D 是 Qwen 生成的有界简图，其外观质量、关节运动与定位准确率未经过 AS2 同级校核。遇到没有可读资料/目标不可见，应该保留未知，不能用演示资产代替真实结果。

## 5. 目录、校验与恢复

| 位置 | 内容 |
|---|---|
| `demo/as2/` | 已发布的静态演示资产及 SHA256 清单 |
| `fixtures/teaching/loklik-as2*.json` | 教程、审核几何、裁图校准与参考坐标 |
| `var/as2-demo/wujian.sqlite3` | 启动后新生成的业务库，不提交 Git |
| `var/as2-demo/assets/` | 从公开演示包注册到本地的资产副本与后续上传 |
| `var/as2-demo/as2-launch.json` | 当前演示任务链接；重启默认接续它 |
| `var/as2-demo/session.key` | 本机生成的会话密钥，不提交 |

使用 `--data-dir 新目录` 可以做隔离演示。脚本为演示目录构造独立 SQLite，不复用 `.env` 中其他数据库的 URL。已有数据库不删除、不清空；`--new-session` 只追加新教学。旧版 8020 展示目录不受影响。

默认使用包内预渲染图片和静音 H.264 视频，**不需要** `D:\Project\Tianmao`、本机旧 UUID、原 HEVC 解码器、FFmpeg 或临时 outputs。传统自备媒体流程仍支持：

```powershell
.venv\Scripts\python.exe scripts/seed_as2_demo.py --data-dir var/as2-custom --media-dir 你的媒体目录 --manual 你的原手册.pdf --clean-profile
```

自备路径仍要求同一 AS2 媒体结构与校核版本；它不是任意物品的自动教程生成器。不同内容不能沿用 AS2 的手工标注坐标。

## 6. Intel NPU 可选部署

浏览器 ORB/LK 和当前 WASM ViTTrack 使用 CPU。默认演示不声称使用 NPU。需要本地 AI 的比赛机器可另行准备：

```powershell
uv sync --frozen --extra intel
.venv\Scripts\python.exe scripts/local_ai.py download
.venv\Scripts\python.exe scripts/local_ai.py probe --device NPU --require-accelerator --seconds 30 --output tmp/npu-proof.json
$env:WUJIAN_LOCAL_EMBEDDING_DIR=(Resolve-Path var/models/multilingual-minilm).Path
$env:WUJIAN_LOCAL_AI_DEVICE='NPU'
$env:WUJIAN_LOCAL_AI_REQUIRED='true'
.\demo.ps1 -SkipInstall
```

检查目标机器任务管理器 NPU 图和真实 `EXECUTION_DEVICES` 回执。首次模型下载约 480 MB，权重不在核心演示包中；固定来源与校验见 `scripts/local_ai.py`。未验证的 NPU 或偷偷回退 CPU 不计为成功。详见[技术架构](讲解答疑模块技术架构与工作流.md)。
