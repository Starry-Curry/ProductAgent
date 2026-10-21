import type { AssistantReply } from "./contracts.ts";
/** Keep the saved provider packet intact; avoid repeating the same question in the UI. */
export function additionalQuestions(
  reply: Pick<AssistantReply, "answer" | "questions">,
) {
  const normalize = (s: string) =>
    s
      .replace(/[\p{P}\p{S}\s]/gu, "")
      .replace(/^请问/, "")
      .toLowerCase();
  const body = normalize(reply.answer),
    seen = new Set<string>();
  return reply.questions.filter((q) => {
    const key = normalize(q);
    if (!key || seen.has(key) || body.includes(key)) return false;
    seen.add(key);
    return true;
  });
}
