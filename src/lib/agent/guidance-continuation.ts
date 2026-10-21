import type { AssistantReply, ServiceSession } from "./contracts.ts";

/** Reuse only a pure progress report, never a changed condition or new question.
 * Caller rechecks item authorization and current active document chunk IDs.
 */
export function continueVerifiedGuidance(
  session: ServiceSession,
  question: string,
  activeEvidenceIds: Set<string>,
): AssistantReply | undefined {
  const clauses = question
    .split(/[，。；！？,;!?\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    !clauses.length ||
    !clauses.every(
      (s) =>
        /^(?:我)?(?:第[一二三四五六七八九十1-9]步|前[一二两三四五六七八九十1-9]步)(?:已经|已|都已|都已经)?(?:完成|做完|做过|结束)(?:了)?$/.test(
          s,
        ) ||
        /^(?:我)?(?:已经|已|做过|完成了|做完了)第[一二三四五六七八九十1-9]步了?$/.test(
          s,
        ) ||
        /^(?:接下来|下一步|然后|那)?(?:怎么|如何)?(?:继续|做|操作|开始)(?:呢|吧|吗)?$|^下一步(?:呢|是什么)?$/.test(
          s,
        ) ||
        /^(?:我)?(?:还)?(?:没|未)(?:有)?决定(?:食材和份量|食材|份量)$/.test(s),
    )
  )
    return;
  const previous = session.messages.filter((m) => m.reply).at(-1)?.reply;
  if (
    !previous ||
    previous.source !== "model-with-evidence" ||
    previous.memoryIds.length ||
    !previous.evidenceIds.length ||
    !previous.evidenceIds.every((id) => activeEvidenceIds.has(id))
  )
    return;
  const remaining = previous.steps.filter((s) => !session.tried.includes(s.id));
  if (!remaining.length || remaining.length === previous.steps.length) return;
  return {
    ...previous,
    answer:
      "已记下你报告完成的步骤。下面沿用刚才核验过的指导，从尚未完成的步骤继续；这不代表设备已实际完成。",
    steps: remaining,
  };
}
