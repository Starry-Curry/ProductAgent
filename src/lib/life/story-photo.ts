import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canRead, type State, type Person } from "../domain.ts";
import type { Provider } from "../ai/provider.ts";
import { recognizeOwnedPhoto } from "./vision.ts";
import { syntheticItem } from "./availability.ts";

/** Visual observations are evidence candidates, never instance identity. No personal inventory is sent to Vision. */
export async function matchStoryPhoto(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  input: unknown,
  env: Record<string, string | undefined> = process.env,
  provider?: Provider,
) {
  const v = z
    .object({ mediaId: z.string().uuid(), confirmed: z.literal(true) })
    .strict()
    .parse(input);
  const result = await recognizeOwnedPhoto(
    db,
    actor,
    v.mediaId,
    true,
    env,
    provider,
  );
  const items = read().items.filter(
    (i) => i.owner === actor && canRead(i, actor) && !syntheticItem(i),
  );
  const matches = result.candidates.map((c) => {
    const clean = (s: string) =>
      s
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s\-_]/g, "");
    const candidates = items
      .filter((i) => {
        if (c.model && i.model && clean(c.model) !== clean(i.model))
          return false;
        if (c.brand && i.brand && clean(c.brand) !== clean(i.brand))
          return false;
        return (
          (c.model && i.model && clean(c.model) === clean(i.model)) ||
          clean(i.name).includes(clean(c.name)) ||
          clean(c.name).includes(clean(i.name))
        );
      })
      .map((i) => ({
        itemId: i.id,
        name: i.name,
        reason: c.model
          ? "可见型号候选一致，仍不能确定是哪一个实例"
          : "名称线索相符，不足以确认具体实例",
      }));
    return { observation: c, candidates, uncertain: true as const };
  });
  return {
    matches,
    notice:
      "仅候选：相似外观或同型号不证明具体实例。可逐件确认、重新选择或零关联；没有推断人物、关系或故事。",
  };
}
