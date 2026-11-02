import type { DatabaseSync } from "node:sqlite";
import type { Person, State } from "../domain.ts";
import type { Provider } from "../ai/provider.ts";
import { AgentError, type AssistantReply, type ServiceSession } from "./contracts.ts";
import { virtualHomeItems } from "../life/virtual-home.ts";
import { executePractical } from "./practical.ts";

/** Compatibility entry, not another reasoning loop. Household data and business
 * records retain their existing owners; the shared Agent owns every model/tool turn. */
export async function executeHomeTask(
  db: DatabaseSync, read: () => State, actor: Person, session: ServiceSession,
  question: string, provider: Provider, temporary = false,
) {
  const home = session.known.homeId === "young-apartment-v1";
  if (home && virtualHomeItems(read(), actor).length !== 8)
    throw new AgentError("模拟家庭尚未完整加载", 409);
  const unavailable = (outcome: "blocked" | "unavailable", answer: string) => ({
    reply: { outcome, answer, steps: [], questions: [], citations: [], evidenceIds: [], memoryIds: [], source: "local-dialogue", ...(outcome === "unavailable" ? { errorCode: "not_configured" } : {}) } as AssistantReply,
    trace: [], tokens: null, modelCalls: 0,
  });
  // Check before source extraction too: no cloud request is permitted by the
  // mere existence of simulated items or by consent on a different household.
  if (home && !read().virtualHomes?.[actor]?.allowCloud)
    return unavailable("blocked", "这套模拟家庭还没有获准提供给云端模型。请在首页明确选择是否允许；私人资料不会自动同意。");
  if (!provider.ready || !provider.converse)
    return unavailable("unavailable", "统一任务需要可用的模型工具接口，当前尚未可用。不会用本地片段或旧执行链冒充完整回答；资料、故事与记忆仍可查看。");
  const result = await executePractical(db, read, actor, session, question, provider, temporary);
  if (home) result.reply.caveat = "持有、位置与私人经历为模拟设定；" + (result.reply.caveat || "建议未进行实物验证，未执行设备控制。");
  // Preserve a conversation goal, not model-authored claims that sub-tasks have
  // succeeded. The next actual user request is always authoritative.
  if (!temporary && !["unavailable", "blocked"].includes(result.reply.outcome))
    session.known.homeTaskGoal = question;
  return result;
}
