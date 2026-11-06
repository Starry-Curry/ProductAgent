"use client";
import { useEffect, useState } from "react";
import type { Item, Person } from "@/lib/domain";
import { findPack, type ProductPack } from "@/lib/products";
import type { Run, Feedback } from "@/lib/ai/types";

import { AssistantConversation } from "./AssistantConversation";
import { SellerSupport } from "./SellerSupport";
import type { Action } from "./FamilyTasks";
type RecordEntry = { run: Run; feedback: Feedback | null };
const statusLabel: Record<Run["status"], string> = {
  running: "运行中／可查看阶段记录",
  succeeded: "资料事实已给出",
  needs_identity: "等待确认型号",
  unavailable: "尚不可用",
  failed: "请求失败",
};
export function ItemService({
  item,
  actor,
  bind,
  elder = false,
  initialQuestion = "",
  act,
}: {
  elder?: boolean;
  initialQuestion?: string;
  act?: Action;
  item: Item;
  actor: Person;
  bind: (packId: string) => Promise<boolean>;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [showIdentity, setShowIdentity] = useState(false);
  const [query, setQuery] = useState(item.model === "待确认" ? "" : item.model);
  const [candidates, setCandidates] = useState<ProductPack[] | null>(null);
  const [selected, setSelected] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [replay, setReplay] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [records, setRecords] = useState<RecordEntry[]>([]);
  const pack = item.productBinding && findPack(item.productBinding.packId);
  const headers = { "Content-Type": "application/json", "x-demo-actor": actor };
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/service-runs?itemId=${encodeURIComponent(item.id)}`, {
      headers: { "x-demo-actor": actor },
      signal: controller.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setRecords((current) => [
          ...current,
          ...d.records.filter(
            (row: RecordEntry) => !current.some((r) => r.run.id === row.run.id),
          ),
        ]);
      })
      .catch((e) => {
        if (e.name !== "AbortError")
          setError("暂时无法读取服务记录，请重新打开物品。");
      });
    return () => controller.abort();
  }, [actor, item.id]);
  async function search() {
    setBusy(true);
    setError("");
    setCandidates(null);
    setSelected("");
    setConfirmed(false);
    try {
      const r = await fetch(`/api/products?q=${encodeURIComponent(query)}`);
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setCandidates(d.candidates);
    } catch {
      setError("资料查询失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function feedback(runId: string, outcome: Feedback["outcome"]) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/service-runs", {
        method: "POST",
        headers,
        body: JSON.stringify({ runId, outcome }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setRecords((rows) =>
        rows.map((row) =>
          row.run.id === runId ? { ...row, feedback: d.feedback } : row,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "反馈未保存，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel item-service simple-service">
      <h2>有什么不会用的？</h2>
      <AssistantConversation
        actor={actor}
        item={item}
        initialQuestion={initialQuestion}
        onQuestion={setQuestion}
        elder={elder}
        onHandoff={() => window.dispatchEvent(new Event("workspace-updated"))}
      />
      {error && <p role="alert">{error}</p>}
      <SellerSupport item={item} actor={actor} act={act} question={question} />
      {!elder && (
        <details
          className="knowledge-details"
          open={showIdentity}
          onToggle={(e) => setShowIdentity(e.currentTarget.open)}
        >
          <summary>
            {pack ? "查看物品说明 / 型号资料" : "补充型号，查找对应说明"}
          </summary>
          {pack && (
            <article className="source-card">
              <h3>
                {pack.product} · {pack.model}
              </h3>
              <p>
                {item.demo
                  ? "演示资料绑定，尚未核对用户实物"
                  : "型号由用户确认"}{" "}
                · 资料版本 {pack.version}
              </p>
              <ul>
                {pack.claims.map((claim) => (
                  <li key={claim.id}>{claim.text}</li>
                ))}
              </ul>
              <a href={pack.source.url} target="_blank" rel="noreferrer">
                查看官方来源 ↗
              </a>
              <p className="muted">
                {pack.source.section} · 核对日期 {pack.source.checkedAt}
              </p>
              <p>{pack.limits[1]}</p>
            </article>
          )}
          {item.owner === actor && (
            <details open>
              <summary>{pack ? "重新核对型号" : "查询对应资料"}</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  search();
                }}
              >
                <label>
                  系列名或铭牌型号
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    maxLength={100}
                    placeholder="例如 M185 或 M-R0061"
                    required
                  />
                </label>
                <p className="muted">
                  可查询小米家电、宜家家具、罗技鼠标和 JBL
                  音箱等精选资料；请核对地域与具体型号。
                </p>
                <button className="button secondary" disabled={busy}>
                  查询资料
                </button>
              </form>
              {candidates?.length === 0 && (
                <p role="status">
                  暂无匹配资料。请补充准确铭牌型号，或联系卖家取得说明，不会套用其他商品资料。
                </p>
              )}
              {!!candidates?.length && (
                <div className="source-card">
                  <p>系列名不等于具体型号。请查看鼠标底部 M/N 后选择：</p>
                  {candidates.map((p) => (
                    <label className="candidate" key={p.id}>
                      <input
                        type="radio"
                        name="product-candidate"
                        checked={selected === p.id}
                        onChange={() => {
                          setSelected(p.id);
                          setConfirmed(false);
                        }}
                      />
                      {p.product} · {p.model}
                    </label>
                  ))}
                  <label className="candidate">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    我已核对实物铭牌，与所选型号一致
                  </label>
                  <button
                    className="button"
                    disabled={busy || !selected || !confirmed}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        if (!(await bind(selected)))
                          setError("型号确认未保存，请重试。");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    确认型号并关联资料
                  </button>
                </div>
              )}
            </details>
          )}
          {!pack && item.owner !== actor && (
            <p>请物品所有者核对型号并关联资料后再提问。</p>
          )}
        </details>
      )}
      {!elder && (
        <details className="service-history">
          <summary>之前的问答与处理记录（{records.length}）</summary>
          <p className="muted">
            保存阶段事件、来源快照和通过校验的资料事实，不保存私人问题或失败回答正文。
          </p>
          {records.map(({ run, feedback: saved }) => (
            <article className="source-card" key={run.id}>
              <strong>{statusLabel[run.status]}</strong>
              <small>
                {" "}
                · {new Date(run.startedAt).toLocaleString("zh-CN")}
              </small>
              {saved ? (
                <p>
                  {saved.outcome === "completed"
                    ? "用户确认完成"
                    : "用户反馈未解决"}{" "}
                  · 未经过设备验证
                </p>
              ) : (
                run.status === "succeeded" && (
                  <div className="inline">
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => feedback(run.id, "completed")}
                    >
                      确认本次完成
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => feedback(run.id, "unresolved")}
                    >
                      仍未解决
                    </button>
                  </div>
                )
              )}
              <details>
                <summary>本地演示调试 · 查看运行依据</summary>
                <p>运行 {run.id}</p>
                <button
                  className="button secondary"
                  type="button"
                  onClick={async () => {
                    const response = await fetch(
                      `/api/service-runs?runId=${encodeURIComponent(run.id)}&replay=1`,
                      { headers },
                    );
                    const body = await response.json();
                    if (response.ok)
                      setReplay({
                        id: run.id,
                        text: JSON.stringify(body.replay, null, 2),
                      });
                    else setError(body.error);
                  }}
                >
                  本地回放校验（不调用模型）
                </button>
                {replay?.id === run.id && (
                  <pre
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {replay.text}
                  </pre>
                )}
                <p>
                  {run.tools.map((t) => `${t.name}: ${t.status}`).join(" → ")}
                </p>
                <p>
                  {run.model || "未调用模型"} · {run.latencyMs} ms ·{" "}
                  {run.tokens
                    ? `${run.tokens.input} 输入 / ${run.tokens.output} 输出 tokens`
                    : "用量未知"}{" "}
                  · 费用未计算
                </p>
                <p>来源：{run.evidenceIds.join("、") || "无回答引用"}</p>
              </details>
            </article>
          ))}
        </details>
      )}
    </section>
  );
}
