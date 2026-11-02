import { z } from 'zod';
import type { Item } from '../domain.ts';
import { AgentError } from './contracts.ts';
import { guidanceSchema, presentGuidance } from './guidance.ts';
import type { ActionSource } from './practical-actions.ts';
import type { NecessaryCheck } from './practical-constraints.ts';

/** The final Function Calling boundary. It is not a candidate pipeline or a
 * semantic reviewer: one primary model chooses explanation and/or guidance. */
export const procedureGuidanceSchema=z.object({
 kind:z.literal('procedure'),itemId:z.string().min(1).max(100),
 steps:z.array(z.object({text:z.string().min(1).max(500),sourceId:z.string().min(1).max(200)}).strict()).min(1).max(12),
 conditions:z.array(z.string().min(1).max(240)).max(12),
}).strict();
export const finalResponseSchema = z.object({
  message: z.string().trim().describe('自然解释、已知与未知；具体行动放在guidance，不在此绕过动作依赖核对'),
  guidance: z.union([procedureGuidanceSchema,guidanceSchema]).nullable().describe('型号说明书指导用procedure；跨物品物理行动用资源依赖方案。两者都只是指导或候选，不是设备控制。纯解释用null。'),
}).strict().superRefine((value, context) => {
  if (!value.message && !value.guidance) context.addIssue({ code: 'custom', message: '最终答复不能同时缺少说明和行动内容' });
});

/** Parse/authorize/check the whole response before returning any display text.
 * Calling code must require this final tool and refuse a plain model terminal.
 * References establish identity and dependencies, not semantic entailment:
 * message and paraphrased step text still require real quality acceptance. */
export function finalizeResponse(
  raw: unknown,
  question: string,
  allowed: string[],
  checks: NecessaryCheck[],
  sources: ActionSource[],
  items: Item[],
  options: { requireGuidance?: boolean } = {},
) {
  const value = finalResponseSchema.parse(raw);
  if (options.requireGuidance && !value.guidance)
    throw new AgentError('本轮需要关联物品和依据的行动展示，不能以自由说明代替；缺少条件时请明确保留未知，不宣称动作已完成', 400);
  if(value.guidance&&'kind' in value.guidance){
    const procedure=value.guidance;
    if(!allowed.includes(procedure.itemId)||!items.some(i=>i.id===procedure.itemId))throw new AgentError('操作指导的物品未获授权或不可使用',403);
    const conflicts=checks.filter(c=>c.satisfied===false&&c.itemIds.includes(procedure.itemId));
    if(conflicts.length)throw new AgentError('当前物品存在未满足的必要条件，不能把说明书步骤当作当前可尝试指导：'+conflicts.map(c=>c.detail).join('；'),400);
    const used=procedure.steps.map(step=>{
      const source=sources.find(s=>s.id===step.sourceId&&s.itemId===procedure.itemId&&['operation','source_assertion'].includes(s.kind||'')&&s.text?.trim());
      if(!source)throw new AgentError('操作指导缺少当前型号范围内的原文候选，未发布该步骤',400);
      return source;
    });
    // A manual may tell the user to operate an external Bluetooth device. This
    // is conditional human guidance, NOT an inventory grant/read/control call.
    // Physical combination plans continue to require actual resource operands.
    const conditions=[...new Set([...procedure.conditions,...used.flatMap(s=>s.conditions||[])])];
    return {answer:[value.message,...procedure.steps.map((s,n)=>`${n+1}. ${s.text}`),...(conditions.length?['操作前提与未确认条件：',...conditions.map(c=>'— '+c)]:[])].filter(Boolean).join('\n\n'),
      message:value.message,guidance:null,procedure,basis:'source_bound_manual_guidance_not_execution' as const,
      limitations:['已核对物品范围与原文定位；未独立证明译文/步骤语义、外部配套设备状态或实际执行成功。']};
  }
  if (value.guidance) {
    for (const step of value.guidance.steps) {
      if (step.kind !== 'device_operation') continue;
      const operation = sources.find(source => source.id === step.operationRef && source.itemId === step.items[0] && ['operation','source_assertion'].includes(source.kind||'') && !!source.text?.trim());
      // The first operand is the operated device in the shared action contract.
      // An operation on another step resource/target cannot license this device.
      if (!operation || !value.guidance.sourceIds.includes(operation.id))
        throw new AgentError('设备操作缺少当前动作主体已读取且明确引用的操作原文；不能借用其他物品或伪造operationRef', 400);
    }
  }
  // Do not construct or release the explanation first: any failed action,
  // resource, source or user constraint rejects this entire final envelope.
  const guidance = value.guidance
    ? presentGuidance(value.guidance, question, allowed, checks, sources, items)
    : null;
  return {
    answer: [value.message, guidance?.answer].filter(Boolean).join('\n\n'),
    message: value.message,
    guidance,
    basis: guidance ? guidance.basis : 'unverified_model_explanation' as const,
    limitations: [
      '自然语言说明及操作释义未由独立语义证明认证；最终工具及合法引用不证明所有文字正确。',
      ...(guidance ? ['只核对了动作依赖、已知必要条件与操作原文引用；未证明完整物理可行、翻译准确或实体执行成功。'] : ['本答复只有模型说明，不是已核验的物品操作或现实执行结果。']),
    ],
  };
}
