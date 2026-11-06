"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  X,
  Camera,
  Loader2,
  Image as ImageIcon,
  ArrowRight,
  Link2,
  Upload,
  Lock,
  Check,
  Gift,
} from "lucide-react";
import type {
  API,
  Item,
  Person,
  Preferences,
  Wish,
  GiftNote,
  Fragment,
  AppData,
} from "./types";
import { names } from "./types";
import type { ServiceSession } from "@/lib/agent/contracts";
import { preparePhonePhoto } from "./photo-upload";
import { itemPhoto } from "@/lib/life/item-photos";
import { ItemInformation } from "@/components/life/ItemInformation";

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = Array.from(
          box.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]",
          ) || [],
        ).filter((n) => n.offsetParent !== null);
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="wj-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        tabIndex={-1}
        className={"wj-modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="wj-icon-btn"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <div className="wj-modal-body">{children}</div>
      </div>
    </div>
  );
}
export function ItemEditor({
  item,
  api,
  actor,
  data,
  shared,
  onSaved,
  onAsk,
}: {
  item?: Item;
  api: API;
  actor: Person;
  data: AppData;
  shared: boolean;
  onSaved: (i: Item) => void;
  onAsk: (s: string) => void;
}) {
  const [name, setName] = useState(item?.name || ""),
    [location, setLocation] = useState(item?.location || ""),
    [note, setNote] = useState(item?.note || ""),
    [family, setFamily] = useState(item?.shared ?? shared),
    [model, setModel] = useState(
      item?.model === "待确认" ? "" : item?.model || "",
    ),
    [brand, setBrand] = useState(item?.brand || ""),
    [support, setSupport] = useState(item?.supportUrl || ""),
    [identification, setIdentification] = useState<any>(null),
    [pack, setPack] = useState(item?.productBinding?.packId || ""),
    [photo, setPhoto] = useState<{ id?: string; url: string } | null>(
      itemPhoto(item || ({} as Item), actor)
        ? { url: itemPhoto(item!, actor)!.src }
        : null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [availability, setAvailability] = useState(
      item?.availability || "available",
    );
  const saved = useRef<Item | undefined>(item),
    requestId = useRef(crypto.randomUUID());
  const file = useRef<HTMLInputElement>(null);
  async function upload(f: File) {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("kind", "photo");
      form.set("file", await preparePhonePhoto(f));
      const d = await api("/api/life", form);
      setPhoto(d);
      setIdentification(null);
      if (data.capabilities.vision?.ready) await recognize(false, d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function recognize(askAfter = false, selectedPhoto = photo) {
    if (!selectedPhoto?.id) return;
    setBusy(true);
    setError("");
    try {
      const d = await api("/api/life", {
        action: "recognizePhoto",
        input: { mediaId: selectedPhoto.id, confirmed: true },
      });
      const c = d.candidates?.[0];
      const observed = d.observation || d.description || d.summary;
      setIdentification(c || null);
      if (c?.name) {
        setName(c.name);
        if (c.brand) setBrand(c.brand);
        if (c.model) setModel(c.model);
        if (askAfter) {
          onAsk(
            `照片识别出${c.name}，${c.brand || ""} ${c.model || ""}。${c.modelStatus === "estimated" ? "这是外观推测的型号，可先按这个参考型号回答并标注演示建议。" : ""}${c.observedText ? "可见文字：" + c.observedText + "。" : ""}${note || "我想了解应该怎么使用或照顾它，请一步一步指导。"}`,
          );
          return;
        }
      } else if (typeof observed === "string") setNote(observed);
      setError(
        c
          ? "识别好了，可以直接保存，名称和型号也可以修改。"
          : "已取得识别结果，请补上你给它的称呼。",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      let i = saved.current;
      if (!i) {
        const d = await api("/api/life", {
          action: "createItem",
          input: {
            requestId: requestId.current,
            name,
            model: model || "待确认",
            brand,
            category: family ? "家庭用品" : "个人物品",
            lifecycle: "长期耐用",
            availability: "available",
            mediaId: photo?.id,
            packId: pack || undefined,
            confirmed: !!pack,
          },
        });
        i = d.item;
        saved.current = i;
      }
      await api("/api/workspace", {
        action: "updateItem",
        itemId: i!.id,
        name,
        location: location || "未设置",
        note:
          identification?.modelStatus === "estimated"
            ? `${note}\n照片推测型号：${brand} ${model}，尚未实物核对。`.trim()
            : note,
        shared: family,
        model: model || "待确认",
        brand,
        availability,
        supportUrl: support,
        ...(identification?.referenceProductId &&
        identification.model === model &&
        identification.brand === brand
          ? { referenceProductId: identification.referenceProductId }
          : {}),
      });
      if (photo?.id)
        await api("/api/companion", {
          action: "replacePhoto",
          input: { itemId: i!.id, mediaId: photo.id },
        });
      onSaved({
        ...i!,
        name,
        location,
        note,
        shared: family,
        model: model || "待确认",
        brand,
        availability,
        supportUrl: support,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="wj-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input
        ref={file}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="上传物品照片并识别"
        onChange={(e) => {
          if (e.target.files?.[0]) upload(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="wj-upload"
        onClick={() => file.current?.click()}
        disabled={busy}
      >
        {photo ? (
          <img src={photo.url} alt="物品照片" />
        ) : (
          <>
            <Camera size={36} />
            <span>拍一下，AI 帮你认物品和型号</span>
            <small>选择照片后自动识别；推测结果可以直接修改。</small>
          </>
        )}
      </button>
      {photo && (
        <div className="wj-actions">
          <button
            type="button"
            className="wj-link"
            onClick={() => file.current?.click()}
          >
            换一张照片
          </button>
          {photo.id && data.capabilities.vision?.ready && (
            <button
              type="button"
              className="wj-link"
              disabled={busy}
              onClick={() => recognize(false)}
            >
              用 AI 识别这张照片
            </button>
          )}
        </div>
      )}
      {identification && (
        <div className="wj-identification-card" role="status">
          <strong>{identification.name}</strong>
          <p>
            {[identification.brand, identification.model]
              .filter(Boolean)
              .join(" · ") || "已识别物品类型"}
          </p>
          <small>
            {identification.modelStatus === "estimated"
              ? "外观推测型号 · 可采用或修改"
              : identification.modelStatus === "visible-text"
                ? "根据照片上的文字识别"
                : "先记下来，以后可以补型号"}
          </small>
        </div>
      )}
      <label>
        它叫什么？
        <input
          required
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：小雨做的杯子"
        />
      </label>
      <div>
        <span className="wj-label">收在哪里</span>
        <div className="wj-segment">
          <button
            type="button"
            className={family ? "active" : ""}
            onClick={() => setFamily(true)}
          >
            家庭用品
          </button>
          <button
            type="button"
            className={!family ? "active" : ""}
            onClick={() => setFamily(false)}
          >
            我的物品
          </button>
        </div>
        <small>
          {family ? "和家人一起照看。" : "仅自己可见，故事由自己决定是否分享。"}
        </small>
      </div>
      <details className="wj-details wj-extra-item-details">
        <summary>补充位置和一句话（可选）</summary>{" "}
        <label>
          放在哪里？
          <input
            value={location}
            maxLength={80}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="例如：书房"
          />
        </label>
        <label>
          想记住的一句话（可选）
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="它从哪里来，或有什么需要注意的？"
          />
        </label>
      </details>
      <details className="wj-details">
        <summary>型号、状态和售后资料（需要时再补）</summary>
        <label>
          品牌
          <input
            value={brand}
            maxLength={80}
            onChange={(e) => setBrand(e.target.value)}
          />
        </label>
        <label>
          型号
          <input
            value={model}
            maxLength={100}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        {!item && (
          <label>
            核对并绑定已收录型号
            <select
              value={pack}
              onChange={(e) => {
                const p = data.packs.find((p) => p.id === e.target.value);
                setPack(e.target.value);
                if (p) setModel(p.model);
              }}
            >
              <option value="">不绑定，我还不确定</option>
              {data.packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.product} · {p.model}
                </option>
              ))}
            </select>
            <small>选择型号表示已核对实物，未知信息可以保留为空。</small>
          </label>
        )}
        <label>
          现在的状态
          <select
            value={availability}
            onChange={(e) => setAvailability(e.target.value as any)}
          >
            <option value="available">正常使用</option>
            <option value="unknown">待确认</option>
            <option value="broken">暂停使用 / 待维修</option>
            <option value="loaned">借出</option>
            <option value="gifted">已赠送</option>
            <option value="lost">实物已不在</option>
            <option value="consumed">已用完</option>
          </select>
        </label>
        <label>
          售后链接
          <input
            type="url"
            value={support}
            onChange={(e) => setSupport(e.target.value)}
            placeholder="https://…"
          />
        </label>
      </details>
      {error && (
        <p className="wj-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="wj-form-footer">
        {!item && photo?.id && data.capabilities.vision?.ready && (
          <button
            type="button"
            className="wj-btn secondary"
            disabled={busy}
            onClick={() => recognize(true)}
          >
            识别照片后提问
          </button>
        )}
        <button className="wj-btn" disabled={busy || !name.trim()}>
          {busy ? <Loader2 className="spin" size={17} /> : null}
          {item ? "保存修改" : "记下来"}
        </button>
        {!item && (
          <button
            type="button"
            className="wj-btn secondary"
            disabled={!name.trim() || busy}
            onClick={() =>
              onAsk(
                `我想问一下${name}：${note || "应该怎么使用？"}${model ? " 型号是 " + model : ""}`,
              )
            }
          >
            先问问，不保存
            <ArrowRight size={16} />
          </button>
        )}
      </div>
    </form>
  );
}
export function StoryEditor({
  fragment,
  item,
  api,
  onSaved,
}: {
  fragment?: Fragment;
  item?: Item;
  api: API;
  onSaved: () => void;
}) {
  const [text, setText] = useState(fragment?.text || ""),
    [date, setDate] = useState(
      fragment?.capturedOn || new Date().toLocaleDateString("sv-SE"),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [media, setMedia] = useState<string[]>(fragment?.mediaIds || []);
  return (
    <form
      className="wj-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api("/api/life", {
            action: "fragment",
            input: {
              id: fragment?.id,
              revision: fragment?.revision,
              text,
              itemIds: fragment?.itemIds || [item!.id],
              capturedOn: date || null,
              mediaIds: media,
              allowRecall: true,
              allowCloud: false,
            },
          });
          onSaved();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="wj-story-intro">
        <img src="/companion/ayuan.webp" alt="" />
        <p>
          有些东西，因为经历过，
          <br />
          才变得不一样。
        </p>
      </div>
      <label>
        记一段
        <textarea
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={10000}
          rows={7}
          placeholder="那天发生了什么？你为什么想留住它？"
        />
      </label>
      <label>
        发生的日子
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <label className="wj-file-button">
        <ImageIcon size={18} />
        添加照片（最多 8 张）
        <input
          hidden
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={async (e) => {
            const files = Array.from(e.target.files || []).slice(
              0,
              8 - media.length,
            );
            setBusy(true);
            try {
              const ids = [...media];
              for (const f of files) {
                const form = new FormData();
                form.set("kind", "story-photo");
                form.set("file", f);
                ids.push((await api("/api/life", form)).id);
              }
              setMedia(ids);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {media.length > 0 && (
        <p>
          已添加 {media.length} 张照片{" "}
          <button
            className="wj-link"
            type="button"
            onClick={() => setMedia([])}
          >
            清除本次照片
          </button>
        </p>
      )}
      <small>
        <Lock size={13} /> 留给自己，不会自动发送给朋友或模型。
      </small>
      {error && <p className="wj-form-error">{error}</p>}
      <button className="wj-btn" disabled={busy || !text.trim()}>
        {busy ? "正在保存…" : "留住这段回忆"}
      </button>
    </form>
  );
}
export function WishEditor({
  wish,
  api,
  onSaved,
}: {
  wish?: Wish;
  api: API;
  onSaved: () => void;
}) {
  const [name, setName] = useState(wish?.name || ""),
    [note, setNote] = useState(wish?.note || ""),
    [url, setUrl] = useState(wish?.url || ""),
    [shared, setShared] = useState(wish?.shared ?? true),
    [photo, setPhoto] = useState(wish?.photo || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="wj-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api("/api/companion", {
            action: "wish",
            input: {
              id: wish?.id,
              revision: wish?.revision,
              name,
              note,
              url,
              shared,
              photo,
            },
          });
          onSaved();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="wj-muted">
        收藏自己喜欢的东西，朋友偶然看到，也许会有一点惊喜。
      </p>
      <label>
        想买什么？
        <input
          required
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：床头阅读灯"
        />
      </label>
      <label>
        喜欢它的原因
        <textarea
          rows={3}
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例如：想留一盏舒服的灯，睡前读书。"
        />
      </label>
      <label>
        商品链接（可选）
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
        />
      </label>
      <label className="wj-file-button">
        <Camera size={18} />
        添加商品照片
        <input
          type="file"
          hidden
          accept="image/jpeg,image/png,image/webp"
          onChange={async (e) => {
            if (!e.target.files?.[0]) return;
            setBusy(true);
            try {
              const f = new FormData();
              f.set("kind", "photo");
              f.set("file", e.target.files[0]);
              setPhoto((await api("/api/life", f)).url);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {photo && <img className="wj-form-photo" src={photo} alt="商品照片" />}
      <label className="wj-checkbox">
        <input
          type="checkbox"
          checked={shared}
          onChange={(e) => setShared(e.target.checked)}
        />
        让朋友看见这件想买的东西
      </label>
      {error && <p className="wj-form-error">{error}</p>}
      <button className="wj-btn" disabled={busy || !name.trim()}>
        {busy ? "保存中…" : "保存到想买清单"}
      </button>
    </form>
  );
}
export function GiftEditor({
  wish,
  draft,
  api,
  notify,
  onSaved,
}: {
  wish: Wish;
  draft?: GiftNote;
  api: API;
  notify: (s: string) => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(
      draft?.message || "希望这份礼物，给你的日常添一点开心。",
    ),
    [paper, setPaper] = useState(draft?.paper || "plain"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const current = useRef(draft);
  async function save(buy = false) {
    const win = buy ? window.open("about:blank", "_blank") : null;
    if (win) win.opener = null;
    setBusy(true);
    try {
      const d = await api("/api/companion", {
        action: "giftNote",
        input: {
          id: current.current?.id,
          revision: current.current?.revision,
          wishId: wish.id,
          message: text,
          paper,
        },
      });
      current.current = d.giftNote;
      if (buy) {
        const target =
          wish.url ||
          "https://s.taobao.com/search?q=" + encodeURIComponent(wish.name);
        if (win) win.location.href = target;
        else notify("赠言已保存。请点击商品链接继续购买。");
      }
      notify(buy ? "赠言已保存，已打开购买入口" : "赠言草稿已保存");
      onSaved();
    } catch (e) {
      win?.close();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="wj-gift-editor">
      <div className="wj-gift-recipient">
        <span className={"wj-person " + wish.owner}>
          {names[wish.owner].slice(-1)}
        </span>
        <div>
          <small>送给 {names[wish.owner]}</small>
          <h3>{wish.name}</h3>
          <p>来自{names[wish.owner]}的想买清单</p>
        </div>
      </div>
      <label className="wj-label">
        想对{wish.owner === "dad" ? "他" : "她"}说的话
      </label>
      <textarea
        aria-label="赠言内容"
        className="wj-gift-note"
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        rows={5}
      />
      <div className="wj-paper-options">
        <button
          className={paper === "plain" ? "active" : ""}
          onClick={() => setPaper("plain")}
        >
          <span>♡</span>素色信笺
        </button>
        <button
          className={paper === "handwritten" ? "active" : ""}
          onClick={() => setPaper("handwritten")}
        >
          <span>✎</span>手写便签
        </button>
      </div>
      <div
        className={
          "wj-letter " + (paper === "handwritten" ? "handwritten" : "")
        }
      >
        <p>{text}</p>
        <img src="/companion/ayuan.webp" alt="" />
      </div>
      {error && <p className="wj-form-error">{error}</p>}
      <div className="wj-form-footer">
        <button
          className="wj-btn"
          disabled={busy || !text.trim()}
          onClick={() => save(true)}
        >
          保存赠言，去购买
          <ArrowRight size={17} />
        </button>
        <button
          className="wj-btn secondary"
          disabled={busy || !text.trim()}
          onClick={() => save(false)}
        >
          先存草稿
        </button>
      </div>
      <a
        className="wj-link"
        href={
          wish.url ||
          "https://s.taobao.com/search?q=" + encodeURIComponent(wish.name)
        }
        target="_blank"
        rel="noreferrer"
      >
        <Link2 size={14} />
        {wish.url ? "直接打开商品链接" : "去淘宝选购这件礼物"}
      </a>
    </div>
  );
}
export function CompanionEditor({
  preferences,
  api,
  onSaved,
}: {
  preferences: Preferences;
  api: API;
  onSaved: (p: Preferences) => void;
}) {
  const [p, setP] = useState(preferences),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="wj-form wj-customizer"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const d = await api("/api/companion", {
            action: "preferences",
            input: { ...p, onboarded: true },
          });
          await api("/api/memories", {
            action: "persona",
            input: {
              enabled: true,
              nickname: p.name,
              style: p.style,
              memoryUse: "explicit",
            },
          });
          onSaved(d.preferences);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="wj-custom-stage">
        <img
          className={"wj-mascot " + p.color + " " + p.expression}
          src="/companion/ayuan.webp"
          alt="你的物伴"
        />
        {p.accessory === "bow" && <span className="wj-accessory">🎀</span>}
        {p.expression === "happy" && <span className="wj-expression">♡</span>}
        {p.expression === "sleepy" && (
          <span className="wj-expression">z z</span>
        )}
      </div>
      <label>
        它叫什么名字？
        <input
          required
          value={p.name}
          maxLength={24}
          onChange={(e) => setP({ ...p, name: e.target.value })}
        />
      </label>
      <span className="wj-label">颜色</span>
      <div className="wj-swatches">
        {[
          ["original", "原色"],
          ["rose", "灰粉"],
          ["oat", "燕麦"],
          ["blue", "雾蓝"],
        ].map(([c, t]) => (
          <button
            type="button"
            title={t}
            aria-label={t}
            key={c}
            className={c + (p.color === c ? " active" : "")}
            onClick={() => setP({ ...p, color: c })}
          >
            {p.color === c && <Check size={18} />}
          </button>
        ))}
      </div>
      <span className="wj-label">表情</span>
      <div className="wj-segment">
        {[
          ["calm", "安静"],
          ["happy", "开心"],
          ["sleepy", "困困"],
        ].map(([v, t]) => (
          <button
            key={v}
            type="button"
            className={p.expression === v ? "active" : ""}
            onClick={() => setP({ ...p, expression: v })}
          >
            {t}
          </button>
        ))}
      </div>
      <span className="wj-label">配饰</span>
      <div className="wj-segment">
        {[
          ["scarf", "围巾"],
          ["bow", "蝴蝶结"],
        ].map(([v, t]) => (
          <button
            key={v}
            type="button"
            className={p.accessory === v ? "active" : ""}
            onClick={() => setP({ ...p, accessory: v })}
          >
            {t}
          </button>
        ))}
      </div>
      <span className="wj-label">和你说话的方式</span>
      <div className="wj-segment">
        {[
          ["neutral", "简洁一点"],
          ["warm", "温柔一点"],
          ["playful", "活泼一点"],
        ].map(([v, t]) => (
          <button
            key={v}
            type="button"
            className={p.style === v ? "active" : ""}
            onClick={() => setP({ ...p, style: v as any })}
          >
            {t}
          </button>
        ))}
      </div>
      {error && <p className="wj-form-error">{error}</p>}
      <button className="wj-btn" disabled={busy || !p.name.trim()}>
        {busy ? "保存中…" : "就这样，认识一下吧"}
      </button>
    </form>
  );
}
