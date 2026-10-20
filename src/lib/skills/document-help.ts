import { z } from "zod";
import {
  AgentError,
  type AssistantReply,
  type ServiceSession,
} from "../agent/contracts.ts";
import type { KnowledgeChunk } from "../life/acquisition.ts";
import { withoutProhibitedActions } from "../agent/safety-language.ts";
import {
  taskPhases,
  phaseLabels,
  type TaskPhase,
  taskEvidence,
} from "../life/knowledge-task.ts";

export const groundedSchema = z
  .object({
    kind: z.literal("grounded"),
    answer: z.string().trim().min(1).max(1600),
    steps: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(600),
            sourceIds: z.array(z.string()).min(1).max(4),
            phase: z.enum(taskPhases).optional(),
            covers: z
              .array(z.enum(["initial", "load", "program", "end"]))
              .max(4)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    gaps: z.array(z.string().max(200)).max(6).optional(),
    questions: z.array(z.string().max(250)).max(1).default([]),
  })
  .strict();
const forbidden =
  /短接|带电.{0,5}拆|绕过.{0,5}保护|我(?:已经|已)(?:帮你|为你)?(?:修复|通知|保存|检测)|(?<!不)(?<!不能)保证.{0,6}安全|我亲眼|我记得我们/;
function numericText(s: string) {
  const english = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
  ];
  return s
    .normalize("NFKC")
    .replace(new RegExp("\\b(" + english.join("|") + ")\\b", "gi"), (w) =>
      String(english.indexOf(w.toLowerCase())),
    )
    .replace(
      /([一二两三四五六七八九十百]+)(?=分钟|秒|小时|度|瓦|伏|毫升|升)/g,
      (w) => {
        let sum = 0,
          n = 0;
        for (const c of w) {
          const v = "零一二三四五六七八九".indexOf(c === "两" ? "二" : c);
          if (v >= 0) n = v;
          else {
            sum += (n || 1) * (c === "百" ? 100 : 10);
            n = 0;
          }
        }
        return String(sum + n);
      },
    )
    .replace(/(\d),(?=\d{3}\b)/g, "$1");
}
function numbers(s: string): string[] {
  return (
    numericText(s)
      .replace(/(?:^|\n)\s*\d+[.、)）]\s*/g, "")
      .match(/\d+(?:\.\d+)?/g) || []
  );
}
function quantities(s: string) {
  return [
    ...numericText(s).matchAll(
      /(\d+(?:\.\d+)?)(?:\s*[-–~至到]\s*(\d+(?:\.\d+)?))?\s*(°\s*C|℃|摄氏度|度|minutes?|mins?|分钟|seconds?|secs?|秒|hours?|小时|[WVAI]\b|瓦|伏|安培|amps?|[mM]?L\b|升|毫升)/gi,
    ),
  ].flatMap((m) => {
    const raw = m[3].toLowerCase().replace(/\s/g, "");
    const unit = /^(minute|min|分钟)/.test(raw)
      ? "min"
      : /^(second|sec|秒)/.test(raw)
        ? "sec"
        : /^(hour|小时)/.test(raw)
          ? "h"
          : /^(w|瓦)$/.test(raw)
            ? "w"
            : /^(v|伏)$/.test(raw)
              ? "v"
              : /^(a|安培|amp)/.test(raw)
                ? "a"
                : /ml|毫升/.test(raw)
                  ? "ml"
                  : /^(l|升)$/.test(raw)
                    ? "l"
                    : raw.replace(/°c|摄氏度|度/g, "c");
    return [m[1], ...(m[2] ? [m[2]] : [])].map((n) => n + ":" + unit);
  });
}
export function groundedReply(
  value: unknown,
  evidence: KnowledgeChunk[],
  session: Pick<ServiceSession, "tried">,
  task?: ReturnType<typeof taskEvidence>,
): AssistantReply {
  const p = groundedSchema.parse(value),
    ids = new Set<string>();
  if (task?.full && p.steps.some((s) => !s.phase))
    throw new AgentError("完整任务步骤缺少phase阶段标记");
  const accepted: typeof p.steps = [];
  const rejected: string[] = [];
  for (const step of p.steps) {
    step.text=step.text.replace(/[（(]说明书第[0-9、，,]+[页段][）)]/g, "");
    try {
      const sources = step.sourceIds.map((id) =>
        evidence.find((s) => s.id === id),
      );
      if (sources.some((s) => !s))
        throw new AgentError("操作引用不属于当前型号或已失效的资料版本");
      if (sources.every((s) => s?.category === "facts"))
        throw new AgentError("只有规格资料，不能冒充操作步骤");
      const text = withoutProhibitedActions(step.text),
        original = sources
          .map((s) => `${s!.model} ${s!.title} ${s!.text}`)
          .join(" ");
      if(!/right side|left side|front panel|rear panel|top panel/i.test(original))step.text=step.text.replace(/机身(?:右侧|左侧|正面|背面|顶部|底部)的/g,'');
      if (
        forbidden.test(text) ||
        numbers(step.text).some((n) => !numbers(original).includes(n)) ||
        quantities(step.text).some((q) => !quantities(original).includes(q))
      )
        throw new AgentError("步骤包含来源未提供的数字或危险/未执行动作");
      for (const [claim, proof] of [
        [/长按|按住/, /hold|长按|按住/i],
        [/蓝牙/, /bluetooth|蓝牙/i],
        [/洗碗机/, /dishwasher|洗碗机/i],
        [/浸泡|浸入/, /immerse|soak|浸泡|浸入/i],
        [/咔嗒|咔哒|卡嗒/, /click|咔嗒|咔哒/i],
        [/卡扣|卡入/, /snap|click|卡扣|卡入/i],
      [/腌制/, /marinat|腌制/i],
      ] as const)
        if (claim.test(text) && !proof.test(original))
          throw new AgentError("专属步骤未获引用原文支持");
      step.sourceIds.forEach((id) => ids.add(id));
      accepted.push(step);
    } catch (e) {
      if (!(e instanceof AgentError)) throw e;
      rejected.push(e.message);
    }
  }
  if (!accepted.length)
    throw new AgentError(rejected[0] || "没有可支持的操作步骤");
  p.steps = accepted;
  // A preparation operation that explicitly needs power must follow startup, not precede it.
  const startAt=p.steps.findIndex(s=>s.phase==='start');
  if(startAt>0){const dependent=p.steps.filter((s,n)=>n<startAt&&s.phase==='prepare'&&/开机后|空转|空篮|插电后/.test(s.text));if(dependent.length){p.steps=p.steps.filter(s=>!dependent.includes(s));const at=p.steps.findIndex(s=>s.phase==='start');p.steps.splice(at+1,0,...dependent);}}
  if (
    forbidden.test(withoutProhibitedActions(p.answer)) ||
    numbers(p.answer).some(
      (n) =>
        !evidence.some((s) =>
          numbers(`${s.model} ${s.title} ${s.text}`).includes(n),
        ),
    )
  )
    throw new AgentError("摘要包含未支持的参数或动作");
  const used = evidence.filter((e) => ids.has(e.id));
  const steps = p.steps
    .map((s) => ({
      id: `docstep:${s.sourceIds[0]}:${s.phase ? "phase=" + s.phase + ":" : ""}${s.text.replace(/\s/g, "").slice(0, 24)}`,
      text: (s.phase ? phaseLabels[s.phase] + "：" : "") + s.text,
      phase: s.phase,
    }))
    .filter(
      (s) =>
        !session.tried.includes(s.id) &&
        !session.tried.some((id) => {
          if (!s.phase || !id.includes(":phase=" + s.phase + ":")) return false;
          const old = id.split(":").at(-1) || "";
          const now = s.text.replace(/[^\p{Script=Han}a-z0-9]/giu, "");
          const pairs = [...new Set(old.match(/.{2}/gu) || [])];
          return (
            pairs.length > 3 &&
            pairs.filter((w) => now.includes(w)).length / pairs.length > 0.55
          );
        }),
    );
  const missing = task?.full
    ? task.requiredPhases
        .filter(
          (phase) =>
            !p.steps.some((s) => s.phase === phase) &&
            !session.tried.some((id) => id.includes(":phase=" + phase + ":")),
        )
        .map((phase) => phaseLabels[phase] + "：本轮未取得可支持的完整步骤")
    : [];
  if (task?.full && task.cooking)
    for (const f of task.checklist)
      if (
        !p.steps.some((s) =>
          s.covers?.includes(f.id as "initial" | "load" | "program" | "end"),
        )
      )
        missing.push(f.label + "：未形成完整指导");
  if (rejected.length)
    missing.push(
      `已隐藏${rejected.length}条未通过证据检查的步骤，未据此宣称完整完成任务。`,
    );
  return {
    outcome: steps.length ? "answered" : "needs_info",
    answer: steps.length
      ? rejected.length
        ? "以下保留了可核对的步骤；缺失环节见说明，不将部分指导当作完整任务。"
        : /(?:^|[\s：:])[1-7][.、．]/.test(p.answer)
          ? "可以，下面按官方资料逐步开始。"
          : p.answer
      : "已记下这些方法已经尝试，不再重复。请描述当前实际现象，或核对官方排障章节。",
    steps,
    questions: steps.length
      ? p.questions
      : ["现在具体卡在哪一步、观察到什么现象？"],
    source: "model-with-evidence",
    citations: used.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      section: `原文位置 ${s.start}–${s.end}；${s.model} / ${s.region}`,
      kind: "official",
    })),
    evidenceIds: [...ids],
    memoryIds: [],
    caveat: [
      "按当前型号/资料地区原文组织；引用检查不是完整语义或实物验证。",
      ...missing,
      ...(p.gaps || []),
    ].join(" "),
  };
}
export function offlineDocumentHelp(
  evidence: KnowledgeChunk[],
  session: Pick<ServiceSession, "tried">,
): AssistantReply | undefined {
  if (!evidence.length) return;
  const sources = evidence.filter((s) => s.category !== "facts").slice(0, 3);
  if (!sources.length) return;
  return {
    outcome: "answered",
    answer:
      "已找到这件型号的官方操作/养护原文。云端关闭时直接展示摘录，不冒充模型翻译；可核对来源后使用。",
    steps: sources
      .map((s) => ({ id: `excerpt:${s.id}`, text: s.text }))
      .filter((s) => !session.tried.includes(s.id)),
    questions: [],
    source: "curated-guidance",
    citations: sources.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      section: `${s.model} / ${s.region}；原文位置 ${s.start}–${s.end}`,
      kind: "official",
    })),
    evidenceIds: sources.map((s) => s.id),
    memoryIds: [],
    caveat: "公开官方资料原文摘录；地区和版本需与实物一致，未核验实际状态。",
  };
}
