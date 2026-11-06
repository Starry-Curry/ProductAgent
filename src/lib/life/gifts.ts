import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { mutate, type State, type Person } from "../domain.ts";
import { listFragments } from "./stories.ts";
import { AgentError } from "../agent/contracts.ts";
export function createLifeGift(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  input: unknown,
) {
  const v = z
    .object({
      itemId: z.string().min(1),
      message: z.string().trim().min(1).max(1000),
      fragmentIds: z.array(z.string().uuid()).max(20),
    })
    .parse(input);
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = read();
    if (!state.items.some((i) => i.id === v.itemId && i.owner === actor))
      throw new AgentError("仅物品所有者可赠送", 403);
    const fragments = listFragments(db, state, actor, v.itemId);
    const memoryIds: string[] = [];
    for (const id of [...new Set(v.fragmentIds)]) {
      const f = fragments.find((f) => f.id === id);
      if (!f) throw new AgentError("所选故事未获授权", 403);
      const snapshot = `life-fragment:${id}:v${f.revision}`;
      memoryIds.push(snapshot);
      if (
        !state.memories.some((m) => m.id === snapshot && m.itemId === v.itemId)
      )
        state.memories.push({
          id: snapshot,
          itemId: v.itemId,
          author: actor,
          owner: actor,
          text: f.text,
          at: f.createdAt,
          shared: false,
          demo: f.demo,
          giftSnapshot: true,
        });
    }
    mutate(state, actor, "gift", {
      itemId: v.itemId,
      message: v.message,
      memoryIds,
      includeKnowledge: false,
    });
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(state),
    );
    db.exec("COMMIT");
    return state.gifts.at(-1)!;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
