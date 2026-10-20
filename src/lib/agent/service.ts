import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { mutate, type State, type Person } from "../domain.ts";
import type { Provider } from "../ai/provider.ts";
import {
  turnInputSchema,
  AgentError,
  type TurnResult,
  type ServiceSession,
  type AssistantReply,
} from "./contracts.ts";
import {
  beginTurn,
  commitTurn,
  releaseTurn,
  readSession,
} from "../repositories/sessions.ts";
import { epoch, saveMemory, getPersona } from "../memory/store.ts";
import { executeGraph } from "./graph.ts";
import { buildContext } from "../context/builder.ts";
import { identity } from "../ai/harness.ts";
export async function respond(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  raw: unknown,
  provider: Provider,
): Promise<TurnResult> {
  const input = turnInputSchema.parse(raw);
  if (input.temporary) {
    if (input.sessionId) throw new AgentError("临时提问不加载历史会话");
    const item = input.itemId
      ? read().items.find((i) => i.id === input.itemId)
      : undefined;
    const at = new Date().toISOString();
    const session: ServiceSession = {
      id: crypto.randomUUID(),
      owner: actor,
      itemId: input.itemId,
      identity: item ? JSON.stringify([item.owner, identity(item)]) : undefined,
      mode: input.mode,
      revision: 0,
      status: "active",
      messages: [],
      known: input.uiContext ? { uiPage: input.uiContext.page } : {},
      tried: [],
      memoryEpoch: epoch(db, actor),
      createdAt: at,
      updatedAt: at,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    if (/^记住[：:，,\s]/.test(input.question))
      throw new AgentError("临时提问不保存记忆，请取消临时模式后明确保存");
    const result = await executeGraph(
      db,
      read,
      actor,
      session,
      input.question,
      provider,
      true,
    );
    return {
      ...result,
      session: {
        ...session,
        messages: [
          { id: crypto.randomUUID(), role: "user", text: input.question, at },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: result.reply.answer,
            reply: result.reply,
            at,
          },
        ],
      },
    };
  }
  const { session, cached } = beginTurn(db, read, actor, input);
  if (cached) return cached;
  if (input.memoryPolicy) session.known.memoryPolicy = input.memoryPolicy;
  if (input.uiContext) {
    session.known.uiPage = input.uiContext.page;
    if (input.uiContext.goal) session.known.uiGoal = input.uiContext.goal;
    if (
      input.uiContext.companion &&
      input.itemId &&
      getPersona(db, actor, input.itemId).enabled
    )
      session.known.companionItemId = input.itemId;
    if (
      session.known.companionItemId &&
      !getPersona(db, actor, session.known.companionItemId).enabled
    )
      delete session.known.companionItemId;
    if (input.uiContext.planContext && !input.sessionId) {
      session.known.lifeIdeaIds = JSON.stringify(
        input.uiContext.planContext.previousIdeaIds,
      );
      if (input.uiContext.planContext.continuation)
        session.known.lifePlanContext = JSON.stringify(
          input.uiContext.planContext.continuation,
        );
      session.known.lastIntent = "plan";
    }
  }
  session.known.turnRequestId = input.requestId;
  try {
    let execution: Omit<TurnResult, "session">;
    const explicit = input.question.match(/^记住[：:，,\s]+([\s\S]+)$/u);
    if (explicit) {
      const text = explicit[1].trim();
      const kind = /喜欢|爱好|兴趣/.test(text) ? "interest" : "experience";
      const memory = saveMemory(
        db,
        read,
        actor,
        { text, kind, itemId: input.itemId, allowCloud: false },
        undefined,
        input.requestId,
      );
      session.memoryEpoch = epoch(db, actor);
      const reply: AssistantReply = {
        outcome: "answered",
        answer:
          "已记下这件事，默认仅用于本地帮助。你可以在“关于我与记住的事”里纠正、忘记，或单独允许云端使用。",
        steps: [],
        questions: [],
        citations: [],
        evidenceIds: [],
        memoryIds: [memory.id],
        source: "local-memory",
      };
      execution = {
        reply,
        trace: [
          {
            stage: "explicit_memory_saved",
            detail: memory.id,
            at: new Date().toISOString(),
          },
        ],
        tokens: null,
        modelCalls: 0,
      };
    } else
      execution = await executeGraph(
        db,
        read,
        actor,
        session,
        input.question,
        provider,
      );
    const prefs = buildContext(db, read(), actor, {
      question: input.question,
      mode: input.mode,
      itemId: input.itemId,
      sessionId: session.id,
    }).preferences;
    const remembered = buildContext(db, read(), actor, {
      question: input.question,
      mode: input.mode,
      itemId: input.itemId,
      sessionId: session.id,
    }).memories;
    const naturalStyle = remembered.find(
      (m) =>
        (m.kind === "preference" || m.kind === "requirement") &&
        /简短|详细/.test(m.text),
    );
    const style =
      prefs.find((p) => p.key === "instructionStyle")?.value ||
      (naturalStyle
        ? /简短/.test(naturalStyle.text)
          ? "short"
          : "detailed"
        : undefined);
    if (style === "short" || style === "detailed")
      execution.reply.presentation = style;
    const at = new Date().toISOString();
    session.messages.push(
      {
        id: crypto.randomUUID(),
        role: "user",
        text: input.question,
        at,
        itemId: execution.reply.route?.itemId || session.itemId,
        memoryPolicy: input.memoryPolicy,
        capture:
          session.known.memoryPolicy !== "off" &&
          (input.mode !== "auto" ||
            (!!execution.reply.route &&
              ["help", "story", "companion"].includes(
                execution.reply.route.intent,
              ) &&
              !(
                execution.reply.route.intent === "story" &&
                !execution.reply.route.itemId
              ))),
      },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: execution.reply.answer,
        reply: execution.reply,
        at,
      },
    );
    session.messages = session.messages.slice(-30);
    session.status =
      execution.reply.outcome === "needs_info" ? "waiting_user" : "active";
    const result = { session, ...execution };
    commitTurn(db, read, actor, input, result);
    return result;
  } catch (error) {
    releaseTurn(db, actor, input, session.id);
    throw error;
  }
}
export const handoffSchema = z
  .object({
    sessionId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    requestId: z.string().uuid(),
    summary: z.string().trim().min(1).max(120),
    assignee: z.enum(["lin", "dad"]),
  })
  .strict();
/** Explicit user-confirmed summary; model output never directly creates a family task. */
export function handoff(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  raw: unknown,
) {
  const input = handoffSchema.parse(raw);
  db.exec("BEGIN IMMEDIATE");
  try {
    const s = readSession(db, read(), actor, input.sessionId);
    if (s.revision !== input.expectedRevision)
      throw new AgentError("会话已有新内容，请重新检查摘要", 409);
    if (!s.itemId) throw new AgentError("请先关联已有的家庭共享物品");
    const state = mutate(read(), actor, "quickTask", {
      requestId: input.requestId,
      itemId: s.itemId,
      title: input.summary,
      assignee: input.assignee,
      kind: "help",
    });
    const task = state.tasks.find(
      (t) => t.createdBy === actor && t.requestId === input.requestId,
    )!;
    task.serviceContext = {
      sourceSessionId: s.id,
      sourceRevision: s.revision,
      summary: input.summary,
      attemptedSteps: s.tried.length,
    };
    // Only the text explicitly previewed above is shared. No memory/whole transcript copying.
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(state),
    );
    db.exec("COMMIT");
    return { taskId: task.id, summary: task.title };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
