"use client";
import { useId, useRef, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  ImagePlus,
  RefreshCw,
  X,
  Expand,
  MoreHorizontal,
  ArrowUpRight,
} from "lucide-react";
import "yet-another-react-lightbox/styles.css";
import type { Item } from "@/lib/domain";
import { StoryOrganization } from "./StoryOrganization";
import type { Chapter } from "@/lib/life/organization";
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
    [photoIndex, setPhotoIndex] = useState(0),
    [observations, setObservations] = useState<string[]>([]),
    [recall, setRecall] = useState(true),
    [cloud, setCloud] = useState(false),
    [origin, setOrigin] =
      useState<NonNullable<Fragment["origin"]>>("user-record"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [chapterIds, setChapterIds] = useState<string[] | null>(null),
    [chapters, setChapters] = useState<Chapter[]>([]),
    [chapterId, setChapterId] = useState("all"),
    [browseMode, setBrowseMode] = useState("timeline"),
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
    if (itemId || !fragments.length) return;
    const key = "wujian.story-return." + actor;
    const id = sessionStorage.getItem(key);
    if (!id) return;
    sessionStorage.removeItem(key);
    const frame = requestAnimationFrame(() => {
      const entry = document.querySelector<HTMLElement>(
        `[data-story-id="${CSS.escape(id)}"]`,
      );
      entry?.scrollIntoView({ block: "center" });
      entry
        ?.querySelector<HTMLButtonElement>(".story-open")
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [actor, itemId, fragments]);
  useEffect(() => {
    setObservations([]);
    setPhotoMatches([]);
  }, [media, photoIndex]);
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
  const relatedChapters = (f: Fragment) =>
    chapters.filter((c) => c.fragmentIds.includes(f.id));
  const links = (f: Fragment) =>
    f.itemIds.length > 0 && (
      <div className="story-item-trace" aria-label="这段经历关联的物品">
        <span>那天一起的</span>
        {f.itemIds.map((id) => (
          <button
            type="button"
            key={id}
            disabled={!items.some((i) => i.id === id)}
            onClick={() => {
              sessionStorage.setItem("wujian.story-return." + actor, f.id);
              setOpened(null);
              onItem(id);
            }}
          >
            {items.find((i) => i.id === id)?.name || "已流转的物品"}
            <ArrowUpRight size={12} aria-hidden="true" />
          </button>
        ))}
      </div>
    );
  const metadata = (f: Fragment) => (
    <div className="story-dateline">
      <time dateTime={f.capturedOn || f.createdAt}>
        {f.capturedOn
          ? new Date(f.capturedOn + "T12:00:00").toLocaleDateString("zh-CN", {
              month: "long",
              day: "numeric",
            })
          : "记于 " +
            new Date(f.createdAt).toLocaleDateString("zh-CN", {
              month: "long",
              day: "numeric",
            })}
      </time>
      {(f.demo || f.origin === "fiction") && (
        <span className="story-demo-label">
          {f.demo ? "演示故事" : "虚构记录"}
        </span>
      )}
      {relatedChapters(f)
        .slice(0, 1)
        .map((c) => (
          <button
            key={c.id}
            className="story-chapter-link"
            onClick={() => {
              setOpened(null);
              setBrowseMode("chapters");
              setChapterId(c.id);
              setChapterIds(c.fragmentIds);
            }}
          >
            收在「{c.name}」
          </button>
        ))}
    </div>
  );
  const gallery = (f: Fragment, detail = false) =>
    photos(f).length > 0 && (
      <div
        className={
          detail
            ? "story-photo-sequence detail-sequence"
            : "story-photo-sequence"
        }
        data-photo-count={photos(f).length}
        aria-label="这次经历的照片"
        tabIndex={photos(f).length > 1 ? 0 : undefined}
      >
        {photos(f).map((id, index) => (
          <figure key={id}>
            <button
              type="button"
              aria-label={
                index === 0 && !detail
                  ? "放大故事照片"
                  : (detail ? "放大照片 " : "查看故事照片 ") + (index + 1)
              }
              onClick={() => enlarge(f, index)}
            >
              <img
                className="story-scene"
                src={url(id)}
                alt={f.demo ? "演示故事场景配图" : "用户保存的生活照片"}
                loading="lazy"
              />
              <span className="story-photo-enlarge">
                <Expand size={14} aria-hidden="true" />
              </span>
            </button>
            {photos(f).length > 1 && (
              <figcaption>
                {f.demo ? "演示场景" : "这次经历"} · {index + 1} /{" "}
                {photos(f).length}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
    );
  return (
    <section className="life-stories">
      <div className="life-section-head">
        <div>
          <h2>{itemId ? "它与你的故事" : "生活故事书"}</h2>
          <p>一张照片，一句话，把日常留在这里。</p>
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
              {media.length > 1 && (
                <label>
                  识别哪张照片
                  <select
                    aria-label="识别哪张照片"
                    value={Math.min(photoIndex, media.length - 1)}
                    onChange={(e) => setPhotoIndex(Number(e.target.value))}
                  >
                    {media.map((id, n) => (
                      <option key={id} value={n}>
                        第{n + 1}张照片
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
                      mediaId: media[photoIndex] || media[0],
                      confirmed: true,
                    });
                    setPhotoMatches([
                      ...new Map(
                        d.matches
                          .flatMap((m: any) => m.candidates)
                          .map((c: any) => [c.itemId, c]),
                      ).values(),
                    ] as { itemId: string; name: string; reason: string }[]);
                    setObservations(
                      d.matches.map(
                        (m: any) =>
                          m.observation.name +
                          "：" +
                          m.observation.uncertainties.join("；") +
                          (m.candidates.length ? "" : "（无已登记实例候选）"),
                      ),
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
              {observations.length > 0 && (
                <p className="life-muted">
                  视觉观察，待核对：{observations.join("；")}
                </p>
              )}
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
      <div className="story-reading-nav">
        <div
          role="group"
          aria-label="故事浏览方式"
          className="story-view-switch"
        >
          {[
            ["timeline", "时间流"],
            ["chapters", "按章节"],
            ["items", "按物品"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={browseMode === key}
              onClick={() => {
                setBrowseMode(key);
                setChapterId("all");
                setChapterIds(null);
                setFilter("all");
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="story-search">
          <span className="life-visually-hidden">寻找一段经历</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="找一句话、一段经历"
          />
        </label>
      </div>
      {browseMode === "chapters" && (
        <div className="story-chapter-shelf" aria-label="故事章节">
          {chapters.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={chapterId === c.id}
              onClick={() => {
                setChapterId(c.id);
                setChapterIds(c.fragmentIds);
              }}
            >
              <strong>{c.name}</strong>
              <span>{c.fragmentIds.length} 段经历</span>
            </button>
          ))}
          {!chapters.length && (
            <p>把相关经历收进同一章，随时可以更名或移出。</p>
          )}
        </div>
      )}
      {browseMode === "items" && (
        <label className="story-item-filter">
          循着一件物品翻阅
          <select
            aria-label="按关联物品浏览"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">全部故事</option>
            <option value="unlinked">未关联物品</option>
            {items
              .filter((i) => fragments.some((f) => f.itemIds.includes(i.id)))
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <div className="story-quiet-tools">
        <label>
          时间顺序
          <select
            aria-label="时间顺序"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
          >
            <option value="newest">最近在前</option>
            <option value="oldest">从最早翻起</option>
          </select>
        </label>
        <details className="life-story-browse-tools">
          <summary>整理与隐私</summary>
          {onAsk && (
            <button type="button" className="text-button" onClick={onAsk}>
              和物间聊聊这些故事
            </button>
          )}
          <StoryOrganization
            actor={actor}
            fragments={fragments}
            request={request}
            onChapters={setChapters}
            activeChapterId={chapterId}
            onFilter={(ids, id) => {
              setChapterIds(ids);
              if (id) setChapterId(id);
              setBrowseMode("chapters");
            }}
          />
        </details>
      </div>
      {fragments.some((f) => f.demo) && (
        <p className="story-demo-note">
          演示故事为虚构片段，使用公开场景配图，并非你的真实经历。
        </p>
      )}
      <div className="life-story-grid story-reading-stream">
        {rows.map((f, index) => {
          const photoCount = photos(f).length;
          const month = (f.capturedOn || f.createdAt).slice(0, 7);
          const previousMonth = index
            ? (rows[index - 1].capturedOn || rows[index - 1].createdAt).slice(
                0,
                7,
              )
            : null;
          return (
            <div key={f.id} className="story-stream-entry">
              {month !== previousMonth && (
                <h3 className="story-month">
                  {month.split("-")[0]}{" "}
                  <span>年 {Number(month.split("-")[1])} 月</span>
                </h3>
              )}
              <article
                data-story-id={f.id}
                data-story-type={
                  photoCount > 1 ? "sequence" : photoCount ? "photo" : "text"
                }
                className={
                  "life-story-page story-entry " +
                  (photoCount > 1
                    ? "multi-photo"
                    : photoCount
                      ? "single-photo"
                      : "text-only")
                }
              >
                {photoCount === 1 && gallery(f)}
                <div className="story-entry-copy">
                  {metadata(f)}
                  <p className="story-prose">{f.text}</p>
                  {photoCount > 1 && gallery(f)}
                  {links(f)}
                  <footer className="story-entry-footer">
                    <button
                      type="button"
                      className="story-open"
                      onClick={() => setOpened(f.id)}
                    >
                      阅读完整故事 <ArrowUpRight size={13} aria-hidden="true" />
                    </button>
                    <details className="story-management">
                      <summary aria-label="故事选项">
                        <MoreHorizontal size={18} />
                        <span className="life-visually-hidden">故事选项</span>
                      </summary>
                      <div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => edit(f)}
                        >
                          编辑片段
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => remove(f)}
                        >
                          删除片段
                        </button>
                      </div>
                    </details>
                  </footer>
                </div>
              </article>
            </div>
          );
        })}
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
            <header className="story-detail-header">
              <span>生活的一页</span>
              <button
                type="button"
                className="life-story-close"
                onClick={() => setOpened(null)}
                aria-label="关闭故事详情"
              >
                <X size={20} />
              </button>
            </header>
            <div className="story-detail-content">
              <h3 id={detailTitle} className="life-visually-hidden">
                {storyTitle(current.text)}
              </h3>
              {metadata(current)}
              <p className="life-story-fulltext">{current.text}</p>
              {gallery(current, true)}
              {links(current)}
              <details className="life-story-permissions">
                <summary>记录与隐私</summary>
                <p>{provenance(current)}</p>
                <p>
                  {current.capturedOn
                    ? "事件日期：" + current.capturedOn
                    : "事件日期未填写"}{" "}
                  · 记下于{" "}
                  {new Date(current.createdAt).toLocaleDateString("zh-CN")}
                </p>
                {current.demo && (
                  <p>
                    场景配图仅供虚构演示，来源与许可：
                    <a
                      href="/demo/stories/SOURCES.json"
                      target="_blank"
                      rel="noreferrer"
                    >
                      配图说明
                    </a>
                    ；不代表同一真实事件或型号实拍。
                  </p>
                )}
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
