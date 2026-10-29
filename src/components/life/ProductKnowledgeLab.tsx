"use client";
import { useState } from "react";
import { alphaProductPacks } from "@/lib/catalog/alpha-products";
export function ProductKnowledgeLab({ onTry }: { onTry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <details className="life-card">
      <summary>真实商品知识实验 · 2 款测试商品</summary>
      <p>
        型号和资料真实，持有与可用状态是测试设定，不代表你拥有。官方事实、用途推导和实物条件分开显示。
      </p>
      {alphaProductPacks.map((p) => (
        <article key={p.id}>
          <h3>
            {p.product} · {p.model}
          </h3>
          <a href={p.source.url} target="_blank" rel="noreferrer">
            官方资料 · 核对于 {p.source.checkedAt}
          </a>
          <ul>
            {p.claims.map((f) => (
              <li key={f.id}>资料事实：{f.text}</li>
            ))}
          </ul>
          <p>仍未知：{p.understanding?.unknowns.join("、")}</p>
          {p.understanding?.possibilities.map((x) => (
            <p key={x.function}>
              用途推导（待验证）：{x.function}。{x.principle}；条件：
              {x.conditions.join("；")}
            </p>
          ))}
        </article>
      ))}
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onTry();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        添加合成测试记录并用于探索
      </button>
      <p>只添加私密测试记录；不会替你登记真实购买或验证设备。</p>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
