import type { DatabaseSync } from "node:sqlite";
import type { State, Person } from "../domain.ts";
import { virtualHomeItems } from "../life/virtual-home.ts";
import { itemContext } from "./items.ts";
import { readKnowledge, retrieveKnowledge } from "../life/acquisition.ts";
import { effectivePersona, listMemories } from "../memory/store.ts";
import { isMemoryRecallRequest } from "../skills/memory-storytelling.ts";
import { storyMemoryRelevant } from "../life/organization.ts";
import { AgentError } from "../agent/contracts.ts";
import { resolveTaskContext } from "../foundation/tasks.ts";

/** One authorized scope across knowledge, private relationships and voice. No intent-specific early answer. */
export function buildHomeTaskContext(
  db: DatabaseSync,
  state: State,
  actor: Person,
  question: string,
  itemIds: string[],
  options: {
    temporary?: boolean;
    memoryQuestion?: string;
    includeMemories?: boolean;
    topics?: string[];
    taskId?: string;
  } = {},
) {
  const task=options.taskId?resolveTaskContext(db,state,actor,options.taskId):undefined;
  const scope = task ? state.items.filter(i=>task.task.itemInstanceIds.includes(i.id)) : virtualHomeItems(state, actor),
    unique = [...new Set(itemIds)];
  if (unique.some((id) => !scope.some((i) => i.id === id)))
    throw new AgentError("物品不在本人的模拟家庭范围", 403);
  // The eight-item apartment is a bounded resource set, not the real inventory.
  // Include brief physical context for neighboring resources to prevent a one-item lookup truncating a shared task.
  const items = [...scope].sort(
    (a, b) => Number(unique.includes(b.id)) - Number(unique.includes(a.id)),
  );
  const memoryQuestion = options.memoryQuestion || question;
  const memories =
    options.temporary || options.includeMemories === false
      ? []
      : listMemories(db, state, actor).filter(
          (m) =>
            m.status === "active" &&
            !m.archived &&
            m.allowCloud &&
            !m.demo &&
            m.kind !== "fiction" &&
            !!m.itemId &&
            scope.some((i) => i.id === m.itemId) &&
            (unique.includes(m.itemId) ||
              ["preference", "interest", "requirement"].includes(m.kind)) &&
            storyMemoryRelevant(db, actor, m, memoryQuestion) &&
            effectivePersona(db, actor, m.itemId).memoryUse !== "off" &&
            (effectivePersona(db, actor, m.itemId).memoryUse !== "explicit" ||
              isMemoryRecallRequest(memoryQuestion)),
        );
  return {
    items: items.map((i) => ({
      ...itemContext(i),
      contextRole: unique.includes(i.id)
        ? "requested-item"
        : "bounded-household-resource",
      personalInstance: {
        kind: i.synthetic ? "simulated-user-report" : "user_report",
        location: i.owner===actor ? i.location : "未共享",
        note: i.owner===actor ? i.note : "未共享",
      },
      documents: readKnowledge(db, state, actor, i.id).map((d) => ({
        title: d.title,
        url: d.url,
        role: d.role,
        region: d.region,
        applicability: d.applicability,
        fetchedAt: d.fetchedAt,
      })),
      // Interleave sub-question results so one topic cannot consume every slot.
      passages: (unique.includes(i.id)
        ? homeTaskPassages(
            (topic) => retrieveKnowledge(db, state, actor, i.id, topic),
            options.topics?.length ? options.topics : [question],
          )
        : []
      )
        .map((c) => ({
          id: c.id,
          text: c.text,
          url: c.url,
          title: c.title,
          region: c.region,
        }))
        .slice(0, 6),
    })),
    memories: memories.map((m) => ({
      id: m.id,
      kind: m.kind,
      text: m.text,
      itemId: m.itemId,
      expiresAt: m.expiresAt,
      provenance: "explicitly-confirmed-synthetic-setting",
    })),
  };
}

export function homeTaskPassages<T extends { id: string }>(
  retrieve: (topic: string) => T[],
  topics: string[],
): T[] {
  const groups = [...new Set(topics)].slice(0, 6).map(retrieve);
  const result = new Map<string, T>();
  for (let rank = 0; rank < 6 && result.size < 6; rank++)
    for (const group of groups) {
      const passage = group[rank];
      if (passage && result.size < 6) result.set(passage.id, passage);
    }
  return [...result.values()];
}
