import { useState } from "react";
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

export default function Memories({
  workspace,
  edit,
  refresh,
  onItem,
}: {
  workspace: Workspace;
  edit: (editor: Editor) => void;
  refresh: () => Promise<unknown>;
  onItem: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [scope, setScope] = useState("all"),
    [selected, setSelected] = useState<Experience>();
  const [photo, setPhoto] = useState("");
  const { message } = AntApp.useApp();
  const experiences = workspace.experiences.filter(
    (exp) =>
      (!query ||
        (
          exp.title +
          exp.text +
          Object.values(exp.item_labels).join(" ")
        ).includes(query)) &&
      (scope === "all" ||
        (scope === "mine" && exp.access === "owner") ||
        (scope === "shared" && exp.access === "shared")),
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
          setSelected(undefined);
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
          <h1>一起的回忆</h1>
          <p>有些东西的意义，藏在一起经过的日子里。</p>
        </div>
        <button
          className="primary-button"
          onClick={() => edit({ kind: "experience" })}
        >
          <Camera size={18} />
          记下一刻
        </button>
      </div>
      <div className="memory-tools">
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
      </div>
      {experiences.length ? (
        <div className="memory-grid">
          {experiences.map((exp, index) => (
            <button
              className={`memory-card paper-${index % 3}`}
              key={exp.id}
              onClick={() => setSelected(exp)}
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
          title="第一段回忆，从你想留下的这一刻开始"
          action={
            <button
              className="primary-button"
              onClick={() => edit({ kind: "experience" })}
            >
              <Camera size={18} />
              记下一刻
            </button>
          }
        >
          可以只是一句话，也可以关联几件一起出现的物品。
        </EmptyState>
      )}
      <Modal
        open={Boolean(selected)}
        title={selected?.title}
        onCancel={() => setSelected(undefined)}
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
                    setSelected(undefined);
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
                    setSelected(undefined);
                    edit({ kind: "experience", experience: selected });
                  }}
                >
                  <Pencil size={16} />
                  补充与纠正
                </button>
                <button
                  className="soft-button"
                  onClick={() => {
                    setSelected(undefined);
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
