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
  const query = question.replace(
    /帮我|回忆|还记得|记得|记忆|记录|故事|讲讲|说说|看看|一下|我的|我们|之前|以前|过去|这个|这件|物品|的|吗|呢|[\s，。？！?！]/g,
    "",
  );
  const terms = query.match(/[\p{Script=Han}]{2}|[a-z0-9]{2,}/giu) || [];
  const owned = listFragments(db, state, actor, itemId).filter(
    (f) => itemId || !f.demo,
  );
  if (!owned.length) return;
  const fragments = owned
    .filter(
      (f) =>
        !terms.length ||
        terms.some((t) =>
          `${f.text} ${f.itemIds.map((id) => state.items.find((i) => i.id === id)?.name || "").join(" ")}`
            .toLowerCase()
            .includes(t.toLowerCase()),
        ),
    )
    .slice(0, 3);
  if (!fragments.length)
    return {
      outcome: "needs_info",
      answer:
        "目前没有找到与你这次回忆相关、仍获准读取的生活片段。可以补充物品或事件线索；不会拿其他经历代替。",
      steps: [],
      questions: [],
      evidenceIds: [],
      citations: [],
      memoryIds: [],
      source: "local-memory",
    };
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
