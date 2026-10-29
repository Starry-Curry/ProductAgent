import { createHash } from "node:crypto";
import { type State, type Person } from "../domain.ts";
import { AgentError } from "../agent/contracts.ts";
import { readItemContext } from "./items.ts";

/** P1 read contract. No new tables, memory permissions or inferred facts.
 * Reread/reauthorize on every use: the digest is neither a grant nor a durable
 * Item revision. Private fields do not affect this model-facing snapshot.
 */
export function sharedItemKnowledge(
  state: State,
  actor: Person,
  itemIds: string[],
  options: { demo?: boolean } = {},
) {
  const items = [...new Set(itemIds)].map((id) => {
    const item = readItemContext(state, actor, id, options.demo === true);
    if (!item) throw new AgentError("所选物品不存在或未获授权", 403);
    return structuredClone(item);
  });
  const canonical = [...items].sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: "wujian-shared-items-v1" as const,
    items,
    snapshot: {
      kind: "legacy-projection-sha256" as const,
      digest: createHash("sha256")
        .update(JSON.stringify(canonical))
        .digest("hex"),
    },
    evidencePolicy:
      "登记是用户报告；未知不补全；快照不授予权限；故事与个人记忆仍按原权限单独检索。",
  };
}
