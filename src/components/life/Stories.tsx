"use client";
import { useId, useRef, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { ImagePlus, RefreshCw, X, BookOpen, Expand } from "lucide-react";
import "yet-another-react-lightbox/styles.css";
import type { Item } from "@/lib/domain";
import { StoryOrganization } from "./StoryOrganization";
import type { LifeRequest } from "./Intake";
const Lightbox = dynamic(() => import("yet-another-react-lightbox"), {
  ssr: false,
});
export type Fragment = {
  id: string;
  author: string;
  text: string;
  mediaId: string | null;
  mediaIds?: string[];
  itemIds: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  demo: boolean;
  capturedOn?: string | null;
  allowRecall?: boolean;
  allowCloud?: boolean;
  origin?: "user-record" | "ai-edited" | "fiction";
};
const storyTitle = (text: string) => {
  const line =
    text
      .split(/[\n。！？!?]/u)
      .find(Boolean)
      ?.trim() || "生活的一页";
  return line.length > 28 ? line.slice(0, 28) + "…" : line;
};
const photos = (f: Fragment) => f.mediaIds || (f.mediaId ? [f.mediaId] : []);
const provenance = (f: Fragment) =>
  f.demo
    ? "合成故事示例"
    : f.origin === "fiction"
      ? "明确虚构创作"
      : f.origin === "ai-edited"
        ? "AI协助整理 · 本人核对"
        : "本人记录 · 私人";
export function Stories({
  items,
  fragments,
  itemId,
  actor,
  request,
  upload,
  refresh,
  onItem,
  onAsk,
}: {
  items: Item[];
  fragments: Fragment[];
  itemId?: string;
  actor: string;
  request: LifeRequest;
  upload: (f: File, k: string) => Promise<any>;
  refresh: () => Promise<void>;
  onItem: (id: string) => void;
  onAsk?: () => void;
}) {
  const [editing, setEditing] = useState<Fragment | null>(null),
    [text, setText] = useState(""),
    [media, setMedia] = useState<string[]>([]),
    [names, setNames] = useState<Record<string, string>>({}),
    [ids, setIds] = useState<string[]>(itemId ? [itemId] : []),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [date, setDate] = useState(""),
    [recall, setRecall] = useState(true),
    [cloud, setCloud] = useState(false),
    [origin, setOrigin] =
      useState<NonNullable<Fragment["origin"]>>("user-record"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [chapterIds, setChapterIds] = useState<string[] | null>(null),
    [photoMatches, setPhotoMatches] = useState<
      { itemId: string; name: string; reason: string }[]
    >([]),
    [order, setOrder] = useState("newest"),
    [opened, setOpened] = useState<string | null>(null),
    [composing, setComposing] = useState(false),
    [slides, setSlides] = useState<{ src: string; alt: string }[]>([]),
    [slideIndex, setSlideIndex] = useState(0);
  const photoInput = useRef<HTMLInputElement>(null),
    help = useId(),
    uploading = useRef(false),
    replace = useRef<number | null>(null),
    formRef = useRef<HTMLFormElement>(null),
    detailRef = useRef<HTMLElement>(null),
    detailTitle = useId();
  const url = (id: string) => `/api/life/media/${id}?actor=${actor}`;
  const current = fragments.find((f) => f.id === opened);
  const slidesOpen = useRef(false);
  slidesOpen.current = slides.length > 0;
  useEffect(() => {
    if (!opened) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    detailRef.current?.focus();
    const keys = (e: KeyboardEvent) => {
      if (slidesOpen.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setOpened(null);
      }
      if (e.key === "Tab") {
        const nodes = Array.from(
          detailRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]',
          ) || [],
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === detailRef.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", keys);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", keys);
      previous?.focus();
    };
  }, [opened]);
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
  function reset() {
    setEditing(null);
    setText("");
    setMedia([]);
    setNames({});
    setIds(itemId ? [itemId] : []);
    setDate("");
    setRecall(true);
    setCloud(false);
    setOrigin("user-record");
    setPhotoMatches([]);
  }
  async function selectPhoto(file?: File) {
    if (!file || uploading.current || busy) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5_000_000
    ) {
      setNotice("请选择 5MB 内的 JPEG、PNG 或 WebP 照片；原照片仍保留。");
      return;
    }
    if (replace.current === null && media.length >= 8) {
      setNotice("同一段故事最多保存8张照片，可移除或更换已有照片。");
      return;
    }
    uploading.current = true;
    await run(async () => {
      const p = await upload(file, "story-photo");
      const index = replace.current;
      setMedia((old) => [
        ...new Set(
          index === null
            ? [...old, p.id]
            : old.map((id, i) => (i === index ? p.id : id)),
        ),
      ]);
      setNames((old) => ({ ...old, [p.id]: file.name }));
      setNotice(
        media.includes(p.id)
          ? "这张照片已经在当前事件中，不重复添加。"
          : p.notice,
      );
    });
    uploading.current = false;
  }
  function choose(index: number | null) {
    replace.current = index;
    photoInput.current?.click();
  }
  function edit(f: Fragment) {
    setOpened(null);
    setComposing(true);
    setEditing(f);
    setText(f.text);
    setMedia(photos(f));
    setNames({});
    setIds(f.itemIds);
    setDate(f.capturedOn || "");
    setRecall(f.allowRecall !== false);
    setCloud(!!f.allowCloud);
    setOrigin(f.origin || "user-record");
    setTimeout(
      () =>
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      0,
    );
  }
  function enlarge(f: Fragment, index = 0) {
    setSlides(
      photos(f).map((id) => ({
        src: url(id),
        alt: "本人保存的生活照片；未据图推断经历",
      })),
    );
    setSlideIndex(index);
  }
  function remove(f: Fragment) {
    if (
      window.confirm(
        "删除这段原文和关联？没有其他引用的照片也会删除；历史数据库备份不在本次即时擦除范围内。",
      )
    )
      void run(async () => {
        await request("deleteFragment", { id: f.id, revision: f.revision });
        setOpened(null);
        if (editing?.id === f.id) reset();
        await refresh();
        setNotice("片段已删除，后续回忆不再使用。");
      });
  }
  const rows = fragments
    .filter(
      (f) =>
        (!chapterIds || chapterIds.includes(f.id)) &&
        (!itemId || f.itemIds.includes(itemId)) &&
        (filter === "all" ||
          (filter === "unlinked"
            ? !f.itemIds.length
            : f.itemIds.includes(filter))) &&
        (!query || f.text.toLowerCase().includes(query.toLowerCase())),
    )
    .sort(
      (a, b) =>
        (order === "newest" ? -1 : 1) *
        (a.capturedOn || a.createdAt).localeCompare(
          b.capturedOn || b.createdAt,
        ),
    );
  const links = (f: Fragment) => (
    <div className="life-tags">
      {f.itemIds.map((id) => (
        <button
          type="button"
          key={id}
          disabled={!items.some((i) => i.id === id)}
          onClick={() => {
            setOpened(null);
            onItem(id);
          }}
        >
          {items.find((i) => i.id === id)?.name || "已流转/不可访问的物品"}
        </button>
      ))}
    </div>
  );
  return (
    <section className="life-stories">
      <div className="life-section-head">
        <div>
          <span className="life-eyebrow">A BOOK OF YOUR EVERYDAY</span>
          <h2>{itemId ? "它与你的故事" : "生活里，值得留住的小片段"}</h2>
          <p>一张照片，一句话。可以不关联物品；这本故事书始终属于你。</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setComposing(true);
            setTimeout(() => {
              formRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
              formRef.current?.querySelector("textarea")?.focus();
            }, 0);
          }}
        >
          <ImagePlus size={17} /> 写一段生活
        </button>
      </div>
      {onAsk && (
        <button type="button" className="text-button" onClick={onAsk}>
          和物间聊聊这些故事
        </button>
      )}
      {composing && (
        <form
          ref={formRef}
          className="life-card life-story-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await request("fragment", {
                id: editing?.id,
                revision: editing?.revision,
                text,
                itemIds: ids,
                mediaId: media[0] || null,
                mediaIds: media,
                capturedOn: date || null,
                allowRecall: recall,
                allowCloud: recall && cloud,
                origin,
              });
              reset();
              await refresh();
              setComposing(false);
              setNotice("已保存私人生活片段；未作为偏好或心理画像自动提取。");
            });
          }}
        >
          {editing && <p>正在修改原片段 · 版本 {editing.revision}</p>}
          <div
            className="life-photo-picker"
            aria-busy={busy}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              replace.current = null;
              if (e.dataTransfer.files.length > 1)
                setNotice("每次请选择一张照片，可继续追加。");
              else void selectPhoto(e.dataTransfer.files[0]);
            }}
          >
            {media.map((id, index) => (
              <div key={id} className="life-story-upload-tile">
                <img
                  className="life-photo-thumb"
                  src={url(id)}
                  alt={
                    index === 0 ? "片段照片预览" : `追加照片${index + 1}预览`
                  }
                />
                <small>{names[id] || `已保存的照片 ${index + 1}`}</small>
                {index > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setMedia((old) => old.filter((x) => x !== id))
                    }
                  >
                    移除照片 {index + 1}
                  </button>
                )}
              </div>
            ))}
            <div className="life-photo-info">
              <strong>
                {media.length
                  ? `已选 ${media.length} 张照片`
                  : "给这一刻添张照片"}
              </strong>
              <small id={help}>
                照片可选 · JPEG / PNG / WebP ·
                每张5MB内，最多8张，也可拖放。自动转正并去除EXIF定位，不推断故事日期。
              </small>
              <div className="life-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => choose(media.length ? 0 : null)}
                >
                  {media.length ? (
                    <RefreshCw size={16} />
                  ) : (
                    <ImagePlus size={17} />
                  )}{" "}
                  {busy ? "处理中…" : media.length ? "更换照片" : "添加照片"}
                </button>
                {media.length > 0 && (
                  <>
                    <button
                      type="button"
                      disabled={busy || media.length >= 8}
                      onClick={() => choose(null)}
                    >
                      追加照片
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => setMedia((old) => old.slice(1))}
                    >
                      <X size={16} />
                      移除这张照片
                    </button>
                  </>
                )}
              </div>
            </div>
            <input
              ref={photoInput}
              className="life-visually-hidden"
              aria-label="照片（可选，JPEG / PNG / WebP，5MB 内）"
              aria-describedby={help}
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
              maxLength={10000}
              placeholder="一次新尝试，一件旧物的来历，或今天想留下的事。"
            />
          </label>
          {media.length > 0 && (
            <div className="life-story-photo-matches">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (
                    !window.confirm(
                      "仅将这张照片发送到本机已配置的视觉模型，可能产生费用。识别只生成候选，不自动绑定；确认继续？",
                    )
                  )
                    return;
                  void run(async () => {
                    const d = await request("storyPhoto", {
                      mediaId: media[0],
                      confirmed: true,
                    });
                    setPhotoMatches(
                      d.matches.flatMap((m: any) => m.candidates),
                    );
                    setNotice(
                      d.notice +
                        (d.matches.every((m: any) => !m.candidates.length)
                          ? " 未找到可靠实例候选，可手动选择或不关联。"
                          : ""),
                    );
                  });
                }}
              >
                找找照片里的已有物品（需视觉授权）
              </button>
              {photoMatches.map((c) => (
                <label key={c.itemId} className="life-check">
                  <input
                    type="checkbox"
                    checked={ids.includes(c.itemId)}
                    onChange={(e) =>
                      setIds(
                        e.target.checked
                          ? [...new Set([...ids, c.itemId])]
                          : ids.filter((id) => id !== c.itemId),
                      )
                    }
                  />
                  {c.name} · {c.reason}
                </label>
              ))}
            </div>
          )}
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
              {ids
                .filter((id) => !items.some((i) => i.id === id))
                .map((id) => (
                  <button
                    type="button"
                    key={id}
                    onClick={() => setIds((old) => old.filter((x) => x !== id))}
                  >
                    取消关联已流转物品
                  </button>
                ))}
            </div>
          </details>
          <details>
            <summary>日期、记录类型与引用权限</summary>
            <div className="life-story-settings">
              <label>
                故事发生日期
                <input
                  type="date"
                  aria-label="故事发生日期"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <small>可留空；记录日期不等于事件日期。</small>
              </label>
              <label>
                记录类型
                <select
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value as typeof origin)}
                >
                  <option value="user-record">本人真实记录</option>
                  <option value="ai-edited">AI协助整理，已经本人核对</option>
                  <option value="fiction">明确虚构创作</option>
                </select>
              </label>
              <label className="life-check">
                <input
                  type="checkbox"
                  checked={recall}
                  onChange={(e) => {
                    setRecall(e.target.checked);
                    if (!e.target.checked) setCloud(false);
                  }}
                />
                允许主动回忆时在本机引用
              </label>
              <label className="life-check">
                <input
                  type="checkbox"
                  checked={cloud}
                  disabled={!recall || origin === "fiction"}
                  onChange={(e) => setCloud(e.target.checked)}
                />
                允许将这段文字交给已授权云端AI聊故事（不含照片）
              </label>
              <small>
                默认私人，不随赠礼或家庭共享传递。撤销引用会清除旧会话上下文；不影响原始故事保存。
              </small>
            </div>
          </details>
          <div className="life-actions">
            <span className="life-muted">
              仅自己可见 · 未勾选上云时不发送模型
            </span>
            <button className="button" disabled={busy}>
              {busy ? "保存中…" : editing ? "保存修改" : "保存生活片段"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                reset();
                setComposing(false);
              }}
            >
              {editing ? "取消编辑" : "收起"}
            </button>
          </div>
        </form>
      )}
      {notice && (
        <p role="status" className="life-notice">
          {notice}
        </p>
      )}
      <details className="life-story-browse-tools">
        <summary>寻找经历 · 按时间、物品或章节浏览</summary>
        <StoryOrganization
          actor={actor}
          fragments={fragments}
          request={request}
          onFilter={setChapterIds}
        />
        <div className="life-story-toolbar">
          <label>
            寻找一段经历
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索原话"
            />
          </label>
          <label>
            按关联物品浏览
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">全部故事</option>
              <option value="unlinked">未关联物品</option>
              {items.map((i) => (
                <option value={i.id} key={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            时间顺序
            <select value={order} onChange={(e) => setOrder(e.target.value)}>
              <option value="newest">最近的经历在前</option>
              <option value="oldest">从最早开始翻阅</option>
            </select>
          </label>
          <small>{rows.length} 段 · 默认私人</small>
        </div>
      </details>
      <div className="life-story-grid">
        {rows.map((f) => (
          <article
            className={`life-card life-story-page ${photos(f).length ? "has-photo" : "text-only"}`}
            key={f.id}
          >
            {photos(f).length > 0 ? (
              <button
                className="life-story-cover"
                type="button"
                aria-label="放大故事照片"
                onClick={() => enlarge(f)}
              >
                <img
                  className="life-story-photo"
                  src={url(photos(f)[0])}
                  alt="用户保存的生活照片"
                  loading="lazy"
                />
                <span>
                  <Expand size={15} />{" "}
                  {photos(f).length > 1
                    ? `${photos(f).length}张照片`
                    : "放大照片"}
                </span>
              </button>
            ) : (
              <BookOpen
                className="life-story-mark"
                size={25}
                aria-hidden="true"
              />
            )}
            {photos(f).length > 1 && (
              <div className="life-story-contact-sheet">
                {photos(f)
                  .slice(1, 4)
                  .map((id, index) => (
                    <button
                      key={id}
                      type="button"
                      aria-label={`查看故事照片 ${index + 2}`}
                      onClick={() => enlarge(f, index + 1)}
                    >
                      <img
                        src={url(id)}
                        alt={`故事照片 ${index + 2}`}
                        loading="lazy"
                      />
                    </button>
                  ))}
              </div>
            )}
            <small>
              {f.capturedOn
                ? f.capturedOn
                : `记录于 ${new Date(f.createdAt).toLocaleDateString("zh-CN")}`}{" "}
              {f.demo || f.origin === "fiction" ? ` · ${provenance(f)}` : ""}
            </small>
            <button
              type="button"
              className="life-story-read"
              aria-label="阅读故事"
              onClick={() => setOpened(f.id)}
            >
              <h3>{f.text.length <= 60 ? f.text : storyTitle(f.text)}</h3>
              {f.text.length > 60 && (
                <p className="life-story-text">{f.text}</p>
              )}
            </button>
            {links(f)}
            <div className="life-actions">
              <button type="button" onClick={() => setOpened(f.id)}>
                阅读完整故事
              </button>
              <button type="button" disabled={busy} onClick={() => edit(f)}>
                编辑片段
              </button>
              <button type="button" disabled={busy} onClick={() => remove(f)}>
                删除片段
              </button>
            </div>
          </article>
        ))}
      </div>
      {!rows.length && (
        <div className="life-empty">从一句话开始，故事不必很特别。</div>
      )}
      {current && (
        <div className="life-story-overlay" onClick={() => setOpened(null)}>
          <section
            role="dialog"
            ref={detailRef}
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby={detailTitle}
            aria-label="故事详情"
            className="life-story-detail"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="life-story-close"
              onClick={() => setOpened(null)}
              aria-label="关闭故事详情"
            >
              <X />
            </button>
            <small>
              {current.capturedOn ||
                `记录于 ${new Date(current.createdAt).toLocaleDateString("zh-CN")}`}
            </small>
            <h3 id={detailTitle}>{storyTitle(current.text)}</h3>
            <div className="life-story-detail-photos">
              {photos(current).map((id, index) => (
                <button
                  type="button"
                  key={id}
                  aria-label={`放大照片 ${index + 1}`}
                  onClick={() => enlarge(current, index)}
                >
                  <img src={url(id)} alt={`故事照片 ${index + 1}`} />
                </button>
              ))}
            </div>
            <p className="life-story-fulltext">{current.text}</p>
            {links(current)}
            <details className="life-story-permissions">
              <summary>记录与隐私</summary>
              <p>{provenance(current)}</p>
              <p className="life-muted">
                {current.allowRecall === false
                  ? "已关闭AI回忆引用"
                  : current.allowCloud
                    ? "允许本人主动回忆时上云（仅文字）"
                    : "仅主动回忆时本机引用，不上云"}{" "}
                · 不随物品流转分享
              </p>
            </details>
            <div className="life-actions">
              <button type="button" onClick={() => edit(current)}>
                修改这页故事
              </button>
              <button type="button" onClick={() => remove(current)}>
                删除这页故事
              </button>
              {onAsk && (
                <button
                  type="button"
                  onClick={() => {
                    setOpened(null);
                    onAsk();
                  }}
                >
                  与物间回忆
                </button>
              )}
            </div>
          </section>
        </div>
      )}
      <Lightbox
        open={slides.length > 0}
        close={() => setSlides([])}
        index={slideIndex}
        slides={slides}
        labels={{
          Close: "关闭照片",
          Next: "下一张照片",
          Previous: "上一张照片",
        }}
        carousel={{ finite: true }}
      />
    </section>
  );
}
