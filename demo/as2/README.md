# AS2 可复现演示资产

本目录按项目负责人 2026-11-06 的明确要求发布，用于下载当前 feature 分支后复现 AS2 教学。它是私人媒体不入库规则的限定例外。

| 路径 | 内容及用途 |
|---|---|
| `media/pic/1.jpg`–`5.jpg` | 用户提供的实拍；原像素与方向标记保留，已检查无 GPS 元数据。第 1、5 张用于物品名片和控件裁图，其余用于人工核对外观 |
| `media/pic/movie.mp4` | 18.23 秒实拍外观视频，H.264/yuv420p；删除音轨与原容器元数据，供浏览器自动定位/追踪演示 |
| `manual/AS2-HPA01-CN.pdf` | LOKLiK 官方中国大陆 HPA01 手册，原始 PDF；其文字是转曲，不能冒充已抽取的完整文本 |
| `prepared/*.jpg` | 已按原实拍 SHA 校准的控件区、显示屏和机器前部裁图 |
| `prepared/manual-3.png`、`manual-4.png` | 对应官方 PDF 页的渲染图 |
| `prepared/as2-reference.png` | 首帧控制面参考图；每一帧仍需实际做 ORB/RANSAC 匹配，不是保存的视频运动轨迹 |
| `walkthrough.mp4` | 约 1分58秒的原版软件交互录像，完成反馈为模拟输入，没有实体开机/压烫；当前默认整机 3D、自适应材料分支是录制后的修复 |
| `manifest.json` | 文件大小、SHA256、运行所需角色、参考坐标及官方来源 |

3D 外观、教学动作和渲染器以仓库源码的形式提供，不需要额外导出一个模型文件：

- [外观几何](../../fixtures/teaching/loklik-as2-model.json)
- [教学数据包](../../fixtures/teaching/loklik-as2.json)
- [3D 渲染入口](../../frontend/src/features/TeachingDiagram.tsx)
- [安装与启动步骤](../../README.md#队友首次安装)

所有媒体都是普通 Git 文件，无 Git LFS 指针。启动会校验 14 个二进制资产的摘要；无需 FFmpeg、视频转码服务或外网下载手册。依赖首次安装和云问答仍需要网络。

实拍由项目负责人提供并授权纳入演示分支。官方手册、商标与产品外观的权利仍属于 LOKLiK；手册只作为型号核验资料，未声明转授项目代码许可证。[官方下载页](https://www.loklik.cn/files-download/)，实际下载 URL 与文件摘要见 manifest。Bygga、OpenCV/ViTTrack、ONNX Runtime、Three.js 的代码/模型许可证随各自来源保留。

没有提交 `.env`、API Key、会话密钥、私人数据库、对话记录、模型运行日志、Python/Node 环境或可选的约 480 MB MiniLM 权重。数据库与本地会话在启动时生成；MiniLM 可按固定版本另行下载。
