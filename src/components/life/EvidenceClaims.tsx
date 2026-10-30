"use client";
import { useState } from "react";
import type { Person } from "@/lib/domain";
export function EvidenceClaims({
  actor,
  itemId,
}: {
  actor: Person;
  itemId: string;
}) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState("");
  async function load() {
    setData(undefined);
    setError("");
    try {
      const r = await fetch(
        "/api/foundation?itemId=" + encodeURIComponent(itemId),
        { headers: { "x-demo-actor": actor } },
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "资料未能取得");
    }
  }
  return (
    <details
      className="life-task-continuity"
      onToggle={(e) => {
        if (e.currentTarget.open) void load();
      }}
    >
      <summary>核对型号资料与未知项</summary>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>{data.notice}</p>
          <p>
            完整型号：{data.model.model} · 地区：{data.model.region} · 固件未知
          </p>
          {!!data.reviewedFacts?.length&&<section><h4>已核对的具体主张</h4>{data.reviewedFacts.map((f:any)=><p key={f.source.documentId+f.predicate}>{f.description} <a href={f.source.url} target="_blank" rel="noreferrer">官方依据 · {f.region}</a></p>)}<small>只覆盖已审阅片段，不能据此认定其他属性或个人实物状态。</small></section>}
            {data.capabilities?.map((c:any)=><p key={c.capabilityId}>软件实验能力：亮度调整 · {c.sourceState==="software_verified"?"自有软件已执行并回读验证":"仅完成只读探测"}。不是硬件验证；操作仍需单独授权与确认。</p>)}
          {!data.claims.length && (
            <p>
              当前没有可用的适用型号原文。不能据此认定不支持某项功能；可在下方资料区补充准确来源。
            </p>
          )}
          {data.claims.slice(0, 12).map((c: any) => (
            <blockquote key={c.claimId}>
              <p>{c.normalizedValue}</p>
              {c.sourceRefs.map((s: any) => (
                <a
                  key={s.passageId}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  厂家原文 · {s.retrievedAt.slice(0, 10)}
                </a>
              ))}
            </blockquote>
          ))}
        </>
      )}
    </details>
  );
}
