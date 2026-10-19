"use client";
import { useId, useRef, useState } from "react";
import { ImagePlus, RefreshCw, X } from "lucide-react";
import type { Item } from "@/lib/domain";
import type { LifeRequest } from "./Intake";
export type Fragment = {
  id: string;
  author: string;
  text: string;
  mediaId: string | null;
  itemIds: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  demo: boolean;
};
export function Stories({
  items,
  fragments,
  itemId,
  actor,
  request,
  upload,
  refresh,
  onItem,
}: {
  items: Item[];
  fragments: Fragment[];
  itemId?: string;
  actor: string;
  request: LifeRequest;
  upload: (f: File, k: string) => Promise<any>;
  refresh: () => Promise<void>;
  onItem: (id: string) => void;
}) {
  const [editing, setEditing] = useState<Fragment | null>(null),
    [text, setText] = useState(""),
    [media, setMedia] = useState<string | null>(null),
    [photoName, setPhotoName] = useState(""),
    [ids, setIds] = useState<string[]>(itemId ? [itemId] : []),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const photoHelp = useId();
  const uploading = useRef(false);
  async function selectPhoto(file?: File) {
    if (!file || uploading.current || busy) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5_000_000) {
      setNotice("请选择 5MB 内的 JPEG、PNG 或 WebP 照片；原照片仍保留。");
      return;
    }
    uploading.current = true;
    await run(async () => {
      const p = await upload(file, "photo");
      setMedia(p.id);
      setPhotoName(file.name);
      setNotice(p.notice);
    });
    uploading.current = false;
  }
  const rows = fragments.filter((f) => !itemId || f.itemIds.includes(itemId));
  function reset() {
    setEditing(null);
    setText("");
    setMedia(null);
    setPhotoName("");
    setIds(itemId ? [itemId] : []);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="life-stories">
      <div className="life-section-head">
        <div>
          <span className="life-eyebrow">SMALL MOMENTS, REAL LIFE</span>
          <h2>{itemId ? "它与你的故事" : "生活里，值得留住的小片段"}</h2>
          <p>一张照片，一句话。也可以先不关联物品，晚一点再整理。</p>
        </div>
      </div>
      <form
        className="life-card life-story-composer"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await request("fragment", {
              id: editing?.id,
              revision: editing?.revision,
              text,
              itemIds: ids,
              mediaId: media,
            });
            reset();
            await refresh();
            setNotice("已保存私人生活片段；未作为偏好或心理画像自动提取。");
          });
        }}
      >
        {editing && <p>正在修改原片段 · 版本 {editing.revision}</p>}
        <div className="life-photo-picker" aria-busy={busy}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length > 1) setNotice("每次请选择一张照片。"); else void selectPhoto(e.dataTransfer.files[0]); }}>
          {media && <img className="life-photo-thumb" alt="片段照片预览" src={`/api/life/media/${media}?actor=${actor}`} />}
          <div className="life-photo-info">
            <strong>{media ? photoName || "已保存的片段照片" : "给这一刻添张照片"}</strong>
            <small id={photoHelp}>照片可选 · JPEG / PNG / WebP · 5MB 内，也可拖放</small>
            <div className="life-actions">
              <button type="button" disabled={busy} onClick={() => photoInput.current?.click()}>
                {media ? <RefreshCw size={16} aria-hidden="true" /> : <ImagePlus size={17} aria-hidden="true" />}
                {busy ? "处理中…" : media ? "更换照片" : "添加照片"}
              </button>
              {media && <button type="button" className="text-button" disabled={busy} onClick={() => { setMedia(null); setPhotoName(""); }}><X size={16} aria-hidden="true" />移除这张照片</button>}
            </div>
          </div>
          <input
            ref={photoInput}
            className="life-visually-hidden"
            aria-label="照片（可选，JPEG / PNG / WebP，5MB 内）"
            aria-describedby={photoHelp}
            tabIndex={-1}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              void selectPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        <label>
          留下一句话
          <textarea
            name="storyText"
            aria-label="留下一句话"
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
            maxLength={3000}
            placeholder="例如：爸送给我的第一台相机。"
          />
        </label>
        <details>
          <summary>关联物品 · 已选择 {ids.length} 件</summary>
          <div className="life-link-options">
            {items.map((i) => (
              <label className="life-check" key={i.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(i.id)}
                  onChange={(e) =>
                    setIds(
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
        </details>
        <div className="life-actions">
          <span className="life-muted">
            仅自己可见 · 原话保留 · 不发送给模型
          </span>
          <button className="button" disabled={busy}>
            {busy ? "保存中…" : editing ? "保存修改" : "保存生活片段"}
          </button>
          {editing && (
            <button type="button" onClick={reset}>
              取消编辑
            </button>
          )}
        </div>
      </form>
      {notice && (
        <p role="status" className="life-notice">
          {notice}
        </p>
      )}
      <div className="life-story-grid">
        {rows.map((f) => (
          <article className="life-card" key={f.id}>
            {f.mediaId && (
              <img
                className="life-story-photo"
                src={`/api/life/media/${f.mediaId}?actor=${actor}`}
                alt="用户保存的生活照片"
              />
            )}
            <small>
              {new Date(f.createdAt).toLocaleDateString("zh-CN")} ·{" "}
              {f.demo ? "合成故事示例" : "本人记录 · 私人"}
            </small>
            <p className="life-story-text">{f.text}</p>
            <div className="life-tags">
              {f.itemIds.map((id) => (
                <button
                  key={id}
                  disabled={!items.some((i) => i.id === id)}
                  onClick={() => onItem(id)}
                >
                  {items.find((i) => i.id === id)?.name ||
                    "已不可访问的关联物品"}
                </button>
              ))}
            </div>
            <div className="life-actions">
              <button
                onClick={() => {
                  setEditing(f);
                  setText(f.text);
                  setMedia(f.mediaId);
                  setPhotoName("");
                  setIds(f.itemIds);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                编辑片段
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "删除这段原文和关联？没有其他引用的照片也会删除；历史数据库备份不在本次即时擦除范围内。",
                    )
                  )
                    run(async () => {
                      await request("deleteFragment", {
                        id: f.id,
                        revision: f.revision,
                      });
                      await refresh();
                      setNotice("片段已删除，后续回忆不再使用。");
                    });
                }}
              >
                删除片段
              </button>
            </div>
          </article>
        ))}
      </div>
      {!rows.length && (
        <div className="life-empty">从一句话开始，故事不必很特别。</div>
      )}
    </section>
  );
}
