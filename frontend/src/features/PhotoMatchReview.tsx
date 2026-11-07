import { useState } from "react";
import type { components } from "../generated/api";
import { request, type Experience, type Item } from "../api";

export type PhotoMatchResult = components["schemas"]["PhotoMatchResult"];

export function PhotoMatchFinder({ experience, items, onDone, initialResult }: {
  experience: PhotoMatchResult["experience"]; items: Item[]; onDone: () => Promise<unknown>;
  initialResult?: PhotoMatchResult;
}) {
  const [result, setResult] = useState<PhotoMatchResult | undefined>(initialResult);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [examined, setExamined] = useState<string[]>(initialResult?.examined_item_ids || []);
  async function recognize(continueRemaining = false) {
    setBusy(true);
    setError("");
    const resume = continueRemaining && result?.experience.version === experience.version;
    const previousCandidates = resume ? result?.candidates || [] : [];
    const previousIds = resume ? examined : [];
    if (!resume) {
      setResult(undefined);
      setExamined([]);
    }
    try {
      const next = await request<PhotoMatchResult>(`/experiences/${experience.id}/photo-matches`, "POST", {
        expected_version: experience.version, apply_confident: true, exclude_item_ids: previousIds,
      });
      const candidates = [...new Map([...previousCandidates, ...next.candidates].map((value) => [value.item_id, value])).values()];
      setResult({ ...next, candidates });
      setExamined([...new Set([...previousIds, ...next.examined_item_ids])]);
      await onDone();
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }
  return <div>
    <button type="button" className="quiet-button" disabled={busy} onClick={() => void recognize()}>
      {busy ? "正在认照片里的物品…" : "识别照片里的已有物品"}
    </button>
    {error && <p className="form-note" role="status">{error}</p>}
    {result && result.remaining_items > 0 && experience.version === result.experience.version &&
      <button type="button" className="quiet-button" disabled={busy} onClick={() => void recognize(true)}>
        {busy ? "继续比较中…" : `继续比较其余${result.remaining_items}件物品`}
      </button>}
    {result && (experience.version === result.experience.version
      ? result.candidates.length ? <PhotoMatchReview result={result} items={items} onDone={onDone} />
        : <p className="form-note">暂未认出可关联的已有物品，可以在“补充与纠正”中手动选择。</p>
      : <p className="form-note">回忆已更新；请在关联物品处查看当前结果，需要时可重新识别。</p>)}
  </div>;
}

/** Review edits the original wall entry; item-card views read those same links. */
export function PhotoMatchReview({ result, items, onDone }: {
  result: PhotoMatchResult;
  items: Item[];
  onDone: () => Promise<unknown>;
}) {
  const [selected, setSelected] = useState(result.experience.item_ids || []);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function apply() {
    setBusy(true);
    setError("");
    const row = result.experience;
    try {
      await request<Experience>(`/experiences/${row.id}`, "PUT", {
        title: row.title, text: row.text, item_ids: selected,
        photo_ids: row.photo_ids, occurred_on: row.occurred_on,
        allow_ai: row.allow_ai, expected_version: row.version,
      });
      await onDone();
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <section aria-label="照片中的已有物品">
    <p>{result.note}</p>
    <p className="form-note">只调整这段回忆的关联，不会向物品的其他使用者分享照片。</p>
    {result.candidates.map((candidate) => {
      const item = items.find((value) => value.id === candidate.item_id);
      if (!item) return null;
      return <div key={candidate.item_id}>
        <label className="check-label">
          <input type="checkbox" checked={selected.includes(candidate.item_id)} disabled={busy || saved}
            onChange={(event) => setSelected((previous) => event.target.checked
              ? [...previous, candidate.item_id]
              : previous.filter((id) => id !== candidate.item_id))} />
          {item?.photo_id && <img src={`/api/assets/${item.photo_id}`} alt="物品参考照" width={52} height={52} style={{ objectFit: "cover", borderRadius: 8 }} />}
          <span>{candidate.item_name} · {candidate.auto_linked ? "已关联，可取消" : "请核对是否是这一件"}</span>
        </label>
        <p className="form-note">{candidate.explanation}</p>
      </div>;
    })}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <button type="button" className="primary-button" disabled={busy || saved} onClick={() => void apply()}>
      {saved ? "关联已更新" : busy ? "保存中…" : "保存这些关联"}
    </button>
  </section>;
}
