import type { DatabaseSync } from "node:sqlite";
import type { State, Person } from "../domain.ts";
import { virtualHomeItems } from "../life/virtual-home.ts";
import { itemContext } from "./items.ts";
import { readKnowledge, retrieveKnowledge } from "../life/acquisition.ts";
import { effectivePersona, listMemories } from "../memory/store.ts";
import { isMemoryRecallRequest } from "../skills/memory-storytelling.ts";
import { storyMemoryRelevant } from "../life/organization.ts";
import { AgentError } from "../agent/contracts.ts";

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
  } = {},
) {
  const scope = virtualHomeItems(state, actor),
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
        kind: "simulated-user-report",
        location: i.location,
        note: i.note,
      },
      documents: readKnowledge(db, state, actor, i.id).map((d) => ({
        title: d.title,
        url: d.url,
        role: d.role,
        region: d.region,
        applicability: d.applicability,
        fetchedAt: d.fetchedAt,
      })),
      passages: retrieveKnowledge(db, state, actor, i.id, question)
        .map((c) => ({
          id: c.id,
          text: c.text,
          url: c.url,
          title: c.title,
          region: c.region,
        }))
        .slice(0, unique.includes(i.id) ? 6 : 2),
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
