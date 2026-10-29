"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Leaf,
  Moon,
  Sun,
  Frame,
  Package,
  ImageIcon,
} from "lucide-react";
import type { Item, Person } from "@/lib/domain";
import type { Persona } from "@/lib/agent/contracts";
import type { ProductPack } from "@/lib/products";
import { AssistantConversation } from "../AssistantConversation";
import { MemoryCenter } from "../MemoryCenter";
import type { Fragment } from "./Stories";
import type { LifeRequest } from "./Intake";

const avatars = {
  object: Package,
  sprout: Leaf,
  sun: Sun,
  moon: Moon,
  frame: Frame,
  photo: ImageIcon,
};
const avatarNames = {
  object: "物品",
  sprout: "新芽",
  sun: "小太阳",
  moon: "月亮",
  frame: "画框",
  photo: "物品照片",
};
export function ItemBelonging({
  actor,
  item,
  items,
  packs,
  fragments,
  request,
  upload,
  refresh,
  onContinue,
  onSession,
}: {
  actor: Person;
  item: Item;
  items: Item[];
  packs: ProductPack[];
  fragments: Fragment[];
  request: LifeRequest;
  upload: (file: File, kind: string) => Promise<{ id: string; url: string }>;
  refresh: () => Promise<void>;
  onContinue: () => void;
  onSession: (s: import("@/lib/agent/contracts").ServiceSession | null) => void;
}) {
  const [persona, setPersona] = useState<Persona>({
    enabled: false,
    nickname: "",
    style: "warm",
    memoryUse: "relevant",
    avatar: "object",
    itemId: item.id,
  });
  const [voice, setVoice] = useState(false),
    [useStories, setUseStories] = useState(false),
    [capture, setCapture] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [sessionKey, setSessionKey] = useState(0);
  const [story, setStory] = useState(""),
    [storyPhoto, setStoryPhoto] = useState<{ id: string; url: string }>(),
    [cloud, setCloud] = useState(false),
    [recall, setRecall] = useState(false),
    [savedStory, setSavedStory] = useState<Fragment>();
  const memoryRequest = useRef(crypto.randomUUID()),
    storyRequest = useRef<string | undefined>(undefined);
  const [profileReady, setProfileReady] = useState(false),
    [savedEnabled, setSavedEnabled] = useState(false);
  const own = item.owner === actor;
  const pack = packs.find(
    (p) =>
      p.id === item.productBinding?.packId &&
      p.version === item.productBinding.version &&
      p.model === item.model,
  );
  const related = fragments.filter((f) => f.itemIds.includes(item.id));
  const Avatar = avatars[persona.avatar || "object"];
  async function memoryRequestAPI(body: unknown) {
    const r = await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-demo-actor": actor },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    window.dispatchEvent(new Event("memory-updated"));
    window.dispatchEvent(new Event("memory-captured"));
    return d;
  }
  useEffect(() => {
    let alive = true;
    fetch(`/api/memories?itemId=${encodeURIComponent(item.id)}`, {
      headers: { "x-demo-actor": actor },
    })
      .then((r) => r.json())
      .then((d) => {
        if (alive && d.persona) {
          setPersona({ ...d.persona, avatar: d.persona.avatar || "object" });
          setSavedEnabled(d.persona.enabled);
          setProfileReady(true);
        }
      })
      .catch(() => setNotice("分身设置暂时未加载，请稍后重试"));
    return () => {
      alive = false;
    };
  }, [actor, item.id]);
  return (
    <div className="belong-world">
      <div className="belong-world-intro">
        <span className="belong-kicker">IT BECOMES YOURS · 它的这一章</span>
        <h2>认识它，也认识你们。</h2>
        <p>商品资料告诉我们它能做什么。你的经历，让帮助更贴近你。</p>
        {item.synthetic && (
          <span className="belong-test">
            体验测试物品 · 持有及私人经历均为合成设定
          </span>
        )}
      </div>
      <div className="belong-world-grid">
        <aside className="belong-sidebar">
          <article className="belong-sheet">
            <span className="belong-kicker">01 / 物品本身</span>
            <h3>它是什么</h3>
            {pack ? (
              <>
                <p className="belong-fact-label">官方型号事实 · {pack.model}</p>
                <ul>
                  {pack.claims.map((c) => (
                    <li key={c.id}>{c.text}</li>
                  ))}
                </ul>
                <details>
                  <summary>限制、未知与依据</summary>
                  {pack.limits.map((l) => (
                    <p key={l}>{l}</p>
                  ))}
                  <a href={pack.source.url} target="_blank" rel="noreferrer">
                    {pack.source.title} <ArrowUpRight size={13} />
                  </a>
                  <p>资料核对：{pack.source.checkedAt}</p>
                </details>
              </>
            ) : (
              <p>
                尚无已确认的官方型号资料。材质、尺寸等来自本人报告，不视为厂家认证。
              </p>
            )}
            <div className="belong-personal-facts">
              <span>你的这一件 · 本人报告</span>
              <p>
                {item.location || "位置未知"} ·{" "}
                {item.availability === "available"
                  ? "本人确认在手可用"
                  : "实际可用状态尚待确认"}
              </p>
              {Object.entries(item.attributes || {})
                .filter(([, v]) => typeof v === "string" && v)
                .map(([k, v]) => (
                  <p key={k}>
                    {(
                      {
                        material: "材质",
                        dimensions: "尺寸",
                        care: "养护",
                        power: "供电",
                      } as Record<string, string>
                    )[k] || k}
                    ：{String(v)}
                  </p>
                ))}
              <p>
                {item.note ||
                  "还没有个人备注。当前磨损、安装与环境条件，仍需实际核对。"}
              </p>
            </div>
          </article>
          {own && (
            <article className="belong-sheet belong-persona">
              <span className="belong-kicker">03 / 一种可选的陪伴</span>
              <div className="belong-avatar">
                {persona.avatar === "photo" && item.photo ? (
                  <img src={item.photo} alt="分身使用的物品照片" />
                ) : (
                  <>
                    <Avatar size={52} />
                    <i />
                    <i />
                  </>
                )}
              </div>
              <h3>{persona.nickname || "给它一个名字"}</h3>
              <p>分身是它的一种表达方式。知道的事实相同，语气可以只属于你。</p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    await memoryRequestAPI({
                      action: "persona",
                      input: { ...persona, itemId: item.id },
                    });
                    setSavedEnabled(persona.enabled);
                    setNotice("分身设置已保存；故事授权仍独立。 ");
                    if (!persona.enabled) setVoice(false);
                  } catch (err) {
                    setNotice((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label className="belong-check">
                  <input
                    type="checkbox"
                    checked={persona.enabled}
                    onChange={(e) =>
                      setPersona({ ...persona, enabled: e.target.checked })
                    }
                  />
                  为它启用数字分身
                </label>
                <label>
                  分身的名字
                  <input
                    aria-label="分身的名字"
                    maxLength={40}
                    value={persona.nickname}
                    onChange={(e) =>
                      setPersona({ ...persona, nickname: e.target.value })
                    }
                  />
                </label>
                <fieldset className="belong-avatar-choices">
                  <legend>选择形象（照片使用物品自己的照片）</legend>
                  {Object.entries(avatars).map(([id, Icon]) => (
                    <button
                      key={id}
                      type="button"
                      aria-label={
                        avatarNames[id as keyof typeof avatarNames] + "形象"
                      }
                      aria-pressed={persona.avatar === id}
                      onClick={() =>
                        setPersona({
                          ...persona,
                          avatar: id as Persona["avatar"],
                        })
                      }
                    >
                      <Icon size={24} />
                    </button>
                  ))}
                </fieldset>
                <label>
                  交流风格
                  <select
                    value={persona.style}
                    onChange={(e) =>
                      setPersona({
                        ...persona,
                        style: e.target.value as Persona["style"],
                      })
                    }
                  >
                    <option value="warm">亲切自然</option>
                    <option value="neutral">简洁直接</option>
                    <option value="playful">轻松俏皮</option>
                  </select>
                </label>
                <button className="belong-primary" disabled={busy}>
                  保存分身设置
                </button>
              </form>
              <small>私人故事、对话和分身设置不会随共享或赠送转移。</small>
            </article>
          )}
        </aside>
        <div className="belong-main">
          <article className="belong-sheet belong-story">
            <span className="belong-kicker">02 / 我和它</span>
            <h3>有些物品，值得多说几句。</h3>
            <p>从哪里来，为什么喜欢，或者今天一起经历了什么。</p>
            <div className="belong-story-timeline">
              {related.slice(-4).map((f) => (
                <div key={f.id}>
                  <BookOpen size={16} />
                  <div>
                    <small>
                      {f.origin === "fiction"
                        ? "想象故事，非真实经历"
                        : "本人记录 · 私人故事"}
                      {f.capturedOn ? ` · ${f.capturedOn}` : ""}
                    </small>
                    <p>{f.text}</p>
                    {(f.mediaIds || []).map((id) => (
                      <img
                        key={id}
                        src={`/api/life/media/${id}?actor=${actor}`}
                        alt="这段故事的照片"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const d = await request("fragment", {
                    text: story,
                    itemIds: [item.id],
                    origin: "user-record",
                    allowRecall: recall,
                    allowCloud: cloud,
                    mediaIds: storyPhoto ? [storyPhoto.id] : [],
                    ...(storyRequest.current
                      ? {
                          id: storyRequest.current,
                          revision: savedStory?.revision,
                        }
                      : {}),
                  });
                  const f = d.fragment || d;
                  setSavedStory(f);
                  storyRequest.current = f.id;
                  setNotice(
                    "故事已保存。只有再确认下方记忆，才会用于普通帮助。",
                  );
                  await refresh();
                } catch (err) {
                  setNotice((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="sr-only" htmlFor="belong-story-text">
                我和它的故事
              </label>
              <textarea
                id="belong-story-text"
                placeholder="例如：这幅画是朋友小夏送的。搬家时，我特意把它带来了。"
                value={story}
                onChange={(e) => {
                  setStory(e.target.value);
                  setSavedStory(undefined);
                  storyRequest.current = undefined;
                }}
                required
                maxLength={1500}
              />
              <div className="belong-story-options">
                <label>
                  加一张照片
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setBusy(true);
                      try {
                        setStoryPhoto(await upload(f, "story-photo"));
                      } catch (err) {
                        setNotice((err as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                </label>
                {storyPhoto && (
                  <img
                    className="belong-photo-thumb"
                    src={storyPhoto.url}
                    alt="待保存的故事照片"
                  />
                )}
                <label className="belong-check">
                  <input
                    type="checkbox"
                    checked={recall}
                    onChange={(e) => setRecall(e.target.checked)}
                  />
                  允许在我主动回忆时引用
                </label>
                <label className="belong-check">
                  <input
                    type="checkbox"
                    checked={cloud}
                    onChange={(e) => setCloud(e.target.checked)}
                  />
                  允许云端模型使用这段故事
                </label>
              </div>
              <button disabled={busy} className="belong-primary">
                留下这一段
              </button>
            </form>
            {savedStory?.id && (
              <div className="belong-memory-consent">
                <p>
                  要让它也帮助以后的对话吗？只保存你刚写下的内容，不推断感情、日期或人物关系。确认后由下方记忆统一管理引用；原故事保留私密展示，纠正或遗忘不会让旧故事重新进入回答。
                </p>
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await memoryRequestAPI({
                        action: "rememberItemStory",
                        input: {
                          requestId: memoryRequest.current,
                          fragmentId: savedStory.id,
                          revision: savedStory.revision,
                          itemId: item.id,
                          allowCloud: cloud,
                        },
                      });
                      memoryRequest.current = crypto.randomUUID();
                      setSavedStory(undefined);
                      await refresh();
                      storyRequest.current = undefined;
                      setStory("");
                      setStoryPhoto(undefined);
                      setUseStories(true);
                      setNotice(
                        cloud
                          ? "已确认关系记忆；可在新会话中使用。"
                          : "已确认本地关系记忆；未授权云端，不会发送给模型。 ",
                      );
                    } catch (err) {
                      setNotice((err as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  确认保留为这件物品的关系记忆
                </button>
              </div>
            )}
          </article>
          <article className="belong-sheet belong-talk">
            <span className="belong-kicker">04 / 一起想想接下来</span>
            <h3>
              {voice && savedEnabled
                ? `和${persona.nickname || item.name}聊聊`
                : `让物间帮你用好${item.name}`}
            </h3>
            <p>问材质与限制，想想新房间的摆放，或聊聊它对你的意义。</p>
            <div className="belong-talk-options">
              {own && (
                <>
                  <label className="belong-check">
                    <input
                      type="checkbox"
                      checked={useStories}
                      onChange={(e) => {
                        setUseStories(e.target.checked);
                        setSessionKey((k) => k + 1);
                      }}
                    />
                    结合这件物品已获准的关系记忆
                  </label>
                  <label className="belong-check">
                    <input
                      type="checkbox"
                      checked={capture}
                      onChange={(e) => setCapture(e.target.checked)}
                    />
                    从自然交流中建议记忆，保存前由我确认
                  </label>
                  {savedEnabled && (
                    <label className="belong-check">
                      <input
                        type="checkbox"
                        checked={voice}
                        onChange={(e) => {
                          setVoice(e.target.checked);
                          setSessionKey((k) => k + 1);
                        }}
                      />
                      用数字分身的口吻交流
                    </label>
                  )}
                </>
              )}
            </div>
            <AssistantConversation
              key={`${actor}:${item.id}:${sessionKey}`}
              actor={actor}
              item={item}
              mode="auto"
              startFresh
              onSession={onSession}
              uiContext={{
                page: "item",
                companion: voice && savedEnabled,
                useItemMemories: own && useStories,
              }}
              memoryPolicy={capture ? "candidates" : "off"}
              onActivity={() => refresh().catch(() => {})}
            />
            <button onClick={onContinue}>在问物间继续</button>
            <MemoryCenter
              actor={actor}
              items={items}
              focusItemId={item.id}
              hidePersona
            />
          </article>
          <div role="status" className="belong-notice">
            {notice}
          </div>
        </div>
      </div>
    </div>
  );
}
