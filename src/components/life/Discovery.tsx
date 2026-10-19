"use client";
import { useState } from "react";
import type { Item } from "@/lib/domain";
import type { LifeIdea } from "@/lib/life/ideas";
import type { LifeRequest } from "./Intake";
export function Discovery({
  items,
  ideas,
  itemId,
  request,
  refresh,
  modelAvailable,
}: {
  items: Item[];
  ideas: LifeIdea[];
  itemId?: string;
  request: LifeRequest;
  refresh: () => Promise<void>;
  modelAvailable: boolean;
}) {
  const [goal, setGoal] = useState("想用已有的东西，做点新鲜的小事"),
    [minutes, setMinutes] = useState("30"),
    [synthetic, setSynthetic] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [onlySaved, setOnlySaved] = useState(false),
    [results, setResults] = useState<LifeIdea[] | null>(null);
  async function generate(model = false) {
    setBusy(true);
    setNotice("");
    try {
      const d = await request("discover", {
        goal,
        itemId,
        minutes: Number(minutes),
        includeSynthetic: synthetic,
        model,
      });
      setResults(d.ideas);
      await refresh();
      if (!d.ideas.length)
        setNotice(
          "暂时没有满足条件的方案。先确认物品可用状态，或调整时间与要求；不会把缺少的物品当成已有。",
        );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function feedback(idea: LifeIdea, changes: Partial<LifeIdea>) {
    try {
      await request("ideaFeedback", {
        id: idea.id,
        saved: idea.saved || false,
        outcome: idea.outcome || "未尝试",
        note: idea.note || "",
        ...changes,
      });
      setResults(
        (rows) =>
          rows?.map((r) => (r.id === idea.id ? { ...r, ...changes } : r)) ||
          null,
      );
      await refresh();
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  const rows = (
    onlySaved ? ideas.filter((i) => i.saved) : results || ideas.slice(0, 6)
  ).filter((i) => !itemId || i.itemIds.includes(itemId));
  return (
    <section>
      <div className="life-section-head">
        <div>
          <span className="life-eyebrow">WITH WHAT YOU HAVE</span>
          <h2>已有的东西，还有新可能</h2>
          <p>不用先有一个大计划。告诉我现在的时间与心情，从手边开始。</p>
        </div>
      </div>
      <form
        className="life-card"
        onSubmit={(e) => {
          e.preventDefault();
          generate();
        }}
      >
        <label>
          这次想怎样度过？
          <input
            value={goal}
            maxLength={500}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="例如：安静一点，20 分钟，不买材料"
          />
        </label>
        <div className="life-actions">
          <label>
            可用时间
            <select
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            >
              {[10, 20, 30, 60].map((n) => (
                <option key={n} value={n}>
                  {n} 分钟
                </option>
              ))}
            </select>
          </label>
          <label className="life-check">
            <input
              type="checkbox"
              checked={synthetic}
              onChange={(e) => setSynthetic(e.target.checked)}
            />
            包含合成演示物品
          </label>
          <button className="button" disabled={busy}>
            {busy ? "正在找灵感…" : "找点新灵感"}
          </button>
          {modelAvailable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => generate(true)}
            >
              用已授权模型生成
            </button>
          )}
          <button type="button" onClick={() => setOnlySaved((v) => !v)}>
            {onlySaved ? "看看全部" : "我的收藏"}
          </button>
        </div>
        <small>
          本地能力规则匹配不同物品实例；模型生成需另外启用费用授权。数量、状态和条件仍须本人核实。
        </small>
      </form>
      {notice && (
        <p className="life-notice" role="status">
          {notice}
        </p>
      )}
      <div className="life-idea-grid">
        {rows.map((idea) => (
          <article className="life-card life-idea" key={idea.id}>
            <span className="life-pill">
              {idea.source === "model-creative"
                ? "AI 生成创意"
                : idea.source === "user-submitted"
                  ? "用户提供的经验"
                  : "本地创意候选"}{" "}
              · 未实物验证
            </span>
            <h3>{idea.title}</h3>
            <p className="life-muted">
              约 {idea.minutes} 分钟 ·{" "}
              {idea.itemIds
                .map(
                  (id) =>
                    items.find((i) => i.id === id)?.name || "已不可访问物品",
                )
                .join(" ＋ ")}
            </p>
            <ol>
              {idea.steps.map((s, n) => (
                <li key={n}>{s}</li>
              ))}
            </ol>
            <details>
              <summary>关键条件与资料来源</summary>
              <ul>
                {idea.limits.map((s, n) => (
                  <li key={n}>{s}</li>
                ))}
              </ul>
              {idea.evidence.length ? (
                <>
                  <p>下列资料只支持对应物品事实，不代表验证了整个玩法。</p>
                  {idea.evidence.map((f) => (
                    <p key={f.id}>
                      {f.text}{" "}
                      <a href={f.url} target="_blank" rel="noreferrer">
                        核对原来源 ↗
                      </a>
                    </p>
                  ))}
                </>
              ) : (
                <p>
                  没有型号级官方依据。方案来自类别和已登记能力，不宣称官方用途。
                </p>
              )}
            </details>
            <div className="life-actions">
              <button onClick={() => feedback(idea, { saved: !idea.saved })}>
                {idea.saved ? "已收藏 · 取消" : "收藏这个想法"}
              </button>
              <select
                aria-label={`${idea.title} 的尝试结果`}
                value={idea.outcome || "未尝试"}
                onChange={(e) => feedback(idea, { outcome: e.target.value })}
              >
                {[
                  "未尝试",
                  "准备尝试",
                  "用户报告有效",
                  "未成功",
                  "不感兴趣",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <label>
              实际结果 / 下次调整
              <textarea
                defaultValue={idea.note || ""}
                maxLength={1000}
                placeholder="例如：缺一张纸；下次想换个方向"
                onBlur={(e) => {
                  if (e.target.value !== idea.note)
                    feedback(idea, { note: e.target.value });
                }}
              />
            </label>
          </article>
        ))}
      </div>
      {!rows.length && (
        <div className="life-empty">选好条件，开始找一个值得尝试的小想法。</div>
      )}
    </section>
  );
}
