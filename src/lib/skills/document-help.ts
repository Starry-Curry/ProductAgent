import { z } from "zod";
import {
  AgentError,
  type AssistantReply,
  type ServiceSession,
} from "../agent/contracts.ts";
import type { KnowledgeChunk } from "../life/acquisition.ts";
import { withoutProhibitedActions } from "../agent/safety-language.ts";

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
          })
          .strict(),
      )
      .min(1)
      .max(7),
    questions: z.array(z.string().max(250)).max(1).default([]),
  })
  .strict();
const forbidden =
  /短接|带电.{0,5}拆|绕过.{0,5}保护|我(?:已经|已).{0,8}(?:修复|通知|保存|检测)|保证.{0,6}安全|我亲眼|我记得我们/;
function numbers(s: string): string[] {
  return s.normalize("NFKC").match(/\d+(?:\.\d+)?/g) || [];
}
export function groundedReply(
  value: unknown,
  evidence: KnowledgeChunk[],
  session: Pick<ServiceSession, "tried">,
): AssistantReply {
  const p = groundedSchema.parse(value),
    ids = new Set<string>();
  for (const step of p.steps) {
    const sources = step.sourceIds.map((id) =>
      evidence.find((s) => s.id === id),
    );
    if (sources.some((s) => !s))
      throw new AgentError("操作引用不属于当前型号或已失效的资料版本");
    const text = withoutProhibitedActions(step.text),
      original = sources
        .map((s) => `${s!.model} ${s!.title} ${s!.text}`)
        .join(" ");
    if (
      forbidden.test(text) ||
      numbers(step.text).some((n) => !numbers(original).includes(n))
    )
      throw new AgentError("步骤包含来源未提供的数字或危险/未执行动作");
    for (const [claim, proof] of [
      [/长按|按住/, /hold|长按|按住/i],
      [/蓝牙/, /bluetooth|蓝牙/i],
      [/洗碗机/, /dishwasher|洗碗机/i],
      [/浸泡|浸入/, /immerse|soak|浸泡|浸入/i],
    ] as const)
      if (claim.test(text) && !proof.test(original))
        throw new AgentError("专属步骤未获引用原文支持");
    step.sourceIds.forEach((id) => ids.add(id));
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
    throw new AgentError("摘要包含未支持的参数或动作");
  const used = evidence.filter((e) => ids.has(e.id));
  const steps = p.steps
    .map((s) => ({
      id: `docstep:${s.sourceIds[0]}:${s.text.replace(/\s/g, "").slice(0, 24)}`,
      text: s.text,
    }))
    .filter((s) => !session.tried.includes(s.id));
  return {
    outcome: steps.length ? "answered" : "needs_info",
    answer: steps.length
      ? /(?:^|[\s：:])[1-7][.、．]/.test(p.answer)
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
    caveat:
      "按当前型号/资料地区的原文组织，翻译和引用检查不是完整语义或实物验证。参数与警告请核对原文；未宣称实际操作成功。",
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
