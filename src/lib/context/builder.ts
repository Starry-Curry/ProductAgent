import type { DatabaseSync } from "node:sqlite";
import { canRead, type State, type Person } from "../domain.ts";
import { boundPack } from "../ai/harness.ts";
import { recallMemories, getPersona } from "../memory/store.ts";
import { relevantKnowledge } from "../skills/knowledge.ts";
export function buildContext(
  db: DatabaseSync,
  state: State,
  actor: Person,
  input: {
    question: string;
    mode: string;
    itemId?: string;
    temporary?: boolean;
    sessionId?: string;
  },
) {
  const item = input.itemId
    ? state.items.find((i) => i.id === input.itemId && canRead(i, actor))
    : undefined;
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
      );
  const knowledge = relevantKnowledge(
    input.question,
    item ? boundPack(item) : undefined,
  );
  const preferences = (input.temporary ? [] : state.contexts || []).filter(
    (c) => c.owner === actor && c.status === "explicit",
  );
  const persona = input.temporary
    ? { enabled: false, nickname: "", style: "neutral" as const }
    : getPersona(db, actor, item?.id);
  return {
    temporary: !!input.temporary,
    question: input.question,
    item,
    knowledge,
    memories,
    cloudMemories: memories.filter((m) => m.allowCloud),
    preferences,
    cloudPreferences: preferences
      .filter((p) => p.allowCloud)
      .map((p) => ({ key: p.key, value: p.value })),
    persona,
    resources:
      input.mode === "ideas"
        ? state.items
            .filter(
              (i) =>
                canRead(i, actor) &&
                ["在用", "闲置", "待确认"].includes(i.state),
            )
            .map((i) => ({ id: i.id, name: i.name, state: i.state }))
        : [],
  };
}
