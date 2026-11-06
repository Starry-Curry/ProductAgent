"use client";
import { productPacks } from "@/lib/products";
import { useState } from "react";
import type { Person } from "@/lib/domain";
import type { Candidate } from "@/lib/discovery";
export function EvidenceDiscovery({ actor }: { actor: Person }) {
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel">
      <h2>根据实际物品，找新的组合</h2>
      <p>
        先为新增物品确认型号与资料包。当前支持 Go 4 音箱与指定货号 RÅSKOG
        推车；这是规则匹配候选，不是已验证妙用。
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          const f = new FormData(e.currentTarget);
          const query = new URLSearchParams();
          for (const [k, v] of f) if (String(v)) query.set(k, String(v));
          try {
            const r = await fetch("/api/discover?" + query, {
              headers: { "x-demo-actor": actor },
            });
            const d = await r.json();
            if (!r.ok) throw Error(d.error);
            setRows(d.candidates);
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            场景
            <select name="scene">
              <option value="indoor">室内</option>
              <option value="outdoor">室外</option>
            </select>
          </label>
          <label>
            拟放置的总重量（千克，可留空）
            <input name="loadKg" type="number" min="0" step="0.1" />
          </label>
          <label>
            单层最大重量（千克，可留空）
            <input name="perShelfKg" type="number" min="0" step="0.1" />
          </label>
        </div>
        <button className="button secondary" disabled={busy}>
          {busy ? "正在核对…" : "核对可用组合"}
        </button>
      </form>
      {message && <p role="alert">{message}</p>}
      {rows?.length === 0 && (
        <p>
          暂未找到具备足够资料的组合。不按物品名称猜测能力；可先添加并确认对应物品。
        </p>
      )}
      {rows?.map((row) => (
        <article className="source-card" key={row.id}>
          <h3>{row.title}</h3>
          <span className="badge">
            {row.status === "blocked" ? "条件不允许" : "候选 · 待确认"}
          </span>
          <ul>
            {row.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <details>
            <summary>查看依据与适用型号</summary>
            {row.evidenceIds.map((id) => {
              const pack = productPacks.find((p) =>
                p.claims.some((c) => c.id === id),
              );
              const fact = pack?.claims.find((c) => c.id === id);
              return pack && fact ? (
                <p key={id}>
                  {fact.text}{" "}
                  <a href={pack.source.url} target="_blank" rel="noreferrer">
                    {pack.product} · 官方资料 ↗
                  </a>
                </p>
              ) : null;
            })}
          </details>
        </article>
      ))}
    </section>
  );
}
