import { storyMemoryRelevant } from "../life/organization.ts";
import { sharedItemKnowledge } from "./knowledge.ts";
import { retrieveKnowledge } from "../life/acquisition.ts";
import { taskEvidence } from "../life/knowledge-task.ts";
import type { DatabaseSync } from "node:sqlite";
import { canRead, type State, type Person } from "../domain.ts";
import { boundPack } from "../ai/harness.ts";
import { recallMemories, effectivePersona } from "../memory/store.ts";
import { relevantKnowledge } from "../skills/knowledge.ts";
import { syntheticItem, usable } from "../life/availability.ts";
import { isMemoryRecallRequest } from "../skills/memory-storytelling.ts";
import { listFragments } from "../life/stories.ts";
import { recallLifeFragments } from "../life/recall.ts";
export function buildContext(
  db: DatabaseSync,
  state: State,
  actor: Person,
  input: {
    question: string;
    knowledgeQuery?: string;
    mode: string;
    itemId?: string;
    temporary?: boolean;
    excludeSynthetic?: boolean;
    taskMemoryOnly?: boolean;
    sessionId?: string;
  },
) {
  const item = input.itemId
    ? state.items.find((i) => i.id === input.itemId && canRead(i, actor))
    : undefined;
  const persona = input.temporary
    ? {
        enabled: false,
        nickname: "",
        style: "neutral" as const,
        memoryUse: "off" as const,
      }
    : effectivePersona(db, actor, item?.id);
  const memories = input.temporary
    ? []
    : recallMemories(
        db,
        state,
        actor,
        input.question,
        input.mode,
        item?.id,
        input.sessionId,
      ).filter(
        (m) =>
          storyMemoryRelevant(db, actor, m, input.question) &&
          persona.memoryUse !== "off" &&
          (persona.memoryUse !== "explicit" ||
            isMemoryRecallRequest(input.question)) &&
          (!input.taskMemoryOnly ||
            isMemoryRecallRequest(input.question) ||
            !["experience", "story", "relationship"].includes(m.kind)),
      );
  const knowledge = relevantKnowledge(
    input.question,
    item ? boundPack(item) : undefined,
  );
  const preferences = (input.temporary ? [] : state.contexts || []).filter(
    (c) =>
      c.owner === actor &&
      c.status === "explicit" &&
      persona.memoryUse !== "off" &&
      (persona.memoryUse !== "explicit" ||
        isMemoryRecallRequest(input.question)),
  );
  const externalKnowledge = item
    ? retrieveKnowledge(
        db,
        state,
        actor,
        item.id,
        input.knowledgeQuery || input.question,
      )
    : [];
  const fragmentRecall =
    !!db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='life_fragment_details'")
      .get() &&
    !input.temporary &&
    persona.memoryUse !== "off" &&
    isMemoryRecallRequest(input.question)
      ? recallLifeFragments(db, state, actor, input.question, item?.id)
      : undefined;
  const fragmentIds = new Set(fragmentRecall?.memoryIds || []);
  const cloudFragments = fragmentIds.size
    ? listFragments(db, state, actor, item?.id)
        .filter(
          (f) =>
            fragmentIds.has(f.id) &&
            f.allowRecall &&
            f.allowCloud &&
            !f.demo &&
            f.origin !== "fiction",
        )
        .slice(0, 3)
        .map((f) => ({
          id: f.id,
          text: f.text.slice(0, 1800),
          origin: f.origin,
          recordedAt: f.createdAt,
          eventDate: f.capturedOn,
        }))
    : [];
  const sharedKnowledge = sharedItemKnowledge(
    state,
    actor,
    item ? [item.id] : [],
    { demo: !!item?.demo },
  );
  return {
    temporary: !!input.temporary,
    question: input.question,
    productConversation: !!input.taskMemoryOnly,
    externalKnowledge,
    knowledgeTask: taskEvidence(
      externalKnowledge,
      input.knowledgeQuery || input.question,
      item?.name,
    ),
    item,
    sharedKnowledge,
    itemContexts: sharedKnowledge.items,
    knowledge,
    memories,
    cloudMemories: memories.filter((m) => m.allowCloud && !m.demo),
    cloudFragments,
    preferences,
    cloudPreferences: preferences
      .filter((p) => p.allowCloud)
      .map((p) => ({ key: p.key, value: p.value })),
    persona,
    resources:
      input.mode === "ideas"
        ? sharedItemKnowledge(
            state,
            actor,
            state.items
              .filter(
                (i) =>
                  canRead(i, actor) &&
                  (!input.excludeSynthetic ||
                    (!syntheticItem(i) && usable(i))) &&
                  (item?.demo ? !!i.demo : !i.demo) &&
                  ["在用", "闲置", "待确认"].includes(i.state),
              )
              .map((i) => i.id),
            { demo: !!item?.demo },
          ).items
        : [],
  };
}
