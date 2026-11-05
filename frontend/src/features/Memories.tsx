import { useEffect, useState } from "react";
import { App as AntApp, Modal } from "antd";
import {
  Camera,
  Heart,
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
  useEffect(() => { setQuery(""); setScope("all"); }, [itemId]);
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
        (scope === "shared" && exp.access === "shared") ||
        (scope === "received" && Boolean(exp.origin_id))),
  );
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
      {(related.length > 0 || Boolean(query) || scope !== "all") && <div className="memory-tools">
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
      {experiences.length ? (
        <div className="memory-grid">
          {experiences.map((exp, index) => (
            <button
              className={`memory-card paper-${index % 3}`}
              key={exp.id}
              onClick={() => navigate({ section: "memories", itemId, experienceId: exp.id })}
            >
              {exp.photo_ids[0] ? (
                <img
                  src={`/api/assets/${exp.photo_ids[0]}`}
                  alt={exp.title}
                  className="memory-cover"
                />
              ) : (
                <div className="memory-paper">
                  <span>“</span>
                  <p>{exp.text.slice(0, 80)}</p>
                  <Heart size={24} strokeWidth={1.1} />
                </div>
              )}
              <div className="memory-card-copy">
                <time>{safeDate(exp.occurred_on)}</time>
                <h2>{exp.title}</h2>
                <p>
                  {Object.values(exp.item_labels).join(" · ") ||
                    "属于这一刻的记录"}
                </p>
                <small>
                  {exp.access === "shared"
                    ? `来自${String(exp.provenance.author_name || "朋友")}的分享`
                    : exp.origin_id
                      ? "随礼物收到的原故事"
                      : "由我记录"}
                </small>
              </div>
            </button>
          ))}
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
            <p className="form-note">
              <LockKeyhole size={14} />
              {selected.access === "shared"
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
