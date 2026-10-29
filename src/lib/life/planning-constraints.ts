import { withoutProhibitedActions } from "../agent/safety-language.ts";
/** Remove only the negated activity, preserving the rest of the user's goal. */
export const positiveGoalText = (q: string) =>
  q.replace(
    /(?:不想|不要|不愿|不用|不做|不)(?:再)?(?:拍照|拍摄|摄影|手工|加热|用水|出门)/g,
    " ",
  );
export const inventoryReference =
  /(?:只用|只使用|只有|仅用|仅使用|利用|使用|用)?(?:我(?:的)?|自己|家里|手边|当前|手头)?(?:已经?|曾经)?(?:登记|录入|拥有|现有|已有)(?:过|好)?(?:的)?(?:全部|这些)?(?:物品|东西|材料|资源)/g;
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
  const plain = name.replace(
    /^(?:测试|验收|我的|备用|轻便|便携|旅行|全新)+/g,
    "",
  );
  if (plain && q.includes(plain)) return true;
  for (const kind of [
    /相机|camera/i,
    /纸笔|纸和笔/,
    /玻璃杯|透明杯|水杯|杯子/,
    /手电筒|手电|flashlight/i,
    /背包|旅行包/,
    /衬衫|上衣/,
    /保鲜盒|食品盒/,
  ])
    if (kind.test(q) && kind.test(name)) return true;
  const chunks = name.match(/[\p{Script=Han}]+|[a-z0-9-]{4,}/giu) || [];
  return chunks.some((chunk) =>
    chunk.length >= 2 && q.includes(chunk)
      ? true
      : /^[a-z0-9-]+$/i.test(chunk)
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
    (/不要手工|不做手工/.test(goal) && /裁剪|折纸|粘贴/.test(proposed)) ||
    (/不(?:要|想)?(?:用水|加水)|不用水/.test(goal) &&
      /倒入.{0,8}水|加入.{0,8}水|注水|装水/.test(proposed)) ||
    (/不(?:要|想)?加热/.test(goal) && /加热|烧水|烤箱|热风/.test(proposed))
  );
}
