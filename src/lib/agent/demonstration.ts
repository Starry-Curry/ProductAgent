import type { Item } from "../domain.ts";
import type { AssistantReply } from "./contracts.ts";
import { washerGuide } from "../companion/visual-guide.ts";
/** Answers for the explicitly enabled demonstration, never evidence receipts. */
export function demonstrationAnswer(
  question: string,
  item?: Item,
  raw?: string,
): AssistantReply {
  const stopped =
    item?.availability === "broken" || /损坏|暂停|维修/.test(item?.state || "");
  const dangerous =
    /短接|带电.{0,8}拆|冒烟|漏电|烧焦|电池.{0,8}加热|拆开.{0,8}电池/.test(
      question,
    );
  let answer = "可以，我们先把这件事分成几步来做。",
    steps: string[] = [],
    modelUsed = false;
  if (stopped || dangerous) {
    answer = "先暂停使用这件设备，我帮你把后续处理接起来。";
    steps = [
      "断开设备电源，先不要继续尝试使用。",
      "记下当前现象和已尝试的方法，在“报告问题”里交给家人处理。",
      "打开“售后入口”，把问题说明复制给卖家。",
    ];
  } else {
    let packet: any;
    try {
      packet = raw ? JSON.parse(raw) : null;
    } catch {
      packet = null;
    }
    const text = typeof packet?.answer === "string" ? packet.answer : "";
    const candidate = (Array.isArray(packet?.steps) ? packet.steps : [])
      .map((s: any) => (typeof s?.text === "string" ? s.text : ""))
      .filter(Boolean)
      .slice(0, 8);
    const bad =
      /品牌和具体型号|提供.{0,12}型号|型号是什么|资料不足|没有足够|我(?:已|已经).{0,8}(?:通知|购买|修好|检测)|短接|带电.{0,8}拆/;
    if (
      raw &&
      packet &&
      !bad.test([text, ...candidate].join(" ")) &&
      (candidate.length ||
        (/general|supported/.test(packet.kind || "") && text.length > 8))
    ) {
      answer = text || answer;
      steps = candidate;
      modelUsed = true;
    } else if (/野餐|露营|出游|活动|聚会|旅行/.test(question)) {
      answer = "可以，先给你一份便于演示和调整的准备方案。";
      steps = [
        "先确定人数、地点和出发日期。",
        "准备饮用水、餐食、餐盒、野餐垫、纸巾和垃圾袋。",
        "到“活动准备”里核对家里已有的物品，把缺少的项目分给同行的人。",
      ];
    } else if (/加好友|好友列表|朋友编号/.test(question)) {
      answer = "打开左侧“朋友”，就可以添加和查看好友。";
      steps = [
        "点击“加好友”，输入朋友的好友编号并查找。",
        "点“发送好友申请”，由对方在好友申请中通过。",
        "通过后，朋友会显示在“我的好友”列表中。",
      ];
    } else if (
      /洗衣机|洗衣|衣物|衣服/.test(question + " " + item?.name) &&
      !/故障|坏了|漏水|不工作|不启动|不亮|打不开|不能用|清洁|清洗机器|清洗洗衣机|保养/.test(
        question,
      )
    ) {
      answer = "可以，先按常见滚筒洗衣机演示，下面也可以点“看图跟着做”。";
      steps = washerGuide.map((s) => s.text);
    } else if (/清洗|清洁|保养|水垢/.test(question)) {
      answer = "可以，先按同类物品常见的清洁方式演示。";
      steps = [
        "电器先断电，等表面冷却后再清洁。",
        "先用柔软的布清理外壳，把电气接口和主机保持干燥。",
        "可拆部件与滤芯先单独查看说明，再决定擦拭、冲洗或更换。",
      ];
    } else if (/故障|坏了|不工作|不亮|打不开|不能用/.test(question)) {
      answer = "先从最容易确认的地方排查，我陪你往下看。";
      steps = [
        "检查电源、开关和可见的连接是否到位。",
        "记下屏幕或指示灯显示的提示。",
        "如果仍不能使用，点“报告问题”创建待办，再从“售后入口”整理给卖家。",
      ];
    } else if (/充电|电量|电池/.test(question)) {
      answer = "先区分可充电设备和更换电池的设备，再按对应方式处理。";
      steps = [
        "查看电池仓或充电接口；有可更换电池的设备按标识更换电池。",
        "可充电设备使用配套充电线和适配器连接。",
        "留意充电指示，充电过程中先暂停使用，完成后再断开。",
      ];
    } else if (/蓝牙|配对|连接手机/.test(question)) {
      answer = "可以，先按常见蓝牙设备的连接流程演示。";
      steps = [
        "开启设备，进入蓝牙配对状态。",
        "打开手机的蓝牙设置，在附近设备列表中选择它的名称。",
        "连接后试着播放一段声音；不成功时断开重连一次。",
      ];
    } else if (
      /相机|拍照|拍摄/.test(question) ||
      (item?.category === "电子设备" && /相机/.test(item.name))
    ) {
      answer = "先拍一张简单的照片，熟悉最常用的操作。";
      steps = [
        "开机后选择自动拍摄模式，握稳相机并构图。",
        "半按快门完成对焦，再完全按下快门拍摄。",
        "在回放中查看照片，再调整取景或光线。",
      ];
    } else if (/日期|待办|垃圾袋|分工|提醒/.test(question)) {
      answer = "可以把这件事记成一条有日期和负责人的待办。";
      steps = [
        "打开“家人交代的事”，点“记一件事”。",
        "写下要做的事情，选择负责人和待办日期。",
        "保存后可以改日期、开始处理或确认完成；提醒知晓和任务完成分别记录。",
      ];
    } else if (/难过|心情|孤独|不开心|陪我|烦恼/.test(question)) {
      answer = "我在。今天先不用急着把所有事情解决，我们可以从一件小事开始。";
      steps = [
        "先把最困扰你的那件事用一句话说出来。",
        "给自己留一点休息的时间，或者找一件有好回忆的物品记一段。",
      ];
    } else if (/水壶|烧水|煮水/.test(question + " " + item?.name)) {
      answer = "可以，先按常见电热水壶的使用流程演示。";
      steps = [
        "把水壶从底座取下，加清水到最低和最高刻度之间。",
        "盖好壶盖，擦干壶底，放回配套底座。",
        "接通电源并开启加热，等自动停止后再倒水。",
      ];
    } else if (item) {
      answer = `可以，先从${item.name}的日常使用开始。`;
      steps = [
        "检查设备是否放稳、外观是否完整，确认电源或电池已准备好。",
        "使用面板上标识清楚的开关和基础模式，先完成一次最简单的操作。",
        "观察实际显示或指示灯，再接着问我；需要家人处理时可记录成待办。",
      ];
    } else {
      steps = [
        "先说清楚希望完成的结果。",
        "把事情拆成准备、执行和检查三个小步骤，从最容易的一步开始。",
        "涉及物品时可以点“拍一下”，涉及分工时可以直接记成待办。",
      ];
    }
  }
  return {
    outcome: "answered",
    answer,
    steps: steps.map((text, i) => ({
      id: `demo:${i}:${text.slice(0, 20)}`,
      text,
    })),
    questions: [],
    source: modelUsed ? "model-general" : "local-dialogue",
    citations: [],
    evidenceIds: [],
    memoryIds: [],
    demonstration: true,
    caveat:
      "演示建议：部分内容按同类物品的一般用法组织，未逐条核对具体型号；可继续追问。",
  };
}
