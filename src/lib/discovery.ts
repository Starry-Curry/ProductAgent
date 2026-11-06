import { canRead, type State, type Person } from "./domain.ts";
import { boundPack } from "./ai/harness.ts";
export type Conditions = {
  scene?: "indoor" | "outdoor";
  loadKg?: number;
  perShelfKg?: number;
  foodContact?: boolean;
};
export type Candidate = {
  id: string;
  title: string;
  itemIds: string[];
  status: "needs_confirmation" | "blocked";
  reasons: string[];
  evidenceIds: string[];
  source: "rule-based-candidate";
  tested: false;
};
/** Capabilities come from confirmed, version-matched packs, not item names or seed IDs. */
export function discover(
  state: State,
  actor: Person,
  conditions: Conditions = {},
): Candidate[] {
  const bound = state.items
    .filter(
      (i) =>
        canRead(i, actor) &&
        !i.demo &&
        ["在用", "闲置", "待确认"].includes(i.state),
    )
    .map((item) => ({ item, pack: boundPack(item) }));
  const result: Candidate[] = [];
  const audio = bound.filter((b) => b.pack?.id === "jbl-go4");
  for (let x = 0; x < audio.length; x++)
    for (let y = x + 1; y < audio.length; y++)
      result.push({
        id: `stereo:${audio[x].item.id}:${audio[y].item.id}`,
        title: "用两台已录入 Go 4，尝试立体声聆听",
        itemIds: [audio[x].item.id, audio[y].item.id],
        status: "needs_confirmation",
        reasons: [
          "需要两件独立实物；请确认电量、实物在场、官方配对说明及音量偏好。",
          "尚未验证连接或实际听感。",
        ],
        evidenceIds: ["go4:stereo"],
        source: "rule-based-candidate",
        tested: false,
      });
  for (const storage of bound.filter((b) =>
    b.pack?.capabilities?.includes("indoor-storage"),
  )) {
    for (const speaker of audio) {
      const reasons: string[] = [];
      if (conditions.scene === "outdoor") reasons.push("该推车仅允许室内使用");
      if (conditions.foodContact) reasons.push("该推车未获准直接接触食品");
      if ((conditions.loadKg ?? 0) > 18 || (conditions.perShelfKg ?? 0) > 6)
        reasons.push("所填载荷超出资料限定");
      const blocked = reasons.length > 0;
      result.push({
        id: `corner:${storage.item.id}:${speaker.item.id}`,
        title: "室内收纳与音乐角",
        itemIds: [storage.item.id, speaker.item.id],
        status: blocked ? "blocked" : "needs_confirmation",
        reasons: blocked
          ? reasons
          : [
              "任务协同候选，不是电气连接。请确认室内场景、每层载荷、稳定性及音量偏好。",
              "这里只依据尺寸与功能提出候选；尚未实物测试。",
            ],
        evidenceIds: ["raskog:load", "raskog:indoor", "go4:bluetooth"],
        source: "rule-based-candidate",
        tested: false,
      });
    }
  }
  return result.slice(0, 20);
}
