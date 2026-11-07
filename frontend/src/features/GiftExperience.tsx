import { useEffect, useRef, useState } from "react";
import { Modal } from "antd";
import { ArrowLeft, ArrowRight, Gift as GiftIcon, MessageCircle, Sparkles, Volume2 } from "lucide-react";
import { request, type Gift, type Item, type Workspace } from "../api";
import { ObjectCompanion } from "./ObjectCompanion";
import { safeDate, speak } from "./shared";
import "./gift-experience.css";

/** A presentation of the existing gift and its received Item/Experiences.
 * Opening the wrapping is local UI; ownership and story consent change only
 * through the canonical accept endpoint after the recipient chooses a button.
 */
export default function GiftExperience({ gift, userId, workspace, refresh, onClose, onItem, onCompanion }: {
  gift: Gift;
  userId: string;
  workspace: Workspace;
  refresh: () => Promise<unknown>;
  onClose: () => void;
  onItem: (id: string) => void;
  onCompanion: (item: Item, text?: string) => void;
}) {
  const [opened, setOpened] = useState(gift.status === "accepted");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if ("speechSynthesis" in window) window.speechSynthesis.cancel(); };
  }, []);
  const recipient = gift.recipient.id === userId;
  const received = gift.status === "accepted" && recipient;
  const item = received ? workspace.items.find((candidate) => candidate.id === gift.item_id && candidate.owner_id === userId) : undefined;
  const stories = received
    ? workspace.experiences.filter((experience) => experience.provenance?.gift_id === gift.id && experience.item_ids.includes(gift.item_id))
    : gift.snapshot.experiences;
  const surprises = received ? item?.avatar.gift_memories || [] : gift.snapshot.surprises || [];
  const lockedIds = new Set(surprises.filter((surprise) => !("unlocked" in surprise && surprise.unlocked)).map((surprise) => surprise.experience_id));
  const visibleStories = stories.filter((story) => !lockedIds.has(story.id));
  const current = visibleStories[Math.min(page, Math.max(visibleStories.length - 1, 0))];
  const preview = {
    name: gift.snapshot.name,
    kind: "nonstandard_object" as const,
    photo_id: gift.snapshot.photo_id || null,
    avatar: { ...gift.snapshot.avatar, gift_from: gift.sender.display_name,
      gift_message: gift.snapshot.message, growth_note: "", growth_source: "" },
  };
  const companion = item || preview;
  const author = current ? String(current.provenance?.author_name || gift.sender.display_name) : gift.sender.display_name;
  async function act(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await operation(); }
    catch (failure) { if (mounted.current) setError((failure as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function accept(chat: boolean) {
    await request(`/gifts/${gift.id}/accept`, "POST", { wake_avatar: chat, allow_story_ai: chat });
    // Fetch the authoritative received instance, not an avatar reconstructed
    // from the sender's snapshot, before entering its normal persona chat.
    const receivedItem = chat ? await request<Item>(`/items/${gift.item_id}`) : undefined;
    await refresh();
    if (!mounted.current) return;
    onClose();
    if (receivedItem?.avatar.enabled) onCompanion(receivedItem, "我收下这份礼物了，想认识一下你。有什么留给我的小心意吗？");
    else onItem(gift.item_id);
  }
  function startChat(text?: string) {
    if (!item) return;
    onClose();
    onCompanion(item, text);
  }
  return <Modal open title="一份会继续陪伴的心意" footer={null} width={640} onCancel={onClose}
    className="gift-experience-modal" destroyOnHidden>
    <section className={`gift-experience ${opened ? "is-open" : ""}`} aria-busy={busy}>
      <header className="gift-experience-heading">
        <span>来自 {gift.sender.display_name} · 给 {gift.recipient.display_name}</span>
        <h2>{gift.snapshot.name}</h2>
      </header>
      <div className="gift-experience-stage">
        {companion.avatar.enabled
          ? <ObjectCompanion item={companion} size={210} expression={opened ? "happy" : "calm"} showPhoto />
          : companion.photo_id
            ? <img className="gift-object-photo" src={`/api/assets/${encodeURIComponent(companion.photo_id)}`} alt={gift.snapshot.name} />
            : <GiftIcon className="gift-wrapped-icon" size={120} strokeWidth={.85} aria-hidden />}
        <span className="gift-stage-caption">{opened ? (companion.avatar.nickname || gift.snapshot.name) : "有一份心意，在这里等你"}</span>
        {!opened && <button type="button" className="primary-button" onClick={() => setOpened(true)}>
          <GiftIcon size={18} />{recipient ? "拆开这份心意" : "预览这份心意"}
        </button>}
      </div>
      {opened && <div className="gift-open-content">
        {gift.snapshot.message && <article className="gift-letter">
          <span>{gift.sender.display_name}想对你说</span>
          <blockquote>{gift.snapshot.message}</blockquote>
          <button type="button" className="quiet-button" onClick={() => {
            if (!speak(gift.snapshot.message)) setError("当前浏览器不能朗读，可以直接阅读这封心意。");
          }}><Volume2 size={16} />听一遍</button>
        </article>}
        {current && <article className="gift-story-stage" aria-live="polite">
          {current.photo_ids.length > 0 && <div className="gift-story-photos">
            {current.photo_ids.map((id, index) => <img key={id} src={`/api/assets/${encodeURIComponent(id)}`}
              alt={`${current.title}的照片${index + 1}`} loading="lazy" />)}
          </div>}
          <div className="gift-story-copy">
            <small>{author}留下的原记录 · {safeDate(current.occurred_on)}</small>
            <h3>{current.title}</h3>
            <p>{current.text}</p>
          </div>
          {visibleStories.length > 1 && <nav className="gift-story-pages" aria-label="礼物的故事">
            <button type="button" className="quiet-button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ArrowLeft size={16} />上一段</button>
            <span>{Math.min(page + 1, visibleStories.length)} / {visibleStories.length}</span>
            <button type="button" className="quiet-button" disabled={page >= visibleStories.length - 1} onClick={() => setPage((value) => value + 1)}>下一段<ArrowRight size={16} /></button>
          </nav>}
        </article>}
        {surprises.length > 0 && <section className="gift-surprises">
          <h3><Sparkles size={18} />藏在相处里的小心意</h3>
          {surprises.map((surprise) => <div key={surprise.experience_id} className="gift-surprise-hint">
            <p>{surprise.hint}</p>
            {item?.avatar.enabled && (!("chat_allowed" in surprise) || surprise.chat_allowed !== false) && <button type="button" className="soft-button" onClick={() => startChat(surprise.trigger_words?.[0]
              ? `我想聊聊「${surprise.trigger_words[0]}」，这里是不是藏着一份小心意？`
              : "这份礼物里是不是藏着一份小心意？")}>
              <MessageCircle size={16} />{"unlocked" in surprise && surprise.unlocked ? "再聊聊这段故事" : "和它聊聊"}
            </button>}
            {"chat_allowed" in surprise && !surprise.chat_allowed && <small>这段故事未开启对话许可，仍可在回忆墙查看与调整。</small>}
          </div>)}
          {!received && <p className="form-note">接收并开启故事对话后，可以和这份礼物慢慢发现这些心意。</p>}
        </section>}
        {companion.avatar.personality && <p className="gift-personality">相处的样子：{companion.avatar.personality}</p>}
        <p className="form-note">收到的故事保留原作者。之后的形象与相处由接收者决定，新的私人聊天不会回传给赠送者。实物交付由双方另行确认。</p>
        <div className="gift-experience-actions">
          {gift.status === "pending" && recipient && <>
            <button type="button" className="primary-button full-width" disabled={busy} onClick={() => void act(() => accept(true))}>
              <MessageCircle size={18} />收下并开启故事对话
            </button>
            <p className="form-note">开启后，这个物品分身可以使用随礼物选送的故事与你聊天。你随时可以在回忆里调整。</p>
            <button type="button" className="soft-button full-width" disabled={busy} onClick={() => void act(() => accept(false))}>仅收下，暂不开启对话</button>
            <button type="button" className="quiet-button" disabled={busy} onClick={() => void act(async () => {
              await request(`/gifts/${gift.id}/decision`, "POST", { action: "decline" });
              await refresh(); if (mounted.current) onClose();
            })}>婉拒这份心意</button>
          </>}
          {received && item && <>
            {item.avatar.enabled && <button type="button" className="primary-button full-width" onClick={() => startChat()}><MessageCircle size={18} />和这份礼物聊聊</button>}
            <button type="button" className="soft-button full-width" onClick={() => { onClose(); onItem(item.id); }}>去我的物品，看看它的新故事<ArrowRight size={16} /></button>
          </>}
          {received && !item && <p className="form-note">这件物品目前不在你的物品栏，不能从旧礼物记录开启它的对话。</p>}
          {gift.status === "pending" && gift.sender.id === userId && <button type="button" className="soft-button full-width" disabled={busy} onClick={() => void act(async () => {
            await request(`/gifts/${gift.id}/decision`, "POST", { action: "cancel" });
            await refresh(); if (mounted.current) onClose();
          })}>取消待接收的心意</button>}
          {gift.status === "declined" && <p>这份心意已被婉拒。</p>}
          {gift.status === "cancelled" && <p>这份心意已取消。</p>}
        </div>
      </div>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </section>
  </Modal>;
}
