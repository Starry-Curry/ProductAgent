"use client";
import { useState } from "react";
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
    [ids, setIds] = useState<string[]>(itemId ? [itemId] : []),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const rows = fragments.filter((f) => !itemId || f.itemIds.includes(itemId));
  function reset() {
    setEditing(null);
    setText("");
    setMedia(null);
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
        {media && (
          <img
            className="life-story-preview"
            alt="片段照片预览"
            src={`/api/life/media/${media}?actor=${actor}`}
          />
        )}
        <label>
          照片（可选，JPEG / PNG / WebP，5MB 内）
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                run(async () => {
                  const p = await upload(f, "photo");
                  setMedia(p.id);
                  setNotice(p.notice);
                });
            }}
          />
        </label>
        {media && (
          <button
            type="button"
            className="text-button"
            onClick={() => setMedia(null)}
          >
            移除这张照片
          </button>
        )}
        <label>
          留下一句话
          <textarea
            name="storyText"
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
