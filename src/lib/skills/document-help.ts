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
            sourceIds: z.array(z.string()).max(4),
            sourceQuote: z.string().min(8).max(500).optional(),
            phase: z
              .preprocess(
                (v) =>
                  typeof v === "string"
                    ? {
                        load: "operate",
                        clean: "care",
                        setup: "configure",
                        program: "configure",
                        preheat: "configure",
                        cooking: "operate",
                        cleanup: "care",
                        end: "finish",
                      }[v] ||
                      (taskPhases.includes(v as TaskPhase) ? v : undefined)
                    : v,
                z.enum(taskPhases).optional(),
              )
              .optional(),
            covers: z.array(z.string().max(30)).max(5).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    gaps: z
      .array(
        z.union([
          z.string().max(400),
          z
            .object({ phase: z.string().max(30), reason: z.string().max(400) })
            .transform((v) => v.phase + "：" + v.reason),
        ]),
      )
      .max(8)
      .optional(),
    questions: z
      .array(
        z.union([
          z.string().max(250),
          z
            .object({
              text: z.string().max(250).optional(),
              question: z.string().max(250).optional(),
            })
            .passthrough()
            .transform((q) => q.text || q.question || ""),
        ]),
      )
      .max(6)
      .catch([])
      .transform((rows) => rows.filter(Boolean).slice(-1)),
  })
  .strip();
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
    .replace(
      /(\d+(?:\.\d+)?)\s*(?:mA\b|毫安)/g,
      (_m, n) => String(Number(n) / 1000) + " A",
    )
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
  session: Pick<ServiceSession, "tried"> &
    Partial<Pick<ServiceSession, "messages">>,
  task?: ReturnType<typeof taskEvidence>,
): AssistantReply {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const parsedSteps = (Array.isArray(raw.steps) ? raw.steps : [])
    .slice(0, 10)
    .map((step) => groundedSchema.shape.steps.element.safeParse(step));
  const p = groundedSchema.parse({
      ...raw,
      answer:
        typeof raw.answer === "string" && raw.answer.trim()
          ? raw.answer.slice(0, 1600)
          : "下面根据现有资料继续。",
      steps: parsedSteps.filter((s) => s.success).map((s) => s.data),
    }),
    ids = new Set<string>();
  const labels = task?.phaseLabels || phaseLabels;
  const accepted: typeof p.steps = [];
  const rejected: string[] = parsedSteps
    .filter((s) => !s.success)
    .map(() => "单条步骤协议不完整，未作为操作指导");
  for (const step of p.steps) {
    step.text = step.text.replace(/[（(]说明书第[0-9、，,]+[页段][）)]/g, "");
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
      if (
        step.sourceQuote &&
        !sources.some((s) => s!.text.includes(step.sourceQuote!))
      )
        throw new AgentError("逐步引文不在所列原文中");
      // A diagram's reading order or an unrelated mention of a left/right unit is not
      // evidence for where the port is. Omit this optional location; keep the action.
      if (
        /USB|接口|端口/.test(step.text) &&
        !/(?:USB|port|connector)[^。\n.!?;]{0,50}(?:left|right|bottom)|(?:left|right|bottom)[^。\n.!?;]{0,50}(?:USB|port|connector)/i.test(
          original,
        )
      )
        step.text = step.text
          .replace(/[（(]位于[^）)]{0,30}[）)]/g, "")
          .replace(
            /(?:位于)?(?:右|左)(?:耳罩|单元|侧)(?:下方|底部|顶部)?的?|耳机底部(?:的)?/g,
            "",
          );
      if (
        !/right side|left side|front panel|rear panel|top panel/i.test(original)
      )
        step.text = step.text.replace(
          /机身(?:右侧|左侧|正面|背面|顶部|底部)的/g,
          "",
        );
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
        [
          /自动.{0,6}(?:扣|锁|嵌|吸附)/,
          /automatic.{0,25}(?:lock|snap|latch)|自动.{0,6}(?:扣|锁|嵌|吸附)/i,
        ],
        [/漂白|漂白剂/, /bleach|漂白/i],
        [/溶剂/, /solvent|溶剂/i],
        [/高温|耐热/, /high temperature|heat.resistan|高温|耐热/i],
        [/防水/, /waterproof|防水/i],
        [/密封|气密/, /airtight|seal|密封|气密/i],
        [/酒精|乙醇/, /alcohol|ethanol|酒精|乙醇/i],
        [/强碱|碱性/, /alkali|alkaline|强碱|碱性/i],
        [/内六角/, /allen|hex(?:agon)?|内六角/i],
        [/螺丝|螺钉/, /screw|螺丝|螺钉/i],
        [/拧紧|紧固|加固/, /tighten|fasten|拧紧|紧固|加固/i],
        [/沿.{0,8}纹理/, /along.{0,20}grain|纹理/i],
        [/鼓包|翘起/, /swell|warp|鼓包|翘起/i],
        [/激活/, /activat|激活/i],
      ] as const)
        if (claim.test(text) && !proof.test(original))
          throw new AgentError("专属步骤未获引用原文支持");
      // Matching vocabulary must not reverse an explicit restriction.
      for (const [claim, forbiddenSource] of [
        [
          /可以.{0,5}洗碗机|放入洗碗机|用洗碗机/,
          /(?:not|never|不可|不得|不能).{0,35}(?:dishwasher|洗碗机)/i,
        ],
        [
          /浸泡|浸入/,
          /(?:not|never|不可|不得|不能).{0,30}(?:immerse|soak|浸泡|浸入)/i,
        ],
      ] as const)
        if (
          claim.test(step.text) &&
          !/不要|不可|不得|不能|切勿|禁止/.test(step.text) &&
          forbiddenSource.test(original)
        )
          throw new AgentError("操作违背引用原文限制");
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
  const startAt = p.steps.findIndex((s) => s.phase === "start");
  if (startAt > 0) {
    const dependent = p.steps.filter(
      (s, n) =>
        n < startAt &&
        s.phase === "prepare" &&
        /开机后|空转|空篮|插电后/.test(s.text),
    );
    if (dependent.length) {
      p.steps = p.steps.filter((s) => !dependent.includes(s));
      const at = p.steps.findIndex((s) => s.phase === "start");
      p.steps.splice(at + 1, 0, ...dependent);
    }
  }
  if (
    forbidden.test(withoutProhibitedActions(p.answer)) ||
    numbers(p.answer).some(
      (n) =>
        !evidence.some((s) =>
          numbers(`${s.model} ${s.title} ${s.text}`).includes(n),
        ),
    )
  )
    p.answer = "下面是通过资料检查的步骤；请同时核对列出的条件与资料缺口。";
  const used = evidence.filter((e) => ids.has(e.id));
  const completed = (session.messages || [])
    .flatMap((m) => m.reply?.steps || [])
    .filter((s) => session.tried.includes(s.id));
  const actionGroups = [/清洁|清洗|洗净/];
  const steps = p.steps
    .map((s) => ({
      id: `docstep:${s.sourceIds[0]}:${s.phase ? "phase=" + s.phase + ":" : ""}${s.text.replace(/\s/g, "").slice(0, 24)}`,
      text: (s.phase ? labels[s.phase] + "：" : "") + s.text,
      phase: s.phase,
    }))
    .filter(
      (s) =>
        !session.tried.includes(s.id) &&
        !session.tried.some((id) => {
          if (!s.phase || !id.includes(":phase=" + s.phase + ":")) return false;
          const full = completed.find((old) => old.id === id)?.text;
          if (
            full &&
            actionGroups.some((group) => group.test(full) && group.test(s.text))
          )
            return true;
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
        .map(
          (phase) =>
            labels[phase] +
            (completed.length
              ? "：本轮先接续当前步骤，后续待确认后继续"
              : "：本轮未取得可支持的完整步骤"),
        )
    : [];
  if (task?.full && task.cooking)
    for (const f of task.checklist)
      if (
        !(
          f.id === "initial-clean" &&
          session.tried.some(
            (id) =>
              id.includes(":phase=prepare:") &&
              /清洗|清洁|洗净/.test(
                completed.find((s) => s.id === id)?.text || id,
              ),
          )
        ) &&
        !p.steps.some((s) =>
          f.id === "initial-clean"
            ? s.phase === "prepare" && /清洗|清洁|洗净/.test(s.text)
            : f.id === "initial"
              ? /首次|第一次|初次/.test(s.text)
              : f.id === "load"
                ? /食材|食物/.test(s.text) && /放入|加入|装入|摆放/.test(s.text)
                : f.id === "program"
                  ? /程序|模式|时间|温度/.test(s.text) &&
                    /旋|选|设|确认|启动/.test(s.text)
                  : /结束|冷却|清洗|清洁|拔/.test(s.text),
        )
      )
        missing.push(f.label + "：未形成完整指导");
  if (task?.full && task.cooking)
    missing.push(
      "实际烹饪前，请按所选食材、份量及官方食谱确认程序/参数；本次只提供控制流程，不凭空设定熟度或食品时温。",
    );
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
          : "下面按当前资料继续；步骤中的限制和缺口请一并核对。"
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
    ...(task?.full
      ? {
          taskProgress: {
            guidance: missing.length
              ? ("partial" as const)
              : ("ready-to-confirm" as const),
            missing,
            completionEvidence: "advice-only" as const,
          },
        }
      : {}),
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
