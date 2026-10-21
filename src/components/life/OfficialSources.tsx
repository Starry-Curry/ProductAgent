"use client";
import { useState } from "react";
import type { LifeRequest } from "./Intake";
export function OfficialSources({
  brand,
  model,
  request,
  onChoose,
}: {
  brand: string;
  model: string;
  request: LifeRequest;
  onChoose: (document: any) => Promise<void> | void;
}) {
  const [result, setResult] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="life-official-sources">
      <button
        type="button"
        disabled={busy || !brand.trim() || !model.trim() || model === "待确认"}
        onClick={async () => {
          setBusy(true);
          setError("");
          setResult(null);
          try {
            setResult(await request("findOfficial", { brand, model }));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "查找官方资料…" : "按品牌与型号查找官方资料"}
      </button>
      <p className="life-muted">
        仅将品牌、型号用于有限官方站点查询，不发送照片或私人记忆；未找到时可人工补充。
      </p>
      {error && <p role="alert">{error}</p>}
      {result && (
        <div className="life-notice">
          <p role="status">{result.notice}</p>
          {result.documents.map((d: any) => (
            <details key={d.url}>
              <summary>{d.title}</summary>
              <p className="life-source-excerpt">{d.text.slice(0, 1400)}</p>
              <a href={d.url} target="_blank" rel="noreferrer">
                核对原始网页 ↗
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await onChoose(d);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                选用这份资料
              </button>
              {d.links?.slice(0, 8).map((l: any) => (
                <p key={l.url}>
                  <a href={l.url} target="_blank" rel="noreferrer">
                    {l.title} ↗
                  </a>
                </p>
              ))}
            </details>
          ))}
          {result.issues?.map((s: string, n: number) => (
            <p key={n}>{s}</p>
          ))}
          <div className="life-actions">
            {result.officialHome && (
              <a href={result.officialHome} target="_blank" rel="noreferrer">
                打开品牌官网 ↗
              </a>
            )}
            <a href={result.searchURL} target="_blank" rel="noreferrer">
              手动检索官方产品 / 说明书 / FAQ ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
