# 照片生成 3D 图解

本改动基于 main `56c876d`，仅接入 3D 图解。对话、plan、步骤确认、实时视频分析、展示资料及其导入方式沿用原实现。

云端模型结构正常但形状不满意时，也可在本组件点击「改用本地模型」；`local_only=true` 不会再提交云端收费任务。此选项仅影响当前图解，不修改其他 AI 配置。

## 使用

在物品的当前教学步骤点击原有「3D 图解」。有照片时，组件通过原 `/api/tasks/{id}/diagram` 请求外观模型，优先调用百炼 `Tripo/Tripo-H3.1`。云端请求失败、任务失败、等待超时、下载失败或 GLB 结构检查失败时，改用本地 Hunyuan3D mini。两者都不可用时返回明确错误，保留原教学步骤。

生成目标为约 50 万三角面。混元采用已在 8GB NVIDIA GPU 上测试的 FP16、384 几何分辨率、50 步设置，逐张量加载以减少内存峰值。本次集成的本地回退仅生成几何，无纹理；与此前独立实验的额外纹理阶段有区别。云端使用 standard 纹理。云端结构有效不代表形状、按键或接口真实准确，组件会明确提示核对实物。

拖动旋转、滚轮缩放。「定位当前操作处」把当前 3D 渲染图和已选实拍交给现有百炼视觉模型，复用 `camera_guidance.Grounding` 和唯一候选、置信门槛检查；坐标只在生成模型的渲染图上返回，再从同一相机投射到网格。看不清、多个候选、坐标未落到表面时不画指示点，可旋转后重试或核对实拍。没有修改实时视频分析模块。显示模型和定位不会完成任务或推进步骤，原来的确认按钮及业务 writer 保持原样。

几何只由第一张选中照片生成，第二张可作为定位参考，不是多视图融合。无照片时原有经过校核的简图仍可查看；生成外观模型会提示先补充照片。旧调用方不传 `use_model` 时保留原有接口行为；新版 3D 组件传 `use_model=true`。

## 本机配置

百炼沿用应用 `.env` 的 `DASHSCOPE_API_KEY`，可选 `DASHSCOPE_WORKSPACE_ID` 或 3D 专用 `WUJIAN_3D_HTTP_BASE_URL`。配置项仅影响 3D；不会更换主对话模型。

在当前已安装模型的 Windows 机器上，可在独立检出目录的 `.env` 增加：

```dotenv
WUJIAN_3D_LOCAL_HOME=D:/Project/Tianmao/ProductAgent/experiments/local_3d
WUJIAN_3D_LOCAL_PYTHON=D:/Project/Tianmao/ProductAgent/experiments/local_3d/envs/hunyuan3d/python.exe
WUJIAN_3D_CACHE_DIR=D:/Project/Tianmao/ProductAgent/var/model-generation
```

`LOCAL_HOME` 必须包含：

- `repos/Hunyuan3D-2/`：上游推理代码。
- `models/hunyuan-mini/hunyuan3d-dit-v2-mini/`：完整 fp16 权重及配置。
- `cache/u2net/u2netp.onnx`：处理普通不透明照片的背景分离模型。
- 独立 Hunyuan 环境：PyTorch CUDA、accelerate、safetensors、trimesh、pymeshlab、onnxruntime 等现有推理依赖。

其他机器需先按上游安装相应环境及模型，再设置路径。应用主环境不导入 PyTorch，不会在启动时自动安装、下载权重、开通服务或修改分页文件。worker 的下载缓存、临时目录、CUDA 缓存都位于 `LOCAL_HOME`。本地回退需要 NVIDIA CUDA，Intel 笔记本 NPU 不支持此 worker；云端生成不受本机 NPU 型号限制。

干净展示资料仍按 `demo/showcase/README.md` 安装。使用 `WUJIAN_DATA_DIR=var-showcase` 可与旧库隔离，无需删除数据库。本功能不修改展示样本。

## 任务恢复与边界

缓存按用户、照片内容及生成参数隔离。同一输入保存云端任务号，轮询超时会保留原任务；提交结果未知时不自动重发收费 POST。失败后成功生成的本地模型也会缓存，打开和重试页面不会重复收费。源图或参数改变后才生成新的请求。结构检查拒绝截断文件、缺少几何、外链资源和不支持的压缩网格；不冒充语义质量验收。

本地 GPU 请求用跨进程锁排队，避免两个模型同时占满 8GB。每个 worker 有超时。所有推理在独立进程运行，不占用应用的 Python/GPU依赖，调用完成后退出释放资源。

新增模型仍通过原 `Asset` 和 `/api/assets/{id}` 存取。生成与定位前后均校验任务发起者、版本、当前步骤、实物和资料访问权。生成结果经原 `foundation.save_task` 保存；不新增第二套任务或业务数据库。不提交照片、GLB、模型权重、密钥、日志和私有回执。

## 验证

离线生成测试：`python -m unittest discover -s tests -p test_model_generation.py -v`，不调用付费模型或真实设备。

完整回归沿用 `python -m unittest discover -s tests -v`。契约从 Pydantic 导出：`python -m wujian openapi contracts/openapi.json`，然后在 frontend 执行 `npm run types` 和 `npm run build`。

真实执行和输出质量须另行确认。特别是百炼任务可能返回「产品未开通」：系统会保留原任务号并转本地，不能将已有配置或历史成功视为当前云端正常的证据。
