import type { DatabaseSync } from "node:sqlite";
import type { State, Person } from "../domain.ts";
import type { AssistantReply } from "../agent/contracts.ts";
import { isMemoryRecallRequest } from "../skills/memory-storytelling.ts";
import { listFragments } from "./stories.ts";
/** Unique authored fragments are read only on explicit recall, never for device help. */
export function recallLifeFragments(
  db: DatabaseSync,
  state: State,
  actor: Person,
  question: string,
  itemId?: string,
): AssistantReply | undefined {
  if (
    !isMemoryRecallRequest(question) ||
    !db.prepare("SELECT 1 FROM sqlite_master WHERE name='life_fragments'").get()
  )
    return;
  const fragments = listFragments(db, state, actor, itemId)
    .filter((f) => itemId || !f.demo)
    .slice(0, 3);
  if (!fragments.length) return;
  return {
    outcome: "answered",
    answer:
      "你主动保存的生活片段里，有这些记忆：\n\n" +
      fragments.map((f) => `“${f.text.slice(0, 800)}”`).join("\n\n"),
    steps: [],
    questions: [],
    evidenceIds: [],
    citations: [],
    memoryIds: fragments.map((f) => f.id),
    source: "local-memory",
    caveat:
      "仅在本机引用你保存的原话；没有补写经历、日期、人物或心理画像。可在生活故事中编辑或删除原片段。",
  };
}
