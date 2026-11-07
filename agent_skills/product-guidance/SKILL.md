---
name: product-guidance
description: 根据当前物品、真实资料和反馈回答使用疑问，建立可接续的逐步骤图文带做，或调整失败分支。简单事实解释无须创建任务。
---

先确认本轮物品与目标；旧任务只有匹配时才接续。首次陌生型号或资料查证按product-research方法处理；已有可靠认识直接复用。说明通用建议、适用原文和用户实际报告的区别，不猜接口、控件、精确时序、参数或隐藏结构。

根据自然语言选assistance_mode：简单解释answer，核验资料research，用户要分步操作或持续带做teach。teach首次建立同一TaskRecord：continuation.plan用interaction/1、kind=guidance，target_item_ids与每步item_id对应当前物品。资料不足先给identify/observe准备步骤，不能只输出一篇编号文章。

初次用guidance.overview列简短路线，总览只说明阶段目标。entries只放当前已有依据的一两步，包含稳定id、title、group=step、state=pending与guidance的kind、instruction、basis、success_signal、target_label。basis=document需要适用原句/行号、来源和页码；basis=general仅用于不依赖型号的观察和初步帮助。旧任务只提交本轮变化，保持task_id和expected_version。不要把所有待核验动作提前当成可执行步骤。

已知型号的operate必须有匹配原文或用户实际报告依据；不能把型号操作换标general。没有适用教程时，先observe核对目前通电现象、可见文字或用户遇到的位置，仍可建立总览和图文辅助。指示灯形状、颜色、语音回执和长按分支也需要依据；自然语言回答不能添加步骤之外的控件或动作。

每轮解释一个动作、要看见什么和没出现时如何反馈。当前反馈失败或用户没看懂时，先回应具体困难，留在该步或改成观察检查，不能复读旧文、替用户完成或跳到重置拆卸。自然反馈的feedback_quote与observed_quote保留本轮用户连续原话；疑问、假设、打算、画面定位和模型建议不是实际完成。单步做过不等于整个问题解决。

提交guidance变化时，具体回复由本轮通过依据检查的当前步骤呈现，answer简短即可，不生成步骤外的另一篇操作文。解释原理或普通补问可以continuation=null；明确“没找到、没反应、别跳步”时提交同一任务的观察检查变化。不能用“通常有”替用户补出未显示的控件。

按需用同一步的实拍标注、手册图、3D简图或相机定位辅助理解。图片和来源与当前item_id、step_id一致；看不见控件就保留未知，不虚构坐标与内部结构。3D和位置追踪不证明实际操作成功。用户可暂停、恢复或换物，原进度保留。

重要的已核验能力写learning.knowledge_updates，型号共性归product、实例状态归item；保留适用条件、未知项、连续原文或source_line_start/source_line_end。用户纠正带supersedes_id。没有新增可靠事实则留空，不为收集字段拖延回答。
