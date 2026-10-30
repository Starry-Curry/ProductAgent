"use client";
import { ProductKnowledgeLab } from "./ProductKnowledgeLab";
import { useState, useEffect, useRef } from "react";
import { usePublicDemo } from "../DemoBoundary";
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
  homeId,
}: {
  items: Item[];
  ideas: LifeIdea[];
  itemId?: string;
  request: LifeRequest;
  refresh: () => Promise<void>;
  modelAvailable: boolean;
  onAsk?: (context: any) => void;
  homeId?: "young-apartment-v1";
}) {
  const publicMode = usePublicDemo();
  const focusedItem = items.find((i) => i.id === itemId);
  const initialGoal = focusedItem
    ? `我想让${focusedItem.name}更符合我的生活。结合我的偏好和家里已有物品，探索不同的新用途，也可以考虑已有物品的组合。`
    : "想用已有的东西，做点新鲜的小事";
  const [goal, setGoal] = useState(initialGoal),
    [minutes, setMinutes] = useState("30"),
    [synthetic, setSynthetic] = useState(publicMode || !!homeId),
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
  const [shareFeedback, setShareFeedback] = useState(false);
  const [useInspiration, setUseInspiration] = useState(false);

  const [experienceIds, setExperienceIds] = useState<string[]>([]);
  const [gaps, setGaps] = useState<string[]>([]);
  const [waitSeconds, setWaitSeconds] = useState(0);
  useEffect(() => {
    setWaitSeconds(0);
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(
      () => setWaitSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);
  const [sourceUrl, setSourceUrl] = useState(""),
    [sourcePreview, setSourcePreview] = useState("");
  const [creativeEvidenceIds, setCreativeEvidenceIds] = useState<string[]>([]),
    [providedText, setProvidedText] = useState(""),
    [rights, setRights] = useState(false);
  async function generate(
    model = modelAvailable && cloud,
    followup?: string,
    omit: string[] = excluded,
    selectedIdea?: LifeIdea,
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
        creativeEvidenceIds,
        previousIdeaIds: turns.findLast((t) => t.ids.length)?.ids || [],
        feedbackIdeaIds: shareFeedback
          ? turns.findLast((t) => t.ids.length)?.ids || []
          : [],
        minutes: Number(minutes),
        includeSynthetic: synthetic,
        model,
        review: false,
        engine: selectedIdea ? "goal" : useInspiration ? "hybrid" : "free",
        selectedIdeaId: selectedIdea?.id,
        page: itemId ? "item" : "discover",
        ...(homeId ? { homeId } : {}),
      });
      if(d.ideas.length || !selectedIdea) setResults(d.ideas);
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
          d.failure?.message ||
            "暂时没有满足条件的方案。先确认物品可用状态，或调整时间与要求；不会把缺少的物品当成已有。",
        );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const feedbackQueue = useRef(Promise.resolve());
  const feedbackLatest = useRef(new Map<string, LifeIdea>());
  async function feedback(idea: LifeIdea, changes: Partial<LifeIdea>) {
    // Rapid save/result/note changes must merge before sending the full contract.
    // Serial requests prevent a slow earlier response overwriting a later edit.
    const next = {
      ...idea,
      ...feedbackLatest.current.get(idea.id),
      ...changes,
    };
    feedbackLatest.current.set(idea.id, next);
    const operation = feedbackQueue.current
      .catch(() => {})
      .then(async () => {
        await request("ideaFeedback", {
          id: next.id,
          saved: next.saved || false,
          outcome: next.outcome || "未尝试",
          note: next.note || "",
        });
        setResults(
          (rows) =>
            rows?.map((r) => (r.id === idea.id ? { ...r, ...changes } : r)) ||
            null,
        );
        await refresh();
      });
    feedbackQueue.current = operation;
    try {
      await operation;
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
        i.demo ||
        synthetic ||
        !i.itemIds.some((id) =>
          items.some((item) => item.id === id && syntheticItem(item)),
        )),
  );
  return (
    <section
      className={`life-discovery${itemId ? " object-reimagine" : ""}`}
      aria-label={itemId ? "这件物品的新可能" : "探索新用途"}
    >
      {!itemId && (
        <ProductKnowledgeLab
          onTry={async () => {
            await request("alphaSamples", { confirmed: true });
            setSynthetic(true);
            await refresh();
            setNotice(
              "已添加测试商品。勾选范围后描述想实现的效果；这些记录不代表真实拥有。",
            );
          }}
        />
      )}
      <div className="discovery-heading">
        <span className="life-eyebrow">
          {itemId ? "REIMAGINE THIS OBJECT" : "MAKE SOMETHING OF TODAY"}
        </span>
        <h2>
          {focusedItem
            ? `让${focusedItem.name}，多一种可能。`
            : "描述一个想法，让手边的物品参与。"}
        </h2>
        <button
          className="text-button"
          onClick={() => {
            setTurns([]);
            setResults([]);
            setExcluded([]);
            setGoal(initialGoal);
            setGaps([]);
          }}
        >
          新的探索
        </button>
        <p>
          {itemId
            ? "从它已有的性质出发，找一个真正服务你生活的用法。先发现新可能，感兴趣再一起推敲怎么实现。反馈由你决定是否用于下一次探索。"
            : "说说想做什么、有什么限制。物间会核对已有物品，再一起把想法变成可尝试的步骤。"}
        </p>
      </div>
      {!turns.length && (
        <div className="goal-suggestions">
          {[
            ...(focusedItem
              ? [
                  `让${focusedItem.name}服务我的旅行手账习惯，只用家里现有物品，不购买、不裁切，提出一个不同于普通收纳的新用法。`,
                  `探索${focusedItem.name}与其他物品的新组合，不必用齐；解释新作用怎样产生，未知条件先核对，不改装电路。`,
                  `我希望${focusedItem.name}用起来更顺手；结合已有偏好，找一个不购买、不破坏的新用途。`,
                ]
              : [
                  "我有一小时，不买东西，想做点有趣的事",
                  "想整理桌面，看看已有物品能怎么利用",
                  "从可用物品中任选，换一个有实际作用的方向",
                ]),
          ].map((text) => (
            <button key={text} onClick={() => setGoal(text)}>
              {text} ↗
            </button>
          ))}
        </div>
      )}
      {homeId && itemId && (
        <label className="life-check">
          <input
            type="checkbox"
            checked={selectedIds.length > 1}
            onChange={(e) =>
              setSelectedIds(
                e.target.checked ? items.map((i) => i.id) : [itemId],
              )
            }
          />
          也考虑这个家的其他物品（不必全部使用）
        </label>
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
              <p>
                可用资源池：可以只用其中一部分，不必强行组合。未选时检索可用展柜。
              </p>
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
            {busy ? "正在探索…" : turns.length ? "继续探索" : "开始探索"}
            <ArrowUp size={16} />
          </button>
        </div>
      </form>
      <label className="life-check">
        <input
          type="checkbox"
          checked={useInspiration}
          onChange={(e) => setUseInspiration(e.target.checked)}
        />
        参考有出处的社区原理，也保留自由创作（当前为小型已复核索引）
      </label>
      {onAsk && (
        <label className="life-check">
          <input
            type="checkbox"
            checked={shareFeedback}
            onChange={(e) => setShareFeedback(e.target.checked)}
          />
          本次允许把这些方案的反馈备注用于接下来的云端探索和对话
        </label>
      )}
      {onAsk && (
        <button
          type="button"
          onClick={() =>
            onAsk({
              previousIdeaIds: turns.findLast((t) => t.ids.length)?.ids || [],
              feedbackIdeaIds: shareFeedback
                ? turns.findLast((t) => t.ids.length)?.ids || []
                : [],
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
      {busy && (
        <p role="status">
          已提交目标，等待资源核对与规划结果 · {waitSeconds}{" "}
          秒；不会自动重复提交。
        </p>
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
              {idea.demo
                ? "预置演示方案（非在线 AI）"
                : idea.source === "model-creative"
                  ? idea.exploration
                    ? "开放构想 · 还不是实施说明"
                    : idea.assessment
                      ? {
                          low_risk: "可逆操作候选 · 效果待验证",
                          conditional: "先核对关键条件",
                          concept: "概念方向 · 暂不提供实施步骤",
                        }[idea.assessment.level]
                      : idea.reasoning?.checks.length
                        ? "有条件的创意方案"
                        : "创意设想"
                  : idea.source === "user-submitted"
                    ? "用户提供的经验"
                    : "本地创意候选"}{" "}
              · 未实物验证
            </span>
            <h3>{idea.title}</h3>
            {idea.exploration && (
              <section aria-label="开放创意内容" className="open-idea-prose">
                {idea.exploration.text.split(/\n\s*\n/).map((paragraph, n) => (
                  <p
                    key={n}
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {paragraph.replace(/\*\*/g, "")}
                  </p>
                ))}
                <button
                  disabled={busy || !modelAvailable}
                  onClick={() =>
                    generate(
                      true,
                      `我对“${idea.title}”感兴趣。请沿这个方向解释机制与必要条件；不把未知当事实，条件不成立时说明替代路径。当前目标：${goal.slice(0, 300)}`,
                      excluded,
                      idea,
                    )
                  }
                >
                  深入这个方向 · 核对条件
                </button>
                {!!idea.exploration.inspirations.length && (
                  <details>
                    <summary>这次检索到的真实灵感 · 非实施证明</summary>
                    {idea.exploration.inspirations.map((c) => (
                      <p key={c.id}>
                        <a href={c.url} target="_blank" rel="noreferrer">
                          {c.title} ↗
                        </a>{" "}
                        · {c.author}
                        <br />
                        {c.transfer}
                        <br />
                        <small>
                          {c.evidence} {c.license}
                        </small>
                      </p>
                    ))}
                  </details>
                )}
              </section>
            )}
            {idea.assessment && (
              <section aria-label="创意条件检查">
                <p>
                  <strong>希望得到：</strong>
                  {idea.expectedEffect}（模型设想）
                </p>
                <p>{idea.assessment.hypothesis}</p>
                <details>
                  <summary>哪些条件有依据，哪些还不知道？</summary>
                  {idea.assessment.checks.map((c, n) => (
                    <p key={n}>
                      {
                        {
                          supported: "已有对应资料",
                          unknown: "待确认",
                          contradiction: "存在冲突",
                        }[c.status]
                      }
                      ：{c.detail}
                    </p>
                  ))}
                </details>
                <small>计算只核对列出的必要条件，不是完整物理验证。</small>
              </section>
            )}
            {idea.reasoning && (
              <section aria-label="创意如何成立">
                <p>
                  <strong>你会得到：</strong>
                  {idea.reasoning.outcome}
                </p>
                <details>
                  <summary>为什么这样用 · 依据与条件</summary>
                  {idea.rationale && <p>{idea.rationale}</p>}
                  <ul>
                    {idea.reasoning.roles.map((r) => (
                      <li key={r.itemId}>
                        {items.find((i) => i.id === r.itemId)?.name}：
                        {r.function} → {r.contribution}（用途推导，待实践）
                      </li>
                    ))}
                  </ul>
                  {idea.reasoning.checks.map((c, n) => (
                    <p key={n}>
                      先确认：{c.condition}。{c.method}；不成立时：{c.ifFail}
                    </p>
                  ))}
                  {!!idea.reasoning.preferenceIds.length && (
                    <small>
                      采用了你已确认并授权的偏好；可在个人记忆中纠正或忘记。
                    </small>
                  )}
                </details>
              </section>
            )}
            {idea.direction && <small>{idea.direction} · 可尝试的方向</small>}
            {!!idea.missing?.length && (
              <details>
                <summary>实施前需核对 {idea.missing.length} 项条件</summary>
                <ul>
                  {idea.missing.map((m, n) => (
                    <li key={n}>{m}</li>
                  ))}
                </ul>
              </details>
            )}
            <p className="life-muted">
              {idea.exploration
                ? "本次可用资源（不代表每件都要使用）"
                : `约 ${idea.minutes} 分钟`}{" "}
              ·{" "}
              {idea.itemIds
                .map(
                  (id) =>
                    items.find((i) => i.id === id)?.name || "已不可访问物品",
                )
                .join(" ＋ ")}
            </p>
            {!!idea.steps.length && (
              <details className="idea-steps" open>
                <summary>怎么开始 · {idea.steps.length} 步</summary>
                <ol>
                  {idea.steps.map((s, n) => (
                    <li key={n}>{s}</li>
                  ))}
                </ol>
              </details>
            )}
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
            {idea.creativeEvidenceSources?.map((e) => (
              <p key={e.id}>
                {e.kind === "open-knowledge"
                  ? "开放知识"
                  : e.kind === "third-party"
                    ? "公开第三方资料（灵感）"
                    : "用户提供的经验"}
                ：
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noreferrer">
                    {e.title} ↗
                  </a>
                ) : (
                  e.title
                )}
                <small>
                  {e.license} · {e.attribution} · {e.fetchedAt}
                  ；AI改编，未实物验证。
                </small>
                {e.licenseURL && (
                  <a href={e.licenseURL} target="_blank" rel="noreferrer">
                    许可与署名要求
                  </a>
                )}
              </p>
            ))}
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
              {onAsk && (
                <button
                  onClick={() =>
                    onAsk({
                      previousIdeaIds: [idea.id],
                      feedbackIdeaIds: shareFeedback ? [idea.id] : [],
                      continuation: continuation || {
                        goal: idea.goal,
                        minutes: idea.minutes,
                        itemIds: idea.itemIds,
                        excludedItemIds: [],
                        restrictions: [],
                      },
                    })
                  }
                >
                  带这个想法继续
                </button>
              )}
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
                  aria-label={`${idea.title} 的反馈内容`}
                  defaultValue={idea.note || ""}
                  maxLength={1000}
                  placeholder="例如：缺一张纸；下次想换个方向"
                  onBlur={(e) => {
                    if (e.target.value !== idea.note)
                      feedback(idea, { note: e.target.value });
                  }}
                />
              </label>
              <p className="life-muted">
                备注默认只保存在本机。主动点下方按钮，才把这一条反馈用于新的模型探索。
              </p>
              <button
                disabled={busy || !idea.note?.trim()}
                onClick={() =>
                  generate(
                    undefined,
                    `换个方向；上一方案“${idea.title}”；我这次的反馈：${idea.note?.slice(0, 300)}。请回应这个反馈重新探索。`,
                  )
                }
              >
                按这条反馈重新探索
              </button>
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
              const d = await request("creativeEvidence", { url: sourceUrl });
              setSourcePreview(d.evidence.excerpt);
              setCreativeEvidenceIds((ids) =>
                [...new Set([...ids, d.evidence.id])].slice(-6),
              );
              setNotice(
                "已记录来源元信息及短摘录，后续规划可引用。" +
                  d.evidence.license,
              );
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
        <label>
          粘贴获准使用的经验片段
          <textarea
            maxLength={2500}
            value={providedText}
            onChange={(e) => setProvidedText(e.target.value)}
            placeholder="无法读取帖子时，可提供有权使用的必要片段；无需上传账号私有内容。"
          />
        </label>
        <label className="life-check">
          <input
            type="checkbox"
            checked={rights}
            onChange={(e) => setRights(e.target.checked)}
          />
          我有权提供这些内容，仅用于本人的玩法规划
        </label>
        <button
          disabled={busy || !rights || !providedText.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              const d = await request("creativeEvidence", {
                url: sourceUrl || undefined,
                text: providedText,
                confirmed: true,
              });
              setCreativeEvidenceIds((ids) =>
                [...new Set([...ids, d.evidence.id])].slice(-6),
              );
              setNotice("已加入本次可用经验，仍需核对现实条件。");
            } catch (e) {
              setNotice((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          加入本次规划的经验
        </button>
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
