import { useEffect, useState } from "react";
import { App as AntApp, Modal } from "antd";
import {
  Camera,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Images,
  LockKeyhole,
  Pencil,
  Search,
  Share2,
  Trash2,
} from "lucide-react";
import { request, type Experience, type Workspace } from "../api";
import type { Editor } from "./Editors";
import { EmptyState, Pill, safeDate } from "./shared";
import { navigate } from "./navigation";
import { PhotoMatchFinder } from "./PhotoMatchReview";
import "./memory-box.css";

export default function Memories({
  workspace,
  edit,
  refresh,
  onItem,
  experienceId,
  itemId,
  onCompanion,
}: {
  workspace: Workspace;
  edit: (editor: Editor) => void;
  refresh: () => Promise<unknown>;
  onItem: (id: string) => void;
  experienceId?: string;
  itemId?: string;
  onCompanion?: () => void;
}) {
  const [query, setQuery] = useState(""),
    [scope, setScope] = useState("all");
  const [view, setView] = useState<"box" | "all">("box"),
    [filtersOpen, setFiltersOpen] = useState(false),
    [activeDay, setActiveDay] = useState<string | null>(null),
    [activeMemory, setActiveMemory] = useState("");
  useEffect(() => {
    setQuery(""); setScope("all"); setActiveDay(null); setActiveMemory(""); setFiltersOpen(false);
  }, [itemId]);
  // Resolve the current authorized record rather than retaining a stale copy
  // after an edit, deletion or sharing change refreshes the workspace.
  const selected = workspace.experiences.find((exp) => exp.id === experienceId);
  const [photo, setPhoto] = useState("");
  useEffect(() => setPhoto(""), [experienceId]);
  useEffect(() => {
    if (photo && !selected?.photo_ids.some((id) => photo === `/api/assets/${id}`)) setPhoto("");
  }, [selected, photo]);
  function close() { navigate({ section: "memories", itemId }); }
  const { message } = AntApp.useApp();
  const item = workspace.items.find((value) => value.id === itemId);
  const related = workspace.experiences.filter((exp) => !itemId || exp.item_ids.includes(itemId));
  const experiences = related.filter(
    (exp) =>
      (!query ||
        (
          exp.title +
          exp.text +
          Object.values(exp.item_labels).join(" ")
        ).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) &&
      (scope === "all" ||
        (scope === "mine" && exp.access === "owner" && !exp.origin_id) ||
        (scope === "shared" && exp.access === "shared" && !exp.household_id) ||
        (scope === "family" && Boolean(exp.household_id)) ||
        (scope === "received" && Boolean(exp.origin_id))),
  );
  function cover(exp: Experience) {
    if (exp.photo_ids[0]) return { id: exp.photo_ids[0], related: false };
    const linked = exp.item_ids.map((id) => workspace.items.find((value) => value.id === id)).find((value) => value?.photo_id);
    return linked?.photo_id ? { id: linked.photo_id, related: true } : null;
  }
  function attribution(exp: Experience) {
    const author = String(exp.provenance.author_name || "");
    if (exp.origin_id) return `随礼物收到的原故事${author ? ` · ${author}` : ""}`;
    if (exp.household_id) return `${workspace.households.find((house) => house.id === exp.household_id)?.name || "家庭"} · ${exp.access === "owner" ? "我记录的" : `${author || "家人"}记录的`}`;
    return exp.access === "shared" ? `来自${author || "朋友"}的分享` : "由我记录";
  }
  // The recorded day is a business fact. Undated stories stay together in their
  // own pocket; upload time and file metadata must not invent a life date.
  const days = Array.from(new Set(experiences.map((exp) => exp.occurred_on || "")))
    .sort((a, b) => b.localeCompare(a));
  const day = activeDay !== null && days.includes(activeDay) ? activeDay : days[0] || "";
  const dayIndex = days.indexOf(day);
  const dayStories = experiences.filter((exp) => (exp.occurred_on || "") === day);
  const current = dayStories.find((exp) => exp.id === activeMemory) || dayStories[0];
  const currentVisual = current && cover(current);
  function openStory(exp: Experience) {
    navigate({ section: "memories", itemId, experienceId: exp.id });
  }
  async function remove(exp: Experience) {
    Modal.confirm({
      title: "删除这段回忆？",
      content: "将移除这份记录及后续引用。已经送出的礼物故事快照不会被收回。",
      okText: "删除",
      cancelText: "保留",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await request(`/experiences/${exp.id}`, "DELETE", {
            expected_version: exp.version,
          });
          close();
          await refresh();
        } catch (error) {
          message.error((error as Error).message);
          throw error;
        }
      },
    });
  }
  return (
    <section className="memories-page page-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">LITTLE MOMENTS, TOGETHER</span>
          <h1>{item ? `和${item.avatar.nickname || item.name}的回忆` : "一起的回忆"}</h1>
          <p>{item ? `关于${item.name}，也关于一起经过的日子。` : "有些东西的意义，藏在一起经过的日子里。"}</p>
          {itemId && <div className="memory-context-actions">{onCompanion && <button className="quiet-button" onClick={onCompanion}>回去聊聊</button>}<button className="quiet-button" onClick={() => navigate({ section: "memories" })}>看全部回忆</button></div>}
        </div>
        {!!related.length && <button
          className="primary-button"
          onClick={() => edit({ kind: "experience", item })}
        >
          <Camera size={18} />
          记下一刻
        </button>}
      </div>
      {related.length > 0 && <div className="memory-view-switch" aria-label="回忆的浏览方式">
        <button className={view === "box" ? "active" : ""} onClick={() => setView("box")} aria-pressed={view === "box"}>
          <CalendarDays size={17} />记忆盒
        </button>
        <button className={view === "all" ? "active" : ""} onClick={() => setView("all")} aria-pressed={view === "all"}>
          <Images size={17} />全部回忆<span>{related.length}</span>
        </button>
        {view === "box" && <button className={`memory-box-find ${filtersOpen ? "active" : ""}`}
          aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
          <Search size={16} />{query || scope !== "all" ? "筛选中" : "查找"}
        </button>}
      </div>}
      {(view === "all" || filtersOpen) && (related.length > 0 || Boolean(query) || scope !== "all") && <div className={`memory-tools ${view === "box" ? "memory-tools-compact" : ""}`}>
        <div className="filter-row">
          <Pill active={scope === "all"} onClick={() => setScope("all")}>
            全部
          </Pill>
          <Pill active={scope === "mine"} onClick={() => setScope("mine")}>
            我记录的
          </Pill>
          <Pill active={scope === "shared"} onClick={() => setScope("shared")}>
            朋友分享的
          </Pill>
          <Pill active={scope === "family"} onClick={() => setScope("family")}>
            家庭共同回忆
          </Pill>
          <Pill active={scope === "received"} onClick={() => setScope("received")}>
            随礼物收到的
          </Pill>
        </div>
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="查找回忆"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="找一段经历，或一件物"
          />
        </label>
      </div>}
      {experienceId && !selected && (
        <p className="inline-error" role="status">这段回忆已不可读取，可能已删除或分享权限已改变。其他记录仍可查看。</p>
      )}
      {experiences.length && view === "box" && current ? (
        <div className="memory-box">
          <aside className="memory-date-pocket" aria-label="按记录日期浏览">
            <div className="memory-pocket-heading"><CalendarDays size={18} /><span>把日子慢慢打开</span></div>
            <div className="memory-date-list">
              {days.map((value) => <button key={value || "undated"}
                className={day === value ? "active" : ""}
                aria-pressed={day === value}
                onClick={() => { setActiveDay(value); setActiveMemory(""); }}>
                {value ? <><strong>{value.slice(5).replace("-", " / ")}</strong><small>{value.slice(0, 4)}</small></>
                  : <><strong>未记日期</strong><small>也值得留下</small></>}
                <span>{experiences.filter((exp) => (exp.occurred_on || "") === value).length}段</span>
              </button>)}
            </div>
          </aside>
          <div className="memory-day">
            <div className="memory-day-heading">
              <div><span className="eyebrow">A DAY TO KEEP</span><h2>{safeDate(day)}</h2></div>
              <div className="memory-day-turn">
                <button className="icon-button" aria-label="更新的一天" disabled={dayIndex <= 0}
                  onClick={() => { setActiveDay(days[dayIndex - 1]); setActiveMemory(""); }}><ChevronLeft size={20} /></button>
                <button className="icon-button" aria-label="更早的一天" disabled={dayIndex >= days.length - 1}
                  onClick={() => { setActiveDay(days[dayIndex + 1]); setActiveMemory(""); }}><ChevronRight size={20} /></button>
              </div>
            </div>
            <button className={`memory-open-page ${currentVisual ? "" : "memory-page-letter"}`} onClick={() => openStory(current)}>
              {currentVisual ? <div className="memory-page-photo">
                <img key={currentVisual.id} src={`/api/assets/${currentVisual.id}`}
                  alt={currentVisual.related ? `${current.title}关联的物品` : current.title} />
                {currentVisual.related && <span className="memory-cover-caption">相关物品</span>}
              </div> : <div className="memory-page-quote" aria-hidden="true">“</div>}
              <div className="memory-page-copy">
                <span className="memory-page-count">{dayStories.indexOf(current) + 1} / {dayStories.length}</span>
                <h3>{current.title}</h3>
                <p>{current.text}</p>
                <span className="memory-page-objects">{Object.values(current.item_labels).join(" · ") || "留在这一天的心情"}</span>
                <small className="memory-page-attribution">{attribution(current)}</small>
                <span className="memory-page-read">打开这段回忆 <ChevronRight size={16} /></span>
              </div>
            </button>
            {dayStories.length > 1 && <div className="memory-filmstrip" aria-label="这一天的其他回忆">
              {dayStories.map((exp) => {
                const visual = cover(exp);
                return <button key={exp.id} className={exp.id === current.id ? "active" : ""}
                  aria-pressed={exp.id === current.id} onClick={() => setActiveMemory(exp.id)}>
                  {visual ? <img src={`/api/assets/${visual.id}`} alt="" loading="lazy" /> : <span className="memory-film-letter">“</span>}
                  <span>{exp.title}</span>
                </button>;
              })}
            </div>}
          </div>
        </div>
      ) : experiences.length ? (
        <div className="memory-grid">
          {experiences.map((exp, index) => {
            const visual = cover(exp);
            return (
            <button
              className={`memory-card paper-${index % 3}`}
              key={exp.id}
              onClick={() => openStory(exp)}
            >
              {visual ? (
                <div className="memory-cover-wrap">
                  <img
                    src={`/api/assets/${visual.id}`}
                    alt={visual.related ? `${exp.title}关联的物品` : exp.title}
                    className="memory-cover"
                    loading="lazy"
                  />
                  {visual.related && <span className="memory-cover-caption">相关物品</span>}
                </div>
              ) : (
                <div className="memory-paper">
                  <small>留在生活里的一刻</small>
                  <p>{exp.text.slice(0, 80)}</p>
                </div>
              )}
              <div className="memory-card-copy">
                <time>{safeDate(exp.occurred_on)}</time>
                <h2>{exp.title}</h2>
                <p>
                  {Object.values(exp.item_labels).join(" · ") ||
                    "属于这一刻的记录"}
                </p>
                <small>{attribution(exp)}</small>
              </div>
            </button>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title={query || scope !== "all" ? "没有找到符合条件的回忆" : item ? "先留下一刻，不用想好故事" : "第一段回忆，从你想留下的这一刻开始"}
          action={
            <button
              className="primary-button"
              onClick={() => edit({ kind: "experience", item })}
            >
              <Camera size={18} />
              记下一刻
            </button>
          }
        >
          {query || scope !== "all" ? "换个关键词或范围看看，原来的记录仍然保留。" : item ? "一张照片、一句话，或今天的心情，都可以。" : "可以只是一句话，也可以关联几件一起出现的物品。"}
        </EmptyState>
      )}
      <Modal
        open={Boolean(selected)}
        title={selected?.title}
        onCancel={close}
        footer={null}
        width={680}
      >
        {selected && (
          <article className="memory-detail">
            <time>{safeDate(selected.occurred_on)}</time>
            <p className="memory-detail-attribution">{attribution(selected)}</p>
            <div className="memory-detail-photos">
              {selected.photo_ids.map((id) => (
                <button key={id} onClick={() => setPhoto(`/api/assets/${id}`)}>
                  <img src={`/api/assets/${id}`} alt="回忆中的照片，点击放大" />
                </button>
              ))}
            </div>
            <p className="memory-original">{selected.text}</p>
            <div className="linked-items">
              {selected.item_ids.map((id) => (
                <button
                  key={id}
                  onClick={() => {
                    onItem(id);
                  }}
                >
                  {selected.item_labels[id] || "相关物品"} ↗
                </button>
              ))}
            </div>
            {selected.access === "owner" && !selected.origin_id && selected.photo_ids.length > 0 &&
              <PhotoMatchFinder key={selected.id} experience={selected} items={workspace.items} onDone={refresh} />}
            <p className="form-note">
              <LockKeyhole size={14} />
              {selected.household_id
                ? `${workspace.households.find((house) => house.id === selected.household_id)?.name || "这个家庭"}的已加入成员可见。${selected.allow_ai ? "记录者允许家庭成员各自的物伴在相关对话中参考。" : "仅供家人阅读，不作为家庭成员物伴的对话资料。"}其他私人记录不会一起开放。`
                : selected.access === "shared"
                ? "这是对方选择分享的原文，未开放其他私人记录或智能使用许可。"
                : selected.allow_ai
                  ? "允许物伴在相关对话中参考。分享范围另外选择。"
                  : "仅作生活记录，不提供给物伴作为对话资料。"}
            </p>
            {selected.access === "owner" && (
              <div className="detail-actions">
                <button
                  className="soft-button"
                  onClick={() => {
                    close();
                    edit({ kind: "experience", experience: selected });
                  }}
                >
                  <Pencil size={16} />
                  补充与纠正
                </button>
                <button
                  className="soft-button"
                  onClick={() => {
                    close();
                    edit({ kind: "experience-share", experience: selected });
                  }}
                >
                  <Share2 size={16} />
                  选择分享
                </button>
                <button
                  className="quiet-button"
                  onClick={() => void remove(selected)}
                >
                  <Trash2 size={16} />
                  删除
                </button>
              </div>
            )}
          </article>
        )}
      </Modal>
      <Modal
        open={Boolean(photo)}
        onCancel={() => setPhoto("")}
        footer={null}
        title="回忆照片"
        width={900}
      >
        <img
          className="photo-lightbox"
          src={photo || undefined}
          alt="放大的原照片"
        />
      </Modal>
    </section>
  );
}
