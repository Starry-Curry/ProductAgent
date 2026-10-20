"use client";
import { useState } from "react";
import { Sparkles, ArrowUp, SlidersHorizontal } from "lucide-react";
import { syntheticItem } from "@/lib/life/availability";
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
  onAsk,
}: {
  items: Item[];
  ideas: LifeIdea[];
  itemId?: string;
  request: LifeRequest;
  refresh: () => Promise<void>;
  modelAvailable: boolean;
  onAsk?: (context: any) => void;
}) {
  const [goal, setGoal] = useState("想用已有的东西，做点新鲜的小事"),
    [minutes, setMinutes] = useState("30"),
    [synthetic, setSynthetic] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [onlySaved, setOnlySaved] = useState(false),
    [results, setResults] = useState<LifeIdea[] | null>(null);
  const [turns, setTurns] = useState<
    { goal: string; summary: string; ids: string[] }[]
  >([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    itemId ? [itemId] : [],
  );
  const [continuation, setContinuation] = useState<any>(undefined);
  const [cloud, setCloud] = useState(true);
  const [experienceIds, setExperienceIds] = useState<string[]>([]);
  const [gaps, setGaps] = useState<string[]>([]);
  const [sourceUrl, setSourceUrl] = useState(""),
    [sourcePreview, setSourcePreview] = useState("");
  async function generate(
    model = modelAvailable && cloud,
    followup?: string,
    omit: string[] = excluded,
  ) {
    setBusy(true);
    setNotice("");
    try {
      const d = await request("discover", {
        goal: followup || goal,
        continuation,
        itemId: omit.includes(itemId || "") ? undefined : itemId,
        itemIds: selectedIds.filter((id) => !omit.includes(id)),
        excludedItemIds: omit,
        experienceIds,
        previousIdeaIds: turns.findLast((t) => t.ids.length)?.ids || [],
        minutes: Number(minutes),
        includeSynthetic: synthetic,
        model,
      });
      setResults(d.ideas);
      setContinuation(d.continuation);
      if (d.continuation) setMinutes(String(d.continuation.minutes));
      setGaps(d.missing || []);
      setTurns((rows) => [
        ...rows.slice(-5),
        {
          goal: followup || goal,
          summary: d.understanding || "按当前可用物品、时间与来源条件筛选。",
          ids: d.ideas.map((i: LifeIdea) => i.id),
        },
      ]);
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
  ).filter(
    (i) =>
      (!itemId || i.itemIds.includes(itemId)) &&
      (onlySaved ||
        synthetic ||
        !i.itemIds.some((id) =>
          items.some((item) => item.id === id && syntheticItem(item)),
        )),
  );
  return (
    <section className="life-discovery">
      <div className="discovery-heading">
        <span className="life-eyebrow">MAKE SOMETHING OF TODAY</span>
        <h2>描述一个想法，让手边的物品参与。</h2>
        <button
          className="text-button"
          onClick={() => {
            setTurns([]);
            setResults([]);
            setExcluded([]);
            setGoal("想用已有的东西，做点新鲜的小事");
            setGaps([]);
          }}
        >
          新的探索
        </button>
        <p>
          说说想做什么、有什么限制。物间会核对已有物品，再一起把想法变成可尝试的步骤。
        </p>
      </div>
      {!turns.length && (
        <div className="goal-suggestions">
          {[
            "我有一小时，不买东西，想做点有趣的事",
            "想整理桌面，看看已有物品能怎么利用",
            "用选中的物品，换一个有趣的玩法",
          ].map((text) => (
            <button key={text} onClick={() => setGoal(text)}>
              {text} ↗
            </button>
          ))}
        </div>
      )}
      {turns.length > 0 && (
        <div className="discovery-thread" aria-label="本次探索对话">
          {turns.map((t, n) => (
            <div key={n}>
              <p className="goal-message">{t.goal}</p>
              <p className="goal-understanding">
                <Sparkles size={16} />
                {t.summary}
              </p>
            </div>
          ))}
        </div>
      )}
      <form
        className="goal-composer"
        onSubmit={(e) => {
          e.preventDefault();
          generate();
        }}
      >
        <label className="sr-only" htmlFor="discovery-goal">
          这次想怎样度过？
        </label>
        <textarea
          id="discovery-goal"
          value={goal}
          maxLength={500}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="例如：我有手电筒和玻璃杯，想试一个不买材料的新玩法…"
          rows={2}
        />
        <div className="composer-toolbar">
          <details>
            <summary>
              <SlidersHorizontal size={15} /> 可选条件 · {minutes}分钟
            </summary>
            <div className="discovery-options">
              <label>
                可用时间
                <select
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                >
                  {[
                    ...new Set([
                      5,
                      10,
                      15,
                      20,
                      30,
                      60,
                      90,
                      120,
                      Number(minutes),
                    ]),
                  ]
                    .sort((a, b) => a - b)
                    .map((n) => (
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
              {modelAvailable && (
                <label className="life-check">
                  <input
                    type="checkbox"
                    checked={cloud}
                    onChange={(e) => setCloud(e.target.checked)}
                  />
                  使用已授权千问规划
                </label>
              )}
              {ideas.some((i) => i.source === "user-submitted") && (
                <div>
                  <p>参考本人提供的经验（选中内容可用于本次已授权云端规划）</p>
                  {ideas
                    .filter((i) => i.source === "user-submitted")
                    .slice(0, 6)
                    .map((i) => (
                      <label className="life-check" key={i.id}>
                        <input
                          type="checkbox"
                          checked={experienceIds.includes(i.id)}
                          onChange={(e) =>
                            setExperienceIds((ids) =>
                              e.target.checked
                                ? [...ids, i.id]
                                : ids.filter((id) => id !== i.id),
                            )
                          }
                        />
                        {i.title}
                      </label>
                    ))}
                </div>
              )}
              <p>只用这些物品（不选则检索可用展柜）</p>
              <div className="discovery-pick-items">
                {items
                  .filter((i) => synthetic || !syntheticItem(i))
                  .map((i) => (
                    <label className="life-check" key={i.id}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(i.id)}
                        onChange={(e) =>
                          setSelectedIds((ids) =>
                            e.target.checked
                              ? [...ids, i.id]
                              : ids.filter((id) => id !== i.id),
                          )
                        }
                      />
                      {i.name}
                    </label>
                  ))}
              </div>
            </div>
          </details>
          <span>
            {modelAvailable && cloud
              ? "千问目标规划"
              : "离线能力规划 · 有限规则"}
          </span>
          <button className="button" disabled={busy} aria-label="找点新灵感">
            {busy ? "正在推敲…" : turns.length ? "继续探索" : "开始探索"}
            <ArrowUp size={16} />
          </button>
        </div>
      </form>
      {onAsk && (
        <button
          type="button"
          onClick={() =>
            onAsk({
              previousIdeaIds: turns.findLast((t) => t.ids.length)?.ids || [],
              continuation: continuation || {
                goal,
                minutes: Number(minutes),
                itemIds: selectedIds,
                excludedItemIds: excluded,
                restrictions: [],
              },
            })
          }
        >
          带着目标与方案，继续问物间
        </button>
      )}
      <div className="discovery-meta">
        <span>
          {selectedIds.length
            ? `已选择 ${selectedIds.length} 件物品`
            : "从本人可用展柜检索"}{" "}
          · {synthetic ? "含明确合成案例" : "不含合成案例"}
        </span>
        <button onClick={() => setOnlySaved((v) => !v)}>
          {onlySaved ? "返回本次探索" : "我的收藏"}
        </button>
      </div>
      {!!gaps.length && (
        <aside className="life-notice">
          <strong>还需要核对</strong>
          <ul>
            {gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </aside>
      )}
      {turns.length > 0 && (
        <div className="goal-suggestions">
          {["更有趣一点", "换个方向", "时间缩短到10分钟"].map((t) => (
            <button
              key={t}
              disabled={busy}
              onClick={() => {
                setGoal(t);
                generate(undefined, t);
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}
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
            {idea.rationale && (
              <p className="idea-rationale">{idea.rationale}</p>
            )}
            {!!idea.missing?.length && (
              <p className="life-notice">
                待确认 / 缺口：{idea.missing.join("；")}
              </p>
            )}
            <p className="life-muted">
              约 {idea.minutes} 分钟 ·{" "}
              {idea.itemIds
                .map(
                  (id) =>
                    items.find((i) => i.id === id)?.name || "已不可访问物品",
                )
                .join(" ＋ ")}
            </p>
            <details className="idea-steps" open>
              <summary>怎么开始 · {idea.steps.length} 步</summary>
              <ol>
                {idea.steps.map((s, n) => (
                  <li key={n}>{s}</li>
                ))}
              </ol>
            </details>
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
            {idea.experienceSources?.map((s) => (
              <p className="life-muted" key={s.id}>
                参考本人提供的经验：
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title} ↗
                  </a>
                ) : (
                  s.title
                )}{" "}
                · 第三方适用性未独立核验
              </p>
            ))}
            {idea.sourceUrl && (
              <p>
                <a href={idea.sourceUrl} target="_blank" rel="noreferrer">
                  用户提供的经验来源 ↗
                </a>{" "}
                · 未独立核验
              </p>
            )}
            <div className="idea-replace-items">
              {idea.itemIds.map((id) => (
                <button
                  key={id}
                  disabled={busy}
                  onClick={() => {
                    const omit = [...new Set([...excluded, id])];
                    setExcluded(omit);
                    generate(undefined, "不用这件，换一种组合", omit);
                  }}
                >
                  不用{items.find((i) => i.id === id)?.name || "这件物品"} ↻
                </button>
              ))}
            </div>
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
            <details className="idea-feedback">
              <summary>记录实际结果 / 下次调整</summary>
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
            </details>
          </article>
        ))}
      </div>
      {!rows.length && (
        <p className="life-muted">
          还没有合适的方案。可以补充目标、确认物品状态，或在可选条件中明确体验合成案例。
        </p>
      )}
      <details className="life-card">
        <summary>保存自己找到的玩法 / 获准使用的经验</summary>
        <p className="life-muted">
          支持主动提供来源与选定内容；不连接私有账号，不抓取社区全站。普通公开网页可以尝试读取，受限内容由你提供获准使用的必要片段。
        </p>
        <label>
          来源链接（可选）
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>
        <button
          disabled={!sourceUrl || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const d = await request("fetchSource", { url: sourceUrl });
              setSourcePreview(d.text);
              setNotice(d.notice);
            } catch (e) {
              setNotice((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          主动读取这份公开来源
        </button>
        {sourcePreview && (
          <p className="life-source-excerpt">{sourcePreview}</p>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            try {
              const d = await request("submitIdea", {
                title: f.get("title"),
                itemIds: f.getAll("itemIds"),
                minutes: Number(f.get("minutes")),
                steps: String(f.get("steps"))
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
                limits: String(f.get("limits"))
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
                sourceUrl: sourceUrl || undefined,
              });
              setResults([d.idea]);
              await refresh();
              setNotice(
                "已保存为用户提供的经验候选，未标作官方功能或实物验证。",
              );
            } catch (e) {
              setNotice((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            玩法标题
            <input name="title" required maxLength={100} />
          </label>
          <div className="life-link-options">
            {items.map((i) => (
              <label className="life-check" key={i.id}>
                <input
                  type="checkbox"
                  name="itemIds"
                  value={i.id}
                  defaultChecked={i.id === itemId}
                />
                {i.name}
              </label>
            ))}
          </div>
          <label>
            大约需要多少分钟
            <input
              type="number"
              name="minutes"
              min="1"
              max="240"
              defaultValue="20"
              required
            />
          </label>
          <label>
            步骤（每行一条，仅提供获准使用的内容）
            <textarea name="steps" required maxLength={3000} />
          </label>
          <label>
            关键条件与未验证限制（每行一条）
            <textarea name="limits" required maxLength={2000} />
          </label>
          <button disabled={busy}>保存经验候选</button>
        </form>
      </details>
    </section>
  );
}
