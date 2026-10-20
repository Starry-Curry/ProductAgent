import type { KnowledgeChunk } from "./acquisition.ts";
export const taskPhases = [
  "prepare",
  "start",
  "configure",
  "operate",
  "finish",
  "care",
] as const;
export type TaskPhase = (typeof taskPhases)[number];
export const phaseLabels: Record<TaskPhase, string> = {
  prepare: "检查与准备",
  start: "开机",
  configure: "设置",
  operate: "实际使用",
  finish: "结束处理",
  care: "清洁养护",
};
const markers: Record<TaskPhase, RegExp> = {
  prepare:
    /before first use|preparation|before use|准备|首次|第一次|assembly|组装/i,
  start: /turn.*on|switch.*on|power button|开启|开机|电源键/i,
  configure: /select|set the|adjust|temperature|time|选择|设置|调节|温度|时长/i,
  operate:
    /starting a cooking|cook|insert|place.*basket|press|使用|操作|烹饪|放入|按下/i,
  finish: /after.*cook|finished|complete|unplug|cool down|结束|完成|拔下|冷却/i,
  care: /clean|maintenance|wash|清洁|洗涤|清洗|保养|养护/i,
};
export function evidenceRoles(text: string) {
  return [
    ...taskPhases.filter((p) => markers[p].test(text)),
    ...(/warning|caution|do not|禁止|警告|切勿/i.test(text)
      ? ["restriction"]
      : []),
  ];
}
export function wholeTask(question: string) {
  return (
    /第一次|首次|从准备|完整|全过程/.test(question) &&
    /怎么用|如何使用|带我|烹饪|开始|完成|使用/.test(question)
  );
}
/** Coverage denotes document topic availability, not proof that an instruction is entailed. */
export function taskEvidence(
  evidence: KnowledgeChunk[],
  question: string,
  itemName = "",
) {
  const full = wholeTask(question);
  const goal = question + " " + itemName;
  const cooking = /烹饪|炸锅|做饭|做菜|air fryer/i.test(goal);
  const required: readonly TaskPhase[] = /烹饪|炸锅|做饭|做菜|air fryer/i.test(
    goal,
  )
    ? taskPhases
    : /组装|拼搭|安装/.test(goal)
      ? ["prepare", "operate", "finish"]
      : /充电/.test(goal)
        ? ["prepare", "start", "finish"]
        : ["prepare", "operate", "care"];
  const checklist =
    full && cooking
      ? [
          {
            id: "initial-clean",
            label:
              "首次清洁（采用同型号清洁章并保留断电/冷却/禁浸泡条件；不得编造专属要求）",
            pattern: /clean|wash|清洁|清洗/i,
          },
          {
            id: "initial",
            label:
              "首次使用专属准备（含初次设置/除味等原文要求；首次清洁若无专门说明须标缺口）",
            pattern: /first use|first time|首次|第一次/i,
          },
          {
            id: "load",
            label: "准备可拆部件并放入食材，先后条件不得省略",
            pattern: /add ingredients|place the frying|放入食材|加入食材/i,
          },
          {
            id: "program",
            label: "选择程序与设置，确认后启动；不自拟食谱参数",
            pattern: /cooking program|preset recipe|cooking time|烹饪程序/i,
          },
          {
            id: "end",
            label: "烹饪结束及后续清洁处理",
            pattern: /cooking.*completed|unplug|cleaning|烹饪完成|清洁/i,
          },
        ].map(({ pattern, ...f }) => ({
          ...f,
          sourceIds: evidence
            .filter((e) => pattern.test(e.text))
            .map((e) => e.id),
        }))
      : [];
  return {
    full,
    cooking,
    checklist,
    requiredPhases: full ? required : [],
    phaseLabels,
    available: taskPhases.map((phase) => ({
      phase,
      sourceIds: evidence
        .filter((e) => evidenceRoles(e.text).includes(phase))
        .map((e) => e.id),
    })),
    policy:
      "按资料说明组织可执行指导，checklist逐项覆盖。首次清洁可引用同型号清洁章前置执行并保留断电/冷却等限制，说明不是首次专属条款。食材/份量不明不得自拟参数；参数选择列为待确认条件。标签覆盖不是证明；用户报告完成不等于设备验证。",
  };
}
/** Balance retrieval across a full lifecycle instead of returning only high-scoring first-use paragraphs. */
export function selectTaskEvidence(
  chunks: KnowledgeChunk[],
  question: string,
  fallback: KnowledgeChunk[],
) {
  if (!wholeTask(question)) return fallback;
  const selected: KnowledgeChunk[] = [];
  for (const phase of taskEvidence(chunks, question).requiredPhases) {
    const anchors: Record<TaskPhase, RegExp> = {
      prepare: /before first use|preparation|准备/i,
      start: /turning on|power on|开机/i,
      configure: /control knob|setting|设置|调节/i,
      operate: /starting a cooking|start cooking|开始烹饪|使用方法/i,
      finish: /cooking.*finish|after cooking|completed|结束|完成/i,
      care: /cleaning and maintenance|cleaning the|清洁保养|清洁与保养/i,
    };
    const score = (c: KnowledgeChunk) =>
      Number(anchors[phase].test(c.text)) * 10 + Number(c.category !== "facts");
    const ranked = chunks
      .filter((c) => markers[phase].test(c.text))
      .sort((a, b) => score(b) - score(a));
    for (const c of ranked.slice(0, 2))
      if (!selected.some((s) => s.id === c.id)) selected.push(c);
  }
  return [
    ...selected,
    ...fallback.filter((c) => !selected.some((s) => s.id === c.id)),
  ].slice(0, 14);
}
