import { withoutProhibitedActions } from "../agent/safety-language.ts";
export const noPurchase = (q: string) =>
  /不(?:想|要)?(?:再)?(?:买|购买|采购|花钱)|零预算|预算\s*[为是：:]?\s*0\s*元/.test(
    q,
  );
export function goalDuration(q: string): number | undefined {
  const n = q.match(/(\d+(?:\.\d+)?)\s*(分钟|小时)/);
  if (n)
    return Math.max(
      1,
      Math.min(240, Math.floor(Number(n[1]) * (n[2] === "小时" ? 60 : 1))),
    );
  if (/三十分钟|半小时/.test(q)) return 30;
  if (/二十分钟/.test(q)) return 20;
  if (/十分钟/.test(q)) return 10;
  if (/五分钟/.test(q)) return 5;
  if (/一刻钟/.test(q)) return 15;
  if (/两(?:个)?小时/.test(q)) return 120;
  if (/一(?:个)?小时/.test(q)) return 60;
}
/** Name fragments only, not product facts or new inventory. */
export function mentionsItem(q: string, name: string) {
  if (q.includes(name)) return true;
  const chunks = name.match(/[\p{Script=Han}]+|[a-z0-9-]{4,}/giu) || [];
  return chunks.some((chunk) =>
    /^[a-z0-9-]+$/i.test(chunk)
      ? q.toLowerCase().includes(chunk.toLowerCase())
      : Array.from({ length: Math.max(0, chunk.length - 2) }, (_, n) =>
          chunk.slice(n, n + 3),
        ).some((w) => q.includes(w)),
  );
}
export function violatesGoal(goal: string, proposed: string) {
  proposed = withoutProhibitedActions(proposed);
  return (
    (noPurchase(goal) && /购买|去买|添置|下单/.test(proposed)) ||
    (/室内|不出门|在家/.test(goal) &&
      /去户外|外出|出门|去公园/.test(proposed)) ||
    (/静音|不要声音|不要音乐|不放音乐/.test(goal) &&
      /播放音乐|打开音箱|放歌|大声/.test(proposed)) ||
    (/不(?:要|想|用).{0,3}(拍照|摄影)/.test(goal) &&
      /拍照|拍摄|摄影/.test(proposed)) ||
    (/不要手工|不做手工/.test(goal) && /裁剪|折纸|粘贴/.test(proposed))
  );
}
