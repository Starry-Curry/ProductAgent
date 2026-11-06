"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageCircle,
  Package,
  Users,
  Camera,
  Settings,
  Plus,
  Search,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Mic,
  Volume2,
  Check,
  ChevronRight,
  X,
  Loader2,
  Trash2,
  Lock,
  Gift,
  ShoppingBag,
  Heart,
  Link2,
  Copy,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileText,
  Sparkles,
  MapPin,
  ClipboardList,
  Menu,
  BookOpen,
  ExternalLink,
  Pencil,
  Calendar,
  Sun,
} from "lucide-react";
import { usePublicDemo } from "../DemoBoundary";
import { itemPhoto } from "@/lib/life/item-photos";
import { referenceAppliance } from "@/lib/catalog/real-appliances";
import type { ServiceSession } from "@/lib/agent/contracts";
import type {
  AppData,
  Extras,
  API,
  Item,
  Person,
  Preferences,
  Wish,
  GiftNote,
  EventPlan,
  Fragment,
} from "./types";
import { names, initials } from "./types";
import { CompanionChat, VoiceButton, speak } from "./Chat";
import {
  Modal,
  ItemEditor,
  StoryEditor,
  WishEditor,
  GiftEditor,
  CompanionEditor,
} from "./Forms";
import { ItemInformation } from "../life/ItemInformation";
import { Discovery } from "../life/Discovery";
import { FriendsList } from "./FriendsList";
import { TaskDate } from "./TaskDate";
import { VisualGuide } from "./VisualGuide";
import { calendarToday, dueDateLabel } from "@/lib/companion/task-dates";

type View =
  "chat" | "items" | "family" | "plans" | "friends" | "stories" | "discover";
type Dialog = {
  steps?: { id: string; text: string }[];
  question?: string;
  kind: string;
  item?: Item;
  fragment?: Fragment;
  wish?: Wish;
  draft?: GiftNote;
  session?: ServiceSession | null;
};
const prefs: Preferences = {
  name: "阿圆",
  color: "original",
  accessory: "scarf",
  expression: "calm",
  style: "warm",
  onboarded: false,
  elder: false,
};
function date(s?: string | null) {
  return s
    ? new Date(s).toLocaleDateString("zh-CN", { month: "long", day: "numeric" })
    : "留下的一个瞬间";
}
const bad = (i: Item) =>
  ["broken", "loaned", "lost", "gifted", "consumed"].includes(
    i.availability || "",
  ) || /损坏|暂停|维修|用尽/.test(i.state);
const status = (i: Item) =>
  i.availability === "broken"
    ? "暂停使用"
    : i.availability === "unknown"
      ? "待确认"
      : i.state === "在用"
        ? "正常"
        : i.state;
function download(
  name: string,
  body: string,
  type = "text/plain;charset=utf-8",
) {
  const u = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}

export default function CompanionApp() {
  const publicMode = usePublicDemo();
  const [actor, setActor] = useState<Person>("lin"),
    [view, setView] = useState<View>("chat"),
    [data, setData] = useState<AppData | null>(null),
    [extra, setExtra] = useState<Extras>({
      friendships: [],
      preferences: prefs,
      wishes: [],
      giftNotes: [],
      plans: [],
      sharedItems: [],
      sharedStories: [],
      borrows: [],
    }),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [loading, setLoading] = useState(true),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [elder, setElder] = useState(false),
    [showAllReminders, setShowAllReminders] = useState(false),
    [mobileMenu, setMobileMenu] = useState(false),
    [ready, setReady] = useState(false);
  const [family, setFamily] = useState(true),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [room, setRoom] = useState("全部房间"),
    [selected, setSelected] = useState(""),
    [sessions, setSessions] = useState<ServiceSession[]>([]),
    [chat, setChat] = useState<{
      key: number;
      itemId?: string;
      question?: string;
      sessionId?: string;
      skipPlan?: boolean;
    }>({ key: 0 }),
    [activePlan, setActivePlan] = useState(""),
    [friend, setFriend] = useState<Person>("friend"),
    [socialTab, setSocialTab] = useState("想买的"),
    [selectedWish, setSelectedWish] = useState(""),
    [taskFilter, setTaskFilter] = useState("active"),
    [planGoal, setPlanGoal] = useState(""),
    [saving, setSaving] = useState(false);
  const epoch = useRef(0),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((s: string) => {
    setToast(s);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6500);
  }, []);
  const api: API = useCallback(
    async (path, body, method) => {
      const form = body instanceof FormData;
      const r = await fetch(path, {
        method: method || (body === undefined ? "GET" : "POST"),
        headers: {
          "x-demo-actor": actor,
          ...(form ? {} : { "Content-Type": "application/json" }),
        },
        body:
          body === undefined ? undefined : form ? body : JSON.stringify(body),
        cache: "no-store",
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "操作未完成，请重试");
      return d;
    },
    [actor],
  );
  const load = useCallback(async () => {
    const token = ++epoch.current;
    const [a, b] = await Promise.all([api("/api/life"), api("/api/companion")]);
    if (token !== epoch.current) return;
    setData(a);
    setExtra(b);
    setError("");
    const c = await api("/api/assistant?mode=auto&scope=all").catch(() => ({
      sessions: [],
    }));
    if (token === epoch.current)
      setSessions(
        (c.sessions || []).filter((s: ServiceSession) =>
          s.messages.some((m) => m.role === "user"),
        ),
      );
  }, [api]);
  useEffect(() => {
    try {
      const a = localStorage.getItem("wj-actor");
      if (!publicMode && (a === "lin" || a === "dad" || a === "friend"))
        setActor(a);
      setElder(localStorage.getItem("wj-mode") === "elder");
      const v = location.hash.slice(1).split("?")[0];
      if (
        [
          "chat",
          "items",
          "family",
          "plans",
          "friends",
          "stories",
          "discover",
        ].includes(v)
      )
        setView(v as View);
    } catch {}
    setReady(true);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    setLoading(true);
    setData(null);
    setChat((c) => ({ key: c.key + 1 }));
    setSelected("");
    setActivePlan("");
    setDialog(null);
    load()
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    const focus = () => load().catch(() => {});
    window.addEventListener("focus", focus);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load().catch(() => {});
    }, 15000);
    return () => {
      live = false;
      epoch.current++;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [ready, actor, load]);
  useEffect(() => {
    const h = () => {
      const v = location.hash.slice(1);
      if (
        [
          "chat",
          "items",
          "family",
          "plans",
          "friends",
          "stories",
          "discover",
        ].includes(v)
      )
        setView(v as View);
    };
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () => {
      const root = document.documentElement;
      if (window.innerWidth <= 720 && viewport.scale <= 1.05) {
        root.style.setProperty("--wj-visual-height", `${viewport.height}px`);
        root.classList.toggle(
          "wj-keyboard-open",
          viewport.height < window.innerHeight * 0.76,
        );
      } else {
        root.style.removeProperty("--wj-visual-height");
        root.classList.remove("wj-keyboard-open");
      }
    };
    resize();
    viewport.addEventListener("resize", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      document.documentElement.style.removeProperty("--wj-visual-height");
      document.documentElement.classList.remove("wj-keyboard-open");
    };
  }, []);
  const refresh = () => load().catch((e) => notify(e.message));
  useEffect(() => {
    if (
      !loading &&
      view === "friends" &&
      friend !== actor &&
      !extra.friendships?.some(
        (r) =>
          r.status === "accepted" &&
          (r.owner === friend || r.recipient === friend),
      )
    )
      setFriend(actor);
  }, [actor, extra.friendships, friend, loading, view]);
  function go(v: View) {
    setView(v);
    setMobileMenu(false);
    location.hash = v;
  }
  function ask(
    question = "",
    itemId?: string,
    sessionId?: string,
    skipPlan = false,
  ) {
    setChat((c) => ({ key: c.key + 1, question, itemId, sessionId, skipPlan }));
    go("chat");
  }
  async function run(fn: () => Promise<void>) {
    if (saving) return;
    setSaving(true);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function act(action: string, p: any, message = "已保存") {
    await api("/api/workspace", { action, ...p });
    await load();
    notify(message);
    return true;
  }
  async function extraAction(
    action: string,
    input: unknown,
    message = "已保存",
  ) {
    const result = await api("/api/companion", { action, input });
    await load();
    notify(message);
    return result;
  }
  const request = (action: string, input?: any) =>
    api("/api/life", { action, input });
  async function upload(file: File, kind: string) {
    const form = new FormData();
    form.set("file", file);
    form.set("kind", kind);
    return api("/api/life", form);
  }
  async function mode(next: boolean) {
    setElder(next);
    localStorage.setItem("wj-mode", next ? "elder" : "standard");
    go("chat");
    await api("/api/companion", {
      action: "preferences",
      input: { ...extra.preferences, elder: next },
    }).catch((e) => notify(e.message));
  }
  async function createPlan(goal: string) {
    if (!goal.trim() || saving) return;
    go("plans");
    setPlanGoal(goal);
    await run(async () => {
      const d = await extraAction("createPlan", { goal }, "准备清单已保存");
      setActivePlan(d.plan.id);
      setPlanGoal("");
      go("plans");
    });
  }
  async function patchPlan(p: EventPlan, changes: Partial<EventPlan>) {
    const { id, revision, title, people, items } = { ...p, ...changes };
    await run(async () => {
      await extraAction(
        "updatePlan",
        { id, revision, title, people, items },
        "清单已更新",
      );
    });
  }
  async function installDemo() {
    await run(async () => {
      await api("/api/life", { action: "demo", confirmed: true });
      await api("/api/companion", {
        action: "seed",
        input: { confirmed: true },
      });
      await load();
      notify("已载入合成示例，可以自由修改体验");
      setDialog(null);
    });
  }
  const items = (data?.workspace.items || []).filter((i) => !i.demo),
    current = items.find((i) => i.id === selected),
    chatItem = items.find((i) => i.id === chat.itemId),
    plan = extra.plans.find((p) => p.id === activePlan) || extra.plans[0],
    p = extra.preferences;
  const tasks = data?.workspace.tasks || [],
    activeTasks = tasks.filter((t) => t.status !== "用户确认完成"),
    ownTasks = activeTasks.filter((t) => t.assignee === actor),
    itemList = items
      .filter((i) => (family ? i.shared : i.owner === actor && !i.shared))
      .filter(
        (i) => !query || `${i.name} ${i.location} ${i.note}`.includes(query),
      )
      .filter((i) => room === "全部房间" || i.location === room)
      .filter(
        (i) =>
          filter === "all" ||
          (filter === "attention"
            ? bad(i)
            : filter === "out"
              ? ["lost", "gifted", "consumed"].includes(i.availability || "")
              : true),
      );
  const displayName = p.name || "阿圆";
  const picture = (i: Item) => itemPhoto(i, actor)?.src;
  const title: Record<View, string> = {
    chat: "和" + displayName + "聊聊",
    items: "物品",
    family: "一起照看这个家",
    plans: "准备去做一件事",
    friends: "朋友的生活",
    stories: "留下来的心意",
    discover: "已有物品的新可能",
  };
  const socialWishes = extra.wishes.filter((w) => w.owner === friend),
    wish = socialWishes.find((w) => w.id === selectedWish) || socialWishes[0];
  const showItem = (id: string) => {
    setSelected(id);
    go("items");
    const i = items.find((i) => i.id === id);
    if (i) setFamily(i.shared);
  };
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("已复制");
    } catch {
      notify("复制未完成，可以选择文字复制，或下载保存。");
    }
  }
  function taskButtons(t: (typeof tasks)[number]) {
    const own = t.assignee === actor;
    return (
      <div className="wj-task-actions">
        <button onClick={() => speak(t.title, notify)}>
          <Volume2 size={15} />
          听一遍
        </button>
        {own ? (
          t.kind === "notice" ? (
            <button
              disabled={t.acknowledged || saving}
              className="wj-small-primary"
              onClick={() =>
                run(async () => {
                  await act(
                    "ackTask",
                    { taskId: t.id },
                    "已确认收到，物品状态不变",
                  );
                })
              }
            >
              {t.acknowledged ? "已知晓" : "我知道了"}
            </button>
          ) : (
            <>
              <button
                className="wj-small-primary"
                disabled={saving || t.status === "用户确认完成"}
                onClick={() =>
                  run(async () => {
                    await act(
                      "task",
                      {
                        taskId: t.id,
                        status: "用户确认完成",
                        text: "用户确认完成",
                      },
                      "事项已完成，物品状态由所有者另行确认",
                    );
                  })
                }
              >
                {t.status === "用户确认完成"
                  ? "已完成"
                  : t.kind === "purchase"
                    ? "已经买好"
                    : "我已完成"}
              </button>
              {!elder && t.status === "待处理" && (
                <button
                  disabled={saving}
                  onClick={() =>
                    run(async () => {
                      await act(
                        "task",
                        { taskId: t.id, status: "进行中", text: "开始处理" },
                        "已开始处理",
                      );
                    })
                  }
                >
                  开始处理
                </button>
              )}
            </>
          )
        ) : (
          <small>
            {names[t.assignee]} · {t.status}
          </small>
        )}
      </div>
    );
  }
  const chatNode = (
    <CompanionChat
      key={actor + ":" + chat.key + ":" + elder}
      actor={actor}
      item={chatItem}
      inventory={items}
      initialQuestion={chat.question}
      initialSessionId={chat.sessionId}
      name={displayName}
      color={p.color}
      elder={elder}
      demonstration={!!data?.capabilities.demonstration}
      onVisual={(steps, question, itemId) =>
        setDialog({
          kind: "visual",
          item: items.find((i) => i.id === itemId) || chatItem,
          steps,
          question,
        })
      }
      skipPlan={chat.skipPlan || elder}
      onSession={(s) => {
        setSessions((rows) => [s, ...rows.filter((r) => r.id !== s.id)]);
      }}
      onChange={refresh}
      onItem={(id) => ask("", id)}
      onPhoto={() => setDialog({ kind: "add" })}
      onPlan={createPlan}
      onSupport={(s) =>
        setDialog({
          kind: "support",
          item: chatItem || items.find((i) => i.id === s?.itemId),
          session: s,
        })
      }
      notify={notify}
    />
  );
  if (loading || !data)
    return (
      <div className="wj-app">
        <div className="wj-start">
          <img src="/companion/ayuan.webp" alt="物伴" />
          <h1>物间</h1>
          <p>{error || "正在把生活里的东西整理好…"}</p>
          {error ? (
            <button
              className="wj-btn"
              onClick={() => {
                setLoading(true);
                load().finally(() => setLoading(false));
              }}
            >
              重新连接
            </button>
          ) : (
            <Loader2 className="spin" />
          )}
        </div>
      </div>
    );
  return (
    <div className={"wj-app " + (elder ? "wj-elder" : "")}>
      {!elder && (
        <>
          <button
            className="wj-mobile-menu"
            aria-label="展开导航"
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            <Menu />
          </button>
          <aside className={"wj-sidebar " + (mobileMenu ? "open" : "")}>
            <button className="wj-brand" onClick={() => ask()}>
              <span>
                物间<span className="wj-brand-dot">.</span>
              </span>
              <small>和生活里的东西好好相处</small>
            </button>
            <nav>
              {(
                [
                  ["chat", "物伴", MessageCircle],
                  ["items", "物品", Package],
                  ["friends", "朋友", Users],
                ] as const
              ).map(([v, t, Icon]) => (
                <button
                  key={v}
                  className={
                    view === v ||
                    (v === "items" &&
                      ["family", "plans", "stories"].includes(view))
                      ? "active"
                      : ""
                  }
                  onClick={() => go(v)}
                >
                  <Icon size={21} />
                  {t}
                  {v === "items" && activeTasks.length > 0 && (
                    <span className="wj-nav-dot" />
                  )}
                </button>
              ))}
            </nav>
            <div className="wj-sidebar-divider" />
            <div className="wj-side-section">
              <span>最近的对话</span>
              <button aria-label="开始新对话" onClick={() => ask()}>
                <Plus size={16} />
              </button>
            </div>
            <div className="wj-recent">
              {sessions.slice(0, 4).map((s) => (
                <button
                  key={s.id}
                  className={chat.sessionId === s.id ? "active" : ""}
                  onClick={() => ask("", s.itemId, s.id)}
                >
                  <MessageCircle size={15} />
                  <span>
                    {s.messages.find((m) => m.role === "user")?.text ||
                      "新的对话"}
                  </span>
                </button>
              ))}
              {!sessions.length && <p>你的问题，会被好好记住。</p>}
            </div>
            <div className="wj-side-links">
              <button
                className={view === "plans" ? "active" : ""}
                onClick={() => go("plans")}
              >
                <ClipboardList size={17} />
                活动准备
                {extra.plans.length > 0 && <small>{extra.plans.length}</small>}
              </button>
              <button
                className={view === "family" ? "active" : ""}
                onClick={() => go("family")}
              >
                <CheckCircle2 size={17} />
                家人交代的事
              </button>
              <button
                className={view === "discover" ? "active" : ""}
                onClick={() => go("discover")}
              >
                <Sparkles size={17} />
                发现新用法
              </button>
            </div>
            <div className="wj-side-footer">
              <button
                className="wj-profile"
                onClick={() => setDialog({ kind: "settings" })}
              >
                <span className={"wj-person " + actor}>{initials[actor]}</span>
                <span>
                  {names[actor]}
                  <small>我的生活空间</small>
                </span>
              </button>
              <button
                aria-label="设置"
                className="wj-icon-btn"
                onClick={() => setDialog({ kind: "settings" })}
              >
                <Settings size={19} />
              </button>
            </div>
          </aside>
        </>
      )}
      <main className="wj-main">
        <header className="wj-topbar">
          {elder ? (
            <button className="wj-brand-inline" onClick={() => ask()}>
              物间<span>.</span>
            </button>
          ) : (
            <div className="wj-breadcrumb">
              {view === "chat" && chatItem && (
                <button
                  className="wj-icon-btn"
                  aria-label="回到物品"
                  onClick={() => showItem(chatItem.id)}
                >
                  <ArrowLeft size={20} />
                </button>
              )}
              <h1>{elder ? "" : title[view]}</h1>
            </div>
          )}
          <div className="wj-top-actions">
            {!elder && (
              <span
                className={
                  "wj-ai-status " + (data.capabilities.model ? "online" : "")
                }
                title={data.capabilities.cloud.message}
              >
                <i />
                {data.capabilities.demonstration
                  ? "演示模式"
                  : data.capabilities.model
                    ? "AI 已配置"
                    : "本地资料模式"}
              </span>
            )}
            <select
              aria-label="界面版本"
              value={elder ? "elder" : "standard"}
              onChange={(e) => mode(e.target.value === "elder")}
            >
              <option value="standard">普通版</option>
              <option value="elder">大字版</option>
            </select>
            {!elder && (
              <button
                className="wj-btn secondary compact"
                onClick={() => setDialog({ kind: "add" })}
              >
                <Camera size={19} />
                拍一下
              </button>
            )}
            <button
              className="wj-companion-profile"
              aria-label="装扮物伴"
              onClick={() => setDialog({ kind: "companion" })}
            >
              <img
                src="/companion/ayuan.webp"
                className={p.color}
                alt={displayName}
              />
            </button>
          </div>
        </header>
        {elder ? (
          <div className="wj-elder-body">
            {chat.question ||
            chat.itemId ||
            chat.sessionId ||
            sessions.find((s) => s.id === chat.sessionId) ? (
              <>
                <button className="wj-link wj-elder-back" onClick={() => ask()}>
                  <ArrowLeft />
                  返回首页
                </button>
                {chatNode}
              </>
            ) : (
              <div className="wj-elder-grid">
                <section className="wj-elder-question">
                  <div className="wj-elder-greeting">
                    <img
                      className={p.color}
                      src="/companion/ayuan.webp"
                      alt={displayName}
                    />
                    <h2>有问题，直接问我。</h2>
                  </div>
                  <h2>问一问</h2>
                  <VoiceButton
                    large
                    className="wj-elder-voice"
                    notify={notify}
                    onText={(s) => ask(s)}
                  />
                  <button
                    className="wj-elder-camera"
                    onClick={() => setDialog({ kind: "add" })}
                  >
                    <Camera size={30} />
                    拍照问
                  </button>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      ask(String(f.get("question") || ""));
                    }}
                  >
                    <input
                      name="question"
                      required
                      placeholder="也可以在这里打字…"
                      aria-label="大字版问题"
                    />
                    <button className="wj-btn" type="submit">
                      问一问
                      <ArrowRight />
                    </button>
                  </form>
                  <label>
                    想问哪件东西？
                    <select
                      onChange={(e) => {
                        if (e.target.value) ask("", e.target.value);
                      }}
                      value=""
                    >
                      <option value="">选择一件物品</option>
                      {items.map((i) => (
                        <option value={i.id} key={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
                <section className="wj-elder-reminders">
                  <h2>家人提醒</h2>
                  {ownTasks.length ? (
                    ownTasks
                      .slice(0, showAllReminders ? ownTasks.length : 2)
                      .map((t) => (
                        <article className="wj-reminder" key={t.id}>
                          <div className="wj-reminder-title">
                            {t.itemId &&
                              items.find((i) => i.id === t.itemId) && (
                                <ItemImage
                                  item={items.find((i) => i.id === t.itemId)!}
                                  actor={actor}
                                />
                              )}
                            <div>
                              <h3>{t.title}</h3>
                              <p>
                                {t.kind === "notice"
                                  ? "请先留意这件事。"
                                  : t.status}
                              </p>
                              <small>
                                {t.createdBy ? names[t.createdBy] : "家人"}
                                交代的事
                              </small>
                            </div>
                          </div>
                          <TaskDate
                            task={t}
                            actor={actor}
                            api={api}
                            refresh={refresh}
                            notify={notify}
                            readOnly
                          />
                          {taskButtons(t)}
                        </article>
                      ))
                  ) : (
                    <div className="wj-empty">
                      <CheckCircle2 size={36} />
                      <h3>今天暂时没有新的提醒</h3>
                      <p>家人交代的事情，会出现在这里。</p>
                      <button className="wj-btn secondary" onClick={refresh}>
                        <RefreshCw size={18} />
                        刷新看看
                      </button>
                    </div>
                  )}
                  {ownTasks.length > 2 && (
                    <button
                      className="wj-btn secondary wj-full"
                      onClick={() => setShowAllReminders(!showAllReminders)}
                    >
                      {showAllReminders
                        ? "收起提醒"
                        : `还有 ${ownTasks.length - 2} 条提醒`}
                    </button>
                  )}
                  <button
                    className="wj-link"
                    onClick={() => setDialog({ kind: "settings" })}
                  >
                    切换体验成员 / 设置
                  </button>
                </section>
              </div>
            )}
          </div>
        ) : (
          <>
            {view === "chat" && (
              <div className="wj-chat-layout">
                <section className="wj-chat-main">{chatNode}</section>
                <aside className="wj-context-rail">
                  <div className="wj-section-title">
                    <h2>今天需要留意</h2>
                    <button
                      aria-label="查看全部家庭事项"
                      onClick={() => go("family")}
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                  {activeTasks.slice(0, 2).map((t) => (
                    <button
                      className="wj-context-card"
                      key={t.id}
                      onClick={() => go("family")}
                    >
                      {items.find((i) => i.id === t.itemId) && (
                        <ItemImage
                          item={items.find((i) => i.id === t.itemId)!}
                          actor={actor}
                        />
                      )}
                      <div>
                        <h3>{t.title}</h3>
                        <TaskDate
                          task={t}
                          actor={actor}
                          api={api}
                          refresh={refresh}
                          notify={notify}
                          readOnly
                        />
                        <p>
                          {names[t.assignee]} ·{" "}
                          {t.acknowledged ? "已知晓，仍待处理" : t.status}
                        </p>
                        <span>
                          查看
                          <ChevronRight size={14} />
                        </span>
                      </div>
                    </button>
                  ))}
                  {!activeTasks.length && (
                    <div className="wj-quiet-note">
                      <CheckCircle2 size={22} />
                      <p>
                        今天没有紧急的事，
                        <br />
                        慢慢来就好。
                      </p>
                      <button
                        className="wj-link"
                        onClick={() => setDialog({ kind: "task" })}
                      >
                        记一件待办
                      </button>
                    </div>
                  )}
                  {extra.plans[0] && (
                    <button
                      className="wj-context-card"
                      onClick={() => {
                        setActivePlan(extra.plans[0].id);
                        go("plans");
                      }}
                    >
                      <div className="wj-context-icon">
                        <Sun size={27} />
                      </div>
                      <div>
                        <h3>{extra.plans[0].title}</h3>
                        <p>
                          还有{" "}
                          {extra.plans[0].items.filter((i) => !i.done).length}{" "}
                          项待准备
                        </p>
                        <span>
                          继续准备
                          <ChevronRight size={14} />
                        </span>
                      </div>
                    </button>
                  )}
                  <div className="wj-rail-divider" />
                  <h2>最近用过</h2>
                  <div className="wj-recent-items">
                    {items.slice(0, 4).map((i) => (
                      <button key={i.id} onClick={() => showItem(i.id)}>
                        <ItemImage item={i} actor={actor} />
                        <span>{i.name}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    className="wj-rail-companion"
                    onClick={() => setDialog({ kind: "companion" })}
                  >
                    <img src="/companion/ayuan.webp" alt="" />
                    <div>
                      认识你的物伴<small>名字、表情和一点小个性</small>
                    </div>
                    <ChevronRight size={16} />
                  </button>
                </aside>
              </div>
            )}
            {view === "items" && (
              <div className={"wj-library " + (current ? "with-detail" : "")}>
                <section className="wj-library-main">
                  <div className="wj-library-toolbar">
                    <div className="wj-segment wj-ownership">
                      <button
                        className={family ? "active" : ""}
                        onClick={() => {
                          setFamily(true);
                          setSelected("");
                          setRoom("全部房间");
                          setFilter("all");
                        }}
                      >
                        家庭用品
                      </button>
                      <button
                        className={!family ? "active" : ""}
                        onClick={() => {
                          setFamily(false);
                          setSelected("");
                          setRoom("全部房间");
                          setFilter("all");
                        }}
                      >
                        我的物品
                      </button>
                    </div>
                    <button
                      className="wj-btn compact"
                      onClick={() => setDialog({ kind: "add" })}
                    >
                      <Plus size={17} />
                      记一件
                    </button>
                  </div>
                  <p className="wj-ownership-note">
                    {family ? (
                      <>
                        <Users size={15} />
                        大家一起用，一起照看。
                      </>
                    ) : (
                      <>
                        <Lock size={15} />
                        仅自己可见 · 可以单独分享故事
                      </>
                    )}
                  </p>
                  <div className="wj-search-row">
                    <label className="wj-search">
                      <Search size={18} />
                      <input
                        placeholder={family ? "找家里的东西" : "找自己的东西"}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        aria-label="搜索物品"
                      />
                    </label>
                    <select
                      value={room}
                      onChange={(e) => setRoom(e.target.value)}
                      aria-label="按房间筛选"
                    >
                      <option>全部房间</option>
                      {Array.from(
                        new Set(
                          items
                            .filter((i) => i.shared === family)
                            .map((i) => i.location),
                        ),
                      ).map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                  <div className="wj-filters">
                    <button
                      className={filter === "all" ? "active" : ""}
                      onClick={() => setFilter("all")}
                    >
                      全部{" "}
                      <span>
                        {
                          items.filter((i) =>
                            family ? i.shared : i.owner === actor && !i.shared,
                          ).length
                        }
                      </span>
                    </button>
                    <button
                      className={filter === "attention" ? "active" : ""}
                      onClick={() => setFilter("attention")}
                    >
                      需要处理{" "}
                      <span>
                        {
                          items.filter((i) => i.shared === family && bad(i))
                            .length
                        }
                      </span>
                    </button>
                    <button
                      className={filter === "out" ? "active" : ""}
                      onClick={() => setFilter("out")}
                    >
                      已离手
                    </button>
                    {!family && (
                      <button onClick={() => go("stories")}>
                        <BookOpen size={15} />
                        回忆
                      </button>
                    )}
                  </div>
                  <div className="wj-item-grid">
                    {itemList.map((i) => (
                      <button
                        key={i.id}
                        className={
                          "wj-item-card " +
                          (current?.id === i.id ? "selected" : "")
                        }
                        onClick={() => setSelected(i.id)}
                      >
                        <ItemImage item={i} actor={actor} />
                        <div className="wj-item-caption">
                          <h3>{i.name}</h3>
                          <div>
                            <span>
                              <MapPin size={13} />
                              {i.location}
                            </span>
                            <span
                              className={
                                "wj-status " + (bad(i) ? "warning" : "")
                              }
                            >
                              {status(i)}
                            </span>
                          </div>
                          {referenceAppliance(i) ? (
                            <small>
                              {i.brand} · {i.model}
                            </small>
                          ) : (
                            i.synthetic && <small>示例物品</small>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                  {!itemList.length && (
                    <div className="wj-empty">
                      <Package size={38} />
                      <h3>
                        {query ? "没有找到这件东西" : "这里等着你的第一件物品"}
                      </h3>
                      <p>照片和一个称呼，就可以记下来。</p>
                      <button
                        className="wj-btn"
                        onClick={() => setDialog({ kind: "add" })}
                      >
                        记一件
                      </button>
                    </div>
                  )}
                </section>
                <aside className="wj-item-detail">
                  {current ? (
                    <>
                      <div className="wj-detail-heading">
                        <span>{current.shared ? "家庭用品" : "我的物品"}</span>
                        <button
                          className="wj-icon-btn"
                          aria-label="关闭物品详情"
                          onClick={() => setSelected("")}
                        >
                          <X size={18} />
                        </button>
                      </div>
                      <ItemImage item={current} actor={actor} />
                      <div className="wj-detail-body">
                        <div className="wj-detail-name">
                          <h2>{current.name}</h2>
                          {current.owner === actor && (
                            <button
                              className="wj-icon-btn"
                              aria-label="编辑物品"
                              onClick={() =>
                                setDialog({ kind: "edit", item: current })
                              }
                            >
                              <Pencil size={17} />
                            </button>
                          )}
                        </div>
                        <p className="wj-muted">
                          <MapPin size={14} />
                          {current.location} · {status(current)}
                        </p>
                        {referenceAppliance(current) && (
                          <div className="wj-reference-info">
                            <strong>
                              {current.brand} · {current.model}
                            </strong>
                            <small>
                              {referenceAppliance(current)!.variant}
                            </small>
                            <p>
                              型号已记住，直接问怎么用。回答会结合这款产品的官方说明书。
                            </p>
                            <a
                              href={referenceAppliance(current)!.manualUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <FileText size={14} />
                              查看官方说明书 <ExternalLink size={13} />
                            </a>
                            <small>
                              资料核对：{referenceAppliance(current)!.checkedAt}
                            </small>
                          </div>
                        )}
                        {!current.shared && (
                          <small>
                            <Lock size={12} />
                            仅自己可见
                          </small>
                        )}
                        <button
                          className="wj-btn wj-full"
                          onClick={() => ask("", current.id)}
                        >
                          <MessageCircle size={18} />
                          问问怎么用
                        </button>
                        <div className="wj-question-chips">
                          {["怎么使用？", "怎么清洗？"].map((q) => (
                            <button
                              key={q}
                              onClick={() => ask(current.name + q, current.id)}
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                        <div className="wj-detail-actions">
                          <button
                            onClick={() =>
                              setDialog({ kind: "task", item: current })
                            }
                          >
                            <AlertCircle size={17} />
                            报告问题
                          </button>
                          <button
                            onClick={() =>
                              setDialog({ kind: "support", item: current })
                            }
                          >
                            <ExternalLink size={17} />
                            售后入口
                          </button>
                        </div>
                        {current.note && (
                          <blockquote>{current.note}</blockquote>
                        )}
                        <div className="wj-section-title">
                          <h3>它的经历</h3>
                          <button
                            className="wj-link"
                            onClick={() =>
                              setDialog({ kind: "story", item: current })
                            }
                          >
                            记一段
                            <Plus size={15} />
                          </button>
                        </div>
                        {data.fragments
                          .filter((f) => f.itemIds.includes(current.id))
                          .map((f) => (
                            <button
                              className="wj-memory-preview"
                              key={f.id}
                              onClick={() =>
                                setDialog({
                                  kind: "readStory",
                                  fragment: f,
                                  item: current,
                                })
                              }
                            >
                              <small>{date(f.capturedOn || f.createdAt)}</small>
                              <p>{f.text}</p>
                              <ChevronRight size={15} />
                            </button>
                          ))}
                        {!data.fragments.some((f) =>
                          f.itemIds.includes(current.id),
                        ) && (
                          <p className="wj-muted wj-small">
                            还没有记录。它的来历，也值得留下来。
                          </p>
                        )}
                        {current.owner === actor && (
                          <button
                            className="wj-detail-row"
                            onClick={() =>
                              run(async () => {
                                await extraAction(
                                  "shareItem",
                                  {
                                    itemId: current.id,
                                    shared: !extra.sharedItems.some(
                                      (s) =>
                                        s.itemId === current.id &&
                                        s.owner === actor,
                                    ),
                                  },
                                  "朋友可见范围已更新",
                                );
                              })
                            }
                          >
                            <Users size={17} />
                            {extra.sharedItems.some(
                              (s) =>
                                s.itemId === current.id && s.owner === actor,
                            )
                              ? "停止向朋友展示可借物品"
                              : "向朋友展示为可借物品"}
                            <ChevronRight size={16} />
                          </button>
                        )}
                        <button
                          className="wj-detail-row"
                          onClick={() =>
                            setDialog({ kind: "documents", item: current })
                          }
                        >
                          <FileText size={17} />
                          说明书与物品资料
                          <ChevronRight size={16} />
                        </button>
                        {current.owner === actor && (
                          <button
                            className="wj-detail-row"
                            onClick={() =>
                              setDialog({ kind: "removeItem", item: current })
                            }
                          >
                            <Package size={17} />
                            移出物品清单，保留回忆
                            <ChevronRight size={16} />
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="wj-library-aside">
                      <h2>
                        {family ? "一起照看这个家" : "有些东西，值得一直记得"}
                      </h2>
                      {family ? (
                        <>
                          <div className="wj-avatar-row">
                            <span className="wj-person lin">林</span>
                            <span className="wj-person dad">爸</span>
                            <small>家庭成员</small>
                          </div>
                          <h3>需要处理</h3>
                          {activeTasks.slice(0, 3).map((t) => (
                            <button
                              key={t.id}
                              className="wj-task-mini"
                              onClick={() => go("family")}
                            >
                              <ClipboardList size={17} />
                              <span>
                                {t.title}
                                <small>
                                  {names[t.assignee]} · {t.status}
                                </small>
                              </span>
                              <ChevronRight size={14} />
                            </button>
                          ))}
                          <button
                            className="wj-btn wj-full"
                            onClick={() => setDialog({ kind: "task" })}
                          >
                            <Plus size={17} />
                            记一件需要处理的事
                          </button>
                        </>
                      ) : (
                        <>
                          <img
                            className="wj-aside-mascot"
                            src="/companion/ayuan.webp"
                            alt=""
                          />
                          <p>
                            一份礼物、一张手写卡片，
                            <br />
                            甚至一块海边捡到的石头。
                            <br />
                            不需要型号，也值得被记住。
                          </p>
                          <button
                            className="wj-btn secondary"
                            onClick={() => go("stories")}
                          >
                            <BookOpen size={17} />
                            翻翻我的回忆
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </aside>
              </div>
            )}
            {view === "family" && (
              <div className="wj-page-pad">
                <div className="wj-page-heading">
                  <div>
                    <span className="wj-eyebrow">A LITTLE CARE, EVERY DAY</span>
                    <h2>家人交代的事</h2>
                    <p>坏了的、要清洗的、快用完的，一起照看。</p>
                  </div>
                  <button
                    className="wj-btn"
                    onClick={() => setDialog({ kind: "task" })}
                  >
                    <Plus size={18} />
                    记一件事
                  </button>
                </div>
                <div className="wj-filters">
                  {[
                    ["active", "待处理"],
                    ["mine", "交给我的"],
                    ["done", "已完成"],
                    ["all", "全部"],
                  ].map(([v, t]) => (
                    <button
                      key={v}
                      className={taskFilter === v ? "active" : ""}
                      onClick={() => setTaskFilter(v)}
                    >
                      {t}
                    </button>
                  ))}
                  <button onClick={refresh}>
                    <RefreshCw size={15} />
                    刷新
                  </button>
                </div>
                <div className="wj-task-grid">
                  {tasks
                    .filter(
                      (t) =>
                        taskFilter === "all" ||
                        (taskFilter === "done"
                          ? t.status === "用户确认完成"
                          : taskFilter === "mine"
                            ? t.assignee === actor &&
                              t.status !== "用户确认完成"
                            : t.status !== "用户确认完成"),
                    )
                    .map((t) => (
                      <article
                        className={
                          "wj-task-card " +
                          (t.kind === "notice" ? "notice" : "")
                        }
                        key={t.id}
                      >
                        <div className="wj-task-card-heading">
                          <span
                            className={"wj-task-kind " + (t.kind || "help")}
                          >
                            {
                              (
                                {
                                  repair: "维修",
                                  clean: "清洗",
                                  purchase: "补充购买",
                                  notice: "重要提醒",
                                  help: "家人帮忙",
                                } as Record<string, string>
                              )[t.kind || "help"]
                            }
                          </span>
                          <button
                            className="wj-icon-btn"
                            aria-label="移除事项"
                            onClick={() =>
                              setDialog({
                                kind: "removeTask",
                                item: { id: t.id } as Item,
                              })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <h3>{t.title}</h3>
                        <TaskDate
                          task={t}
                          actor={actor}
                          api={api}
                          refresh={refresh}
                          notify={notify}
                        />
                        {items.find((i) => i.id === t.itemId) && (
                          <button
                            className="wj-task-item"
                            onClick={() => showItem(t.itemId)}
                          >
                            <ItemImage
                              item={items.find((i) => i.id === t.itemId)!}
                              actor={actor}
                            />
                            <span>
                              {items.find((i) => i.id === t.itemId)?.name}
                            </span>
                            <ChevronRight size={15} />
                          </button>
                        )}
                        <p>
                          <span className={"wj-person mini " + t.assignee}>
                            {initials[t.assignee]}
                          </span>
                          {names[t.assignee]}负责 · {t.status}
                        </p>
                        {taskButtons(t)}
                        <details className="wj-task-log">
                          <summary>处理记录 · {t.logs.length}</summary>
                          {t.logs.map((l, n) => (
                            <p key={n}>
                              {names[l.by]}：{l.text}
                              <small>{date(l.at)}</small>
                            </p>
                          ))}
                        </details>
                      </article>
                    ))}
                </div>
                {!tasks.length && (
                  <div className="wj-empty">
                    <CheckCircle2 size={40} />
                    <h3>把家里的小事，放在心上</h3>
                    <p>一句“垃圾袋快用完了”，也可以成为一件清楚的待办。</p>
                    <button
                      className="wj-btn"
                      onClick={() => setDialog({ kind: "task" })}
                    >
                      记一件事
                    </button>
                  </div>
                )}
              </div>
            )}
            {view === "plans" && (
              <div className="wj-plans-layout">
                <section className="wj-plans-main">
                  <div className="wj-plan-compose">
                    <div className="wj-page-heading">
                      <div>
                        <span className="wj-eyebrow">LET'S MAKE IT HAPPEN</span>
                        <h2>从想去，到准备好。</h2>
                        <p>先用好家里已有的东西，再看看还缺什么。</p>
                      </div>
                      <Sun size={35} strokeWidth={1} />
                    </div>
                    <form
                      className="wj-plan-input"
                      onSubmit={(e) => {
                        e.preventDefault();
                        createPlan(planGoal);
                      }}
                    >
                      <textarea
                        value={planGoal}
                        rows={2}
                        onChange={(e) => setPlanGoal(e.target.value)}
                        placeholder="例如：周六四个人去公园野餐，帮我准备一下。"
                        aria-label="活动目标"
                      />
                      <button
                        className="wj-btn"
                        disabled={saving || !planGoal.trim()}
                      >
                        {saving ? (
                          <Loader2 className="spin" size={17} />
                        ) : (
                          <Plus size={17} />
                        )}
                        生成并保存清单
                      </button>
                    </form>
                    <div className="wj-quick-plans">
                      {[
                        "周六四个人去野餐",
                        "明天出去拍照",
                        "明天家里开 party，6 个人一起吃饭聊天",
                      ].map((s) => (
                        <button
                          key={s}
                          disabled={saving}
                          onClick={() => createPlan(s)}
                        >
                          {s}
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                    </div>
                    <p className="wj-muted wj-small">
                      AI
                      先按活动规划并检查，再核对家里已有的东西。你可以继续修改人数、分工和清单。
                    </p>
                    {saving && (
                      <div className="wj-plan-generating" role="status">
                        <Loader2 className="spin" size={24} />
                        <div>
                          <strong>正在为这次活动整理清单…</strong>
                          <p>理解活动 → 规划与复查 → 核对家里已有</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="wj-plan-history">
                    <div className="wj-section-title">
                      <h3>我的活动</h3>
                      <small>{extra.plans.length} 份准备清单</small>
                    </div>
                    {extra.plans.map((p) => (
                      <button
                        className={
                          "wj-plan-card " + (plan?.id === p.id ? "active" : "")
                        }
                        key={p.id}
                        onClick={() => setActivePlan(p.id)}
                      >
                        <span className="wj-plan-icon">
                          <ClipboardList size={25} />
                        </span>
                        <div>
                          <h3>{p.title}</h3>
                          <p>{p.goal}</p>
                          <small>
                            {p.people} 人 · 已准备{" "}
                            {p.items.filter((i) => i.done).length}/
                            {p.items.length}
                          </small>
                        </div>
                        <ChevronRight size={18} />
                      </button>
                    ))}
                    {!extra.plans.length && (
                      <div className="wj-empty">
                        <ClipboardList size={35} />
                        <h3>下一个小计划，从这里开始</h3>
                      </div>
                    )}
                  </div>
                </section>
                <aside className="wj-plan-detail">
                  {plan && !saving ? (
                    <>
                      <div className="wj-section-title">
                        <h2>{plan.title}</h2>
                        <button
                          className="wj-icon-btn"
                          aria-label="删除活动清单"
                          onClick={() =>
                            setDialog({
                              kind: "removePlan",
                              item: { id: plan.id } as Item,
                            })
                          }
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                      <p className="wj-muted">
                        {plan.people} 人参与 ·{" "}
                        {plan.scheduledDate
                          ? plan.scheduledDate.replace(/-/g, "/")
                          : date(plan.at)}
                      </p>
                      {plan.reviewNote && (
                        <p className="wj-plan-reviewed">{plan.reviewNote}</p>
                      )}
                      {!!plan.assumptions?.length && (
                        <p className="wj-muted">{plan.assumptions.join(" ")}</p>
                      )}
                      {plan.source === "assistant-plan" && (
                        <small>来自已确认的对话清单</small>
                      )}
                      <div className="wj-progress">
                        <span>
                          已准备 {plan.items.filter((i) => i.done).length} /{" "}
                          {plan.items.length}
                        </span>
                        <div>
                          <i
                            style={{
                              width:
                                (plan.items.length
                                  ? (plan.items.filter((i) => i.done).length /
                                      plan.items.length) *
                                    100
                                  : 0) + "%",
                            }}
                          />
                        </div>
                      </div>
                      {plan.warnings.map((w) => (
                        <p className="wj-plan-warning" key={w}>
                          <AlertCircle size={16} />
                          {w}
                        </p>
                      ))}
                      <div className="wj-checklist">
                        {plan.items.map((c) => {
                          const bound = items.find((i) => i.id === c.itemId),
                            invalid = bound && bad(bound);
                          return (
                            <div
                              className={
                                "wj-check-row " + (c.done ? "done" : "")
                              }
                              key={c.id}
                            >
                              <button
                                className={
                                  "wj-check " + (c.done ? "checked" : "")
                                }
                                disabled={saving || !!invalid}
                                aria-label={
                                  (c.done ? "取消完成" : "标记完成") + c.label
                                }
                                onClick={() =>
                                  patchPlan(plan, {
                                    items: plan.items.map((i) =>
                                      i.id === c.id
                                        ? { ...i, done: !i.done }
                                        : i,
                                    ),
                                  })
                                }
                              >
                                {c.done && <Check size={15} />}
                              </button>
                              {bound ? (
                                <ItemImage item={bound} actor={actor} />
                              ) : (
                                <div className="wj-check-placeholder">
                                  <ShoppingBag size={21} />
                                </div>
                              )}
                              <div>
                                <strong>
                                  {c.label}
                                  {c.priority === "optional" && (
                                    <em className="wj-optional">可选</em>
                                  )}
                                </strong>
                                {c.quantity && (
                                  <span className="wj-plan-quantity">
                                    建议：{c.quantity}
                                  </span>
                                )}
                                {c.reason && (
                                  <p className="wj-plan-reason">{c.reason}</p>
                                )}
                                <small>
                                  {invalid
                                    ? "物品状态已变，请重新准备"
                                    : c.group === "owned"
                                      ? `家里已记录${bound ? "：" + bound.name : "相关物品"}`
                                      : c.group === "borrow"
                                        ? "待确认借用"
                                        : "尚未记录，先确认家里有没有"}
                                </small>
                                <select
                                  aria-label={c.label + "负责人"}
                                  value={c.assignee}
                                  disabled={saving}
                                  onChange={(e) =>
                                    patchPlan(plan, {
                                      items: plan.items.map((i) =>
                                        i.id === c.id
                                          ? { ...i, assignee: e.target.value }
                                          : i,
                                      ),
                                    })
                                  }
                                >
                                  <option>我</option>
                                  <option>爸爸</option>
                                  <option>小雨</option>
                                  <option>同行的人</option>
                                </select>
                              </div>
                              <button
                                className="wj-icon-btn"
                                aria-label={"移除" + c.label}
                                disabled={saving}
                                onClick={() =>
                                  patchPlan(plan, {
                                    items: plan.items.filter(
                                      (i) => i.id !== c.id,
                                    ),
                                  })
                                }
                              >
                                <X size={14} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <form
                        className="wj-add-check"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = e.currentTarget;
                          const label = String(
                            new FormData(f).get("label") || "",
                          ).trim();
                          if (label)
                            patchPlan(plan, {
                              items: [
                                ...plan.items,
                                {
                                  id: crypto.randomUUID(),
                                  label,
                                  group: "missing",
                                  done: false,
                                  assignee: "我",
                                },
                              ],
                            }).then(() => f.reset());
                        }}
                      >
                        <input
                          name="label"
                          required
                          maxLength={120}
                          placeholder="再加一项…"
                          aria-label="添加清单事项"
                        />
                        <button
                          className="wj-icon-btn"
                          disabled={saving}
                          aria-label="添加清单事项"
                        >
                          <Plus size={18} />
                        </button>
                      </form>
                      <button
                        className="wj-btn secondary wj-full"
                        onClick={() =>
                          ask(
                            `我准备${plan.goal}。已有清单：${plan.items.map((c) => c.label + "（" + (c.group === "owned" ? "已有" : "待准备") + "）").join("、")}。请根据这些条件检查遗漏，别重复问已知信息。`,
                            undefined,
                            undefined,
                            true,
                          )
                        }
                      >
                        <Sparkles size={17} />让{displayName}再看看
                      </button>
                      <button
                        className="wj-link"
                        onClick={() =>
                          download(
                            plan.title + ".txt",
                            plan.goal +
                              "\n\n" +
                              plan.items
                                .map(
                                  (i) =>
                                    (i.done ? "☑ " : "☐ ") +
                                    i.label +
                                    " · " +
                                    i.assignee,
                                )
                                .join("\n"),
                          )
                        }
                      >
                        <Copy size={15} />
                        导出准备清单
                      </button>
                    </>
                  ) : (
                    <div className="wj-empty">
                      <img src="/companion/ayuan.webp" alt="" />
                      <p>
                        告诉我想做什么，
                        <br />
                        我帮你把准备工作理清楚。
                      </p>
                    </div>
                  )}
                </aside>
              </div>
            )}
            {view === "friends" && (
              <div className="wj-social-layout">
                <section className="wj-social-main">
                  <FriendsList
                    actor={actor}
                    links={extra.friendships || []}
                    selected={friend}
                    onSelect={(a) => {
                      setFriend(a);
                      setSelectedWish("");
                    }}
                    api={api}
                    refresh={refresh}
                    notify={notify}
                  />
                  <div className="wj-friend-heading">
                    <span className={"wj-person large " + friend}>
                      {initials[friend]}
                    </span>
                    <div>
                      <h2>
                        {friend === actor
                          ? "我的想买清单"
                          : names[friend] + "的生活"}
                      </h2>
                      <p>
                        {friend === "friend"
                          ? "喜欢读书，也喜欢生活里的小东西。"
                          : friend === "dad"
                            ? "把日子过好，东西慢慢用。"
                            : "记录喜欢的，留下值得记住的。"}
                      </p>
                    </div>
                    {friend === actor && (
                      <button
                        className="wj-btn compact"
                        onClick={() => setDialog({ kind: "wish" })}
                      >
                        <Plus size={17} />
                        记下想买的
                      </button>
                    )}
                  </div>
                  <div className="wj-segment wj-social-tabs">
                    {["想买的", "可借物品", "故事"].map((t) => (
                      <button
                        className={socialTab === t ? "active" : ""}
                        onClick={() => setSocialTab(t)}
                        key={t}
                      >
                        {t}
                        {t === "想买的" ? " " + socialWishes.length : ""}
                      </button>
                    ))}
                  </div>
                  <div className="wj-social-tools">
                    <button
                      className="wj-link"
                      onClick={() => setSocialTab("借用记录")}
                    >
                      借用记录
                    </button>
                    <button
                      className="wj-link"
                      onClick={() => setSocialTab("赠言草稿")}
                    >
                      我的赠言草稿
                      {extra.giftNotes.length
                        ? " · " + extra.giftNotes.length
                        : ""}
                    </button>
                  </div>
                  {socialTab === "想买的" && (
                    <>
                      <h3 className="wj-list-heading">
                        {friend === actor ? "最近想买" : "最近收藏的喜欢"}
                      </h3>
                      <div className="wj-wish-grid">
                        {socialWishes.map((w) => (
                          <button
                            key={w.id}
                            className={
                              "wj-wish-card " +
                              (wish?.id === w.id ? "selected" : "")
                            }
                            onClick={() => setSelectedWish(w.id)}
                          >
                            {w.photo ? (
                              <img
                                src={
                                  w.photo.startsWith("/api/life/media/")
                                    ? `/api/companion?wishPhoto=${w.id}&actor=${actor}`
                                    : w.photo
                                }
                                alt={w.name}
                              />
                            ) : (
                              <div className="wj-wish-placeholder">
                                <Gift size={32} />
                              </div>
                            )}
                            <div>
                              <h3>{w.name}</h3>
                              <p>{w.note || "喜欢，就先记下来。"}</p>
                              {!w.shared && (
                                <small>
                                  <Lock size={12} />
                                  仅自己可见
                                </small>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                      {!socialWishes.length && (
                        <div className="wj-empty">
                          <Heart size={37} />
                          <h3>
                            {friend === actor
                              ? "把喜欢的东西，先记在这里"
                              : "还没有公开的想买清单"}
                          </h3>
                          {friend === actor && (
                            <button
                              className="wj-btn"
                              onClick={() => setDialog({ kind: "wish" })}
                            >
                              添加想买的东西
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {socialTab === "赠言草稿" && (
                    <>
                      <p className="wj-muted">
                        这些是你留好的心意，仅自己可见。
                      </p>
                      {extra.giftNotes.map((n) => (
                        <article className="wj-note-card" key={n.id}>
                          <div className="wj-section-title">
                            <h3>
                              送给{names[n.recipient]} · {n.itemName}
                            </h3>
                            <button
                              className="wj-icon-btn"
                              aria-label="删除赠言草稿"
                              onClick={() =>
                                run(async () => {
                                  await extraAction(
                                    "deleteGiftNote",
                                    { id: n.id, revision: n.revision },
                                    "草稿已移除",
                                  );
                                })
                              }
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                          <p>{n.message}</p>
                          <small>{date(n.at)}</small>
                          <div className="wj-actions">
                            <button
                              className="wj-link"
                              onClick={() => {
                                const w = extra.wishes.find(
                                  (w) => w.id === n.wishId,
                                );
                                if (w)
                                  setDialog({
                                    kind: "gift",
                                    wish: w,
                                    draft: n,
                                  });
                                else
                                  notify(
                                    "这件想买的物品已不再公开，仍可保留你的赠言。",
                                  );
                              }}
                            >
                              继续编辑
                              <ChevronRight size={14} />
                            </button>
                            <button
                              className="wj-link"
                              onClick={() => copy(n.message)}
                            >
                              复制赠言
                            </button>
                          </div>
                        </article>
                      ))}
                      {!extra.giftNotes.length && (
                        <div className="wj-empty">
                          <Gift size={38} />
                          <h3>下一份心意，等你写下。</h3>
                        </div>
                      )}
                    </>
                  )}
                  {socialTab === "可借物品" && (
                    <>
                      <p className="wj-muted wj-small">
                        只展示对方主动公开的物品，不包含私人回忆。
                      </p>
                      <div className="wj-wish-grid">
                        {extra.sharedItems
                          .filter((s) => s.owner === friend)
                          .map((s) => (
                            <article className="wj-note-card" key={s.id}>
                              <Package size={30} />
                              <h3>{s.name}</h3>
                              <p>{s.note}</p>
                              {s.owner !== actor ? (
                                <button
                                  className="wj-btn secondary"
                                  disabled={saving}
                                  onClick={() =>
                                    run(async () => {
                                      await extraAction(
                                        "borrow",
                                        { shareId: s.id },
                                        "借用申请已记下，对方可以在借用记录中确认",
                                      );
                                      setSocialTab("借用记录");
                                    })
                                  }
                                >
                                  我想借用
                                  <ArrowRight size={15} />
                                </button>
                              ) : (
                                <button
                                  className="wj-link"
                                  onClick={() =>
                                    run(async () => {
                                      await extraAction(
                                        "shareItem",
                                        { itemId: s.itemId, shared: false },
                                        "已停止展示",
                                      );
                                    })
                                  }
                                >
                                  停止展示
                                </button>
                              )}
                            </article>
                          ))}
                      </div>
                      {!extra.sharedItems.some((s) => s.owner === friend) && (
                        <div className="wj-empty">
                          <Package size={35} />
                          <h3>暂时没有公开的可借物品</h3>
                          {friend === actor && (
                            <button
                              className="wj-btn secondary"
                              onClick={() => go("items")}
                            >
                              去物品页挑选
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {socialTab === "借用记录" && (
                    <>
                      <p className="wj-muted">
                        借出、归还，都有一个清楚的记录。
                      </p>
                      {extra.borrows.map((b) => (
                        <article className="wj-note-card" key={b.id}>
                          <h3>{b.itemName}</h3>
                          <p>
                            {names[b.owner]}向{names[b.recipient]}借用 ·{" "}
                            {
                              (
                                {
                                  requested: "等待确认",
                                  approved: "借用中",
                                  declined: "暂时不方便",
                                  return_requested: "等待确认归还",
                                  returned: "已归还",
                                } as Record<string, string>
                              )[b.status]
                            }
                          </p>
                          <div className="wj-actions">
                            {b.recipient === actor &&
                              b.status === "requested" && (
                                <>
                                  <button
                                    className="wj-btn"
                                    disabled={saving}
                                    onClick={() =>
                                      run(async () => {
                                        await extraAction(
                                          "borrowDecision",
                                          {
                                            id: b.id,
                                            revision: b.revision,
                                            decision: "approve",
                                          },
                                          "已同意，物品标记为借出",
                                        );
                                      })
                                    }
                                  >
                                    同意借用
                                  </button>
                                  <button
                                    className="wj-btn secondary"
                                    disabled={saving}
                                    onClick={() =>
                                      run(async () => {
                                        await extraAction(
                                          "borrowDecision",
                                          {
                                            id: b.id,
                                            revision: b.revision,
                                            decision: "decline",
                                          },
                                          "已记录",
                                        );
                                      })
                                    }
                                  >
                                    暂时不方便
                                  </button>
                                </>
                              )}
                            {b.owner === actor && b.status === "approved" && (
                              <button
                                className="wj-btn secondary"
                                disabled={saving}
                                onClick={() =>
                                  run(async () => {
                                    await extraAction(
                                      "borrowDecision",
                                      {
                                        id: b.id,
                                        revision: b.revision,
                                        decision: "requestReturn",
                                      },
                                      "归还申请已记下，等待所有者确认",
                                    );
                                  })
                                }
                              >
                                申请归还
                              </button>
                            )}
                            {b.recipient === actor &&
                              ["approved", "return_requested"].includes(
                                b.status,
                              ) && (
                                <button
                                  className="wj-btn"
                                  disabled={saving}
                                  onClick={() =>
                                    run(async () => {
                                      await extraAction(
                                        "borrowDecision",
                                        {
                                          id: b.id,
                                          revision: b.revision,
                                          decision: "confirmReturn",
                                        },
                                        "已确认归还，物品恢复可用",
                                      );
                                    })
                                  }
                                >
                                  确认已归还
                                </button>
                              )}
                          </div>
                        </article>
                      ))}
                      {!extra.borrows.length && (
                        <div className="wj-empty">
                          <Users size={35} />
                          <h3>还没有借用记录</h3>
                        </div>
                      )}
                    </>
                  )}
                  {socialTab === "故事" && (
                    <>
                      {extra.sharedStories
                        .filter((s) => s.owner === friend)
                        .map((s) => (
                          <article className="wj-note-card" key={s.id}>
                            <small>
                              {names[s.owner]} · {date(s.at)}
                            </small>
                            <p style={{ whiteSpace: "pre-wrap" }}>{s.text}</p>
                            <div className="wj-actions">
                              <button
                                className="wj-link"
                                onClick={() => speak(s.text, notify)}
                              >
                                <Volume2 size={15} />
                                听一遍
                              </button>
                              {s.owner === actor && (
                                <button
                                  className="wj-link"
                                  onClick={() =>
                                    run(async () => {
                                      await extraAction(
                                        "shareStory",
                                        {
                                          fragmentId: s.fragmentId,
                                          shared: false,
                                        },
                                        "已收回分享",
                                      );
                                    })
                                  }
                                >
                                  停止分享
                                </button>
                              )}
                            </div>
                          </article>
                        ))}
                      {!extra.sharedStories.some((s) => s.owner === friend) && (
                        <div className="wj-empty">
                          <BookOpen size={38} />
                          <h3>
                            {friend === actor
                              ? "自己的故事，由自己珍藏"
                              : "这里还没有公开的故事。"}
                          </h3>
                          <p>每段回忆，都由写下它的人决定是否分享。</p>
                          {friend === actor && (
                            <button
                              className="wj-btn secondary"
                              onClick={() => go("stories")}
                            >
                              翻看我的回忆
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </section>
                <aside className="wj-wish-detail">
                  {socialTab === "想买的" && wish ? (
                    <>
                      <div className="wj-wish-cover">
                        {wish.photo ? (
                          <img
                            src={
                              wish.photo.startsWith("/api/life/media/")
                                ? `/api/companion?wishPhoto=${wish.id}&actor=${actor}`
                                : wish.photo
                            }
                            alt={wish.name}
                          />
                        ) : (
                          <Gift size={60} />
                        )}
                      </div>
                      <h2>{wish.name}</h2>
                      <p className="wj-muted">
                        {names[wish.owner]}加入了想买清单
                      </p>
                      <blockquote>
                        {wish.note || "喜欢的东西，慢慢收集。"}
                      </blockquote>
                      {wish.url ? (
                        <a
                          className="wj-detail-row"
                          href={wish.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Link2 size={17} />
                          商品详情与购买链接
                          <ArrowUpRight size={17} />
                        </a>
                      ) : (
                        <p className="wj-small wj-muted">
                          还没附上具体商品链接，可以先按名称选购。
                        </p>
                      )}
                      {wish.owner === actor ? (
                        <div className="wj-actions">
                          <button
                            className="wj-btn"
                            onClick={() => setDialog({ kind: "wish", wish })}
                          >
                            <Pencil size={16} />
                            编辑
                          </button>
                          <button
                            className="wj-btn secondary"
                            disabled={saving}
                            onClick={() =>
                              setDialog({ kind: "removeWish", wish })
                            }
                          >
                            <Trash2 size={16} />
                            移除
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            className="wj-btn wj-full"
                            onClick={() => setDialog({ kind: "gift", wish })}
                          >
                            <Gift size={20} />
                            买来送{wish.owner === "dad" ? "他" : "她"}
                          </button>
                          <button
                            className="wj-ask-fit"
                            onClick={() =>
                              ask(
                                `我想送${names[wish.owner]}一份礼物，${names[wish.owner]}收藏了${wish.name}，原因是${wish.note}。帮我分析是否合适，哪些规格要核对。`,
                                undefined,
                                undefined,
                                true,
                              )
                            }
                          >
                            <img src="/companion/ayuan.webp" alt="" />
                            问问{displayName}，这件合适吗？
                            <ChevronRight size={15} />
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="wj-social-aside">
                      <img src="/companion/ayuan.webp" alt="" />
                      <h3>喜欢，是心意的线索。</h3>
                      <p>
                        朋友记下自己想买的东西，
                        <br />
                        你可以主动送一份惊喜。
                      </p>
                      <button
                        className="wj-link"
                        onClick={() => {
                          setFriend(actor);
                          setSocialTab("想买的");
                        }}
                      >
                        看看我的想买清单
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                </aside>
              </div>
            )}
            {view === "stories" && (
              <div className="wj-page-pad">
                <div className="wj-page-heading">
                  <div>
                    <span className="wj-eyebrow">THE THINGS WE KEEP</span>
                    <h2>东西有来处，心意有归处。</h2>
                    <p>实物不在了，照片、来历和当时的心情也可以留下。</p>
                  </div>
                  <button
                    className="wj-btn secondary"
                    onClick={() => {
                      setFamily(false);
                      go("items");
                    }}
                  >
                    从一件物品开始
                    <ArrowRight size={16} />
                  </button>
                </div>
                <div className="wj-story-grid">
                  {data.fragments.map((f) => (
                    <button
                      key={f.id}
                      className="wj-story-card"
                      onClick={() =>
                        setDialog({
                          kind: "readStory",
                          fragment: f,
                          item: items.find((i) => f.itemIds.includes(i.id)),
                        })
                      }
                    >
                      {f.mediaIds?.[0] ? (
                        <img
                          src={
                            "/api/life/media/" +
                            f.mediaIds[0] +
                            "?actor=" +
                            actor
                          }
                          alt="回忆照片"
                        />
                      ) : (
                        <div className="wj-story-symbol">“</div>
                      )}
                      <div>
                        <small>
                          {date(f.capturedOn || f.createdAt)}
                          {f.demo ? " · 示例故事" : ""}
                        </small>
                        <p>{f.text}</p>
                        <span>
                          {f.itemIds
                            .map((id) => items.find((i) => i.id === id)?.name)
                            .filter(Boolean)
                            .join(" · ") || "留给自己的回忆"}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                {!data.fragments.length && (
                  <div className="wj-empty">
                    <BookOpen size={38} />
                    <h3>你的第一段回忆，会从哪件东西开始？</h3>
                    <button
                      className="wj-btn"
                      onClick={() => {
                        setFamily(false);
                        go("items");
                      }}
                    >
                      去看看我的物品
                    </button>
                  </div>
                )}
              </div>
            )}
            {view === "discover" && (
              <div className="wj-page-pad wj-legacy">
                <div className="wj-page-heading">
                  <div>
                    <h2>让已有的东西，多一点可能。</h2>
                    <p>说说你的目标，让物伴结合真实库存找办法。</p>
                  </div>
                </div>
                <Discovery
                  items={items}
                  ideas={data.ideas}
                  request={request}
                  refresh={load}
                  modelAvailable={data.capabilities.model}
                  onAsk={(ctx) =>
                    ask(
                      `我想继续完善这个想法：${ctx?.continuation?.goal || "用已有的东西做点新鲜事"}。`,
                      undefined,
                      undefined,
                      true,
                    )
                  }
                />
              </div>
            )}
          </>
        )}
      </main>
      {!elder && (
        <nav className="wj-mobile-nav">
          {(
            [
              ["chat", "物伴", MessageCircle],
              ["items", "物品", Package],
              ["friends", "朋友", Users],
            ] as const
          ).map(([v, t, Icon]) => (
            <button
              key={v}
              className={view === v ? "active" : ""}
              onClick={() => go(v)}
            >
              <Icon size={21} />
              {t}
            </button>
          ))}
          <button onClick={() => setDialog({ kind: "settings" })}>
            <Settings size={21} />
            我的
          </button>
        </nav>
      )}
      {toast && (
        <div className="wj-toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button
            className="wj-icon-btn"
            aria-label="关闭提示"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {dialog && (
        <Modal
          title={
            (
              {
                add: "记下一件东西",
                edit: "更新这件物品",
                story: "记一段",
                readStory: "留下来的心意",
                wish: dialog.wish ? "编辑想买的" : "记下想买的",
                gift: "送一份心意",
                companion: "认识你的物伴",
                settings: "我的生活空间",
                task: "记一件需要处理的事",
                documents: "说明书与物品资料",
                support: "接着解决这个问题",
                visual: "看图跟着做 · 实时识别与视频",
                removeItem: "移出物品清单",
                removeWish: "移出想买清单",
                removeTask: "移除事项",
                removePlan: "删除活动清单",
              } as Record<string, string>
            )[dialog.kind] || "物间"
          }
          wide={["documents", "gift", "visual"].includes(dialog.kind)}
          onClose={() => setDialog(null)}
        >
          {dialog.kind === "visual" && (
            <VisualGuide
              item={dialog.item}
              actor={actor}
              steps={dialog.steps}
              question={dialog.question}
              api={api}
              notify={notify}
            />
          )}
          {["add", "edit"].includes(dialog.kind) && (
            <ItemEditor
              item={dialog.item}
              api={api}
              actor={actor}
              data={data}
              shared={family}
              onSaved={(i) => {
                setDialog(null);
                setFamily(i.shared);
                setSelected(i.id);
                go("items");
                refresh();
                notify("已经记下来，下一次可以接着问。");
              }}
              onAsk={(s) => {
                setDialog(null);
                ask(s);
              }}
            />
          )}
          {dialog.kind === "story" && (
            <StoryEditor
              api={api}
              item={dialog.item}
              fragment={dialog.fragment}
              onSaved={() => {
                setDialog(null);
                refresh();
                notify("这段心意，已经留下来了。");
              }}
            />
          )}
          {dialog.kind === "readStory" && dialog.fragment && (
            <div className="wj-read-story">
              <small>
                {date(dialog.fragment.capturedOn || dialog.fragment.createdAt)}
              </small>
              {dialog.fragment.mediaIds?.map((id) => (
                <img
                  key={id}
                  src={"/api/life/media/" + id + "?actor=" + actor}
                  alt="回忆照片"
                />
              ))}
              <p>{dialog.fragment.text}</p>
              <div className="wj-actions">
                <button
                  className="wj-btn secondary"
                  onClick={() => setDialog({ ...dialog, kind: "story" })}
                >
                  <Pencil size={16} />
                  修改这段回忆
                </button>
                <button
                  className="wj-link"
                  onClick={() => speak(dialog.fragment!.text, notify)}
                >
                  <Volume2 size={16} />
                  听一遍
                </button>
                <button
                  className="wj-link"
                  disabled={saving}
                  onClick={() =>
                    run(async () => {
                      await extraAction(
                        "shareStory",
                        {
                          fragmentId: dialog.fragment!.id,
                          shared: !extra.sharedStories.some(
                            (s) => s.fragmentId === dialog.fragment!.id,
                          ),
                        },
                        "故事分享范围已更新",
                      );
                    })
                  }
                >
                  {extra.sharedStories.some(
                    (s) => s.fragmentId === dialog.fragment!.id,
                  )
                    ? "收回故事分享"
                    : "把这段文字分享给朋友"}
                </button>
                <button
                  className="wj-link danger"
                  disabled={saving}
                  onClick={() =>
                    run(async () => {
                      await api("/api/life", {
                        action: "deleteFragment",
                        input: {
                          id: dialog.fragment!.id,
                          revision: dialog.fragment!.revision,
                        },
                      });
                      setDialog(null);
                      await load();
                      notify("回忆已删除");
                    })
                  }
                >
                  删除回忆
                </button>
              </div>
            </div>
          )}
          {dialog.kind === "wish" && (
            <WishEditor
              wish={dialog.wish}
              api={api}
              onSaved={() => {
                setDialog(null);
                setFriend(actor);
                setSocialTab("想买的");
                go("friends");
                refresh();
                notify("喜欢的东西，已经记下了。");
              }}
            />
          )}
          {dialog.kind === "gift" && dialog.wish && (
            <GiftEditor
              wish={dialog.wish}
              draft={dialog.draft}
              api={api}
              notify={notify}
              onSaved={() => {
                refresh();
              }}
            />
          )}
          {dialog.kind === "companion" && (
            <CompanionEditor
              preferences={p}
              api={api}
              onSaved={(value) => {
                setExtra({ ...extra, preferences: value });
                setDialog(null);
                notify("你好，" + value.name + "。");
              }}
            />
          )}
          {dialog.kind === "settings" && (
            <div className="wj-form">
              <div className="wj-settings-profile">
                <span className={"wj-person large " + actor}>
                  {initials[actor]}
                </span>
                <div>
                  <h3>{names[actor]}的生活空间</h3>
                  <p>东西慢慢用，日子慢慢过。</p>
                </div>
              </div>
              <button
                className="wj-detail-row"
                onClick={() => setDialog({ kind: "companion" })}
              >
                <img src="/companion/ayuan.webp" width={44} alt="" />
                装扮{displayName}
                <ChevronRight size={18} />
              </button>
              <label>
                显示方式
                <select
                  value={elder ? "elder" : "standard"}
                  onChange={(e) => mode(e.target.value === "elder")}
                >
                  <option value="standard">普通版</option>
                  <option value="elder">大字版</option>
                </select>
              </label>
              {!publicMode && (
                <label>
                  体验成员
                  <select
                    value={actor}
                    onChange={(e) => {
                      const a = e.target.value as Person;
                      localStorage.setItem("wj-actor", a);
                      setActor(a);
                    }}
                  >
                    <option value="lin">小林 · 家庭成员</option>
                    <option value="dad">爸爸 · 家庭成员</option>
                    <option value="friend">小雨 · 朋友</option>
                  </select>
                  <small>本机演示身份，用于体验不同成员的物品和提醒。</small>
                </label>
              )}
              <section className="wj-settings-ai">
                <h3>
                  <span
                    className={
                      "wj-ai-status " +
                      (data.capabilities.model ? "online" : "")
                    }
                  >
                    <i />
                    {data.capabilities.model
                      ? "真实 AI 已配置"
                      : "当前使用本地资料与规则"}
                  </span>
                </h3>
                <p>
                  {data.capabilities.model
                    ? "主动提问时使用服务端配置的模型，回答中会标注来源。"
                    : "已有资料仍可查看；开放问答需要在服务端启动真实 AI。"}
                </p>
                <button className="wj-link" onClick={refresh}>
                  <RefreshCw size={15} />
                  刷新连接状态
                </button>
              </section>
              <div className="wj-actions">
                <button
                  className="wj-btn secondary"
                  disabled={saving}
                  onClick={installDemo}
                >
                  载入示例物品与想买清单
                </button>
                <button
                  className="wj-btn secondary"
                  onClick={() =>
                    download(
                      "物间-我的数据.json",
                      JSON.stringify(
                        {
                          workspace: data.workspace,
                          fragments: data.fragments,
                          app: extra,
                        },
                        null,
                        2,
                      ),
                      "application/json",
                    )
                  }
                >
                  导出我的数据
                </button>
              </div>
              <small>
                示例内容为合成案例；记录保存在当前服务。语音取决于浏览器权限及系统支持。
              </small>
            </div>
          )}
          {dialog.kind === "documents" && dialog.item && (
            <div className="wj-legacy">
              <ItemInformation
                item={dialog.item}
                actor={actor}
                packs={data.packs}
                request={request}
                upload={upload}
                act={act}
                fragments={data.fragments}
                refresh={load}
              />
            </div>
          )}
          {dialog.kind === "task" && (
            <TaskEditor
              item={dialog.item}
              items={items}
              actor={actor}
              api={api}
              onSaved={() => {
                setDialog(null);
                refresh();
                notify("已记录，负责人可以在家人事项中查看。");
              }}
            />
          )}
          {dialog.kind === "support" && (
            <Support
              item={dialog.item}
              session={dialog.session}
              onTask={() => setDialog({ kind: "task", item: dialog.item })}
              copy={copy}
              onDocs={() => {
                if (dialog.item)
                  setDialog({ kind: "documents", item: dialog.item });
                else notify("先从物品页选择一件东西，就能补充售后资料。");
              }}
            />
          )}
          {dialog.kind.startsWith("remove") && (
            <div className="wj-form">
              <p>
                {dialog.kind === "removeItem"
                  ? "移出后不再出现在物品清单。你写下的私人回忆会保留。"
                  : dialog.kind === "removeTask"
                    ? "移除这件事项，不会改变关联物品的维修状态。"
                    : "确认移除这条记录？"}
              </p>
              <div className="wj-actions">
                <button
                  className="wj-btn danger"
                  disabled={saving}
                  onClick={() =>
                    run(async () => {
                      if (dialog.kind === "removeItem")
                        await extraAction(
                          "removeItem",
                          { itemId: dialog.item!.id },
                          "已移出清单，回忆保留",
                        );
                      if (dialog.kind === "removeTask")
                        await extraAction(
                          "removeTask",
                          { taskId: dialog.item!.id },
                          "事项已移除",
                        );
                      if (dialog.kind === "removeWish")
                        await extraAction(
                          "deleteWish",
                          {
                            id: dialog.wish!.id,
                            revision: dialog.wish!.revision,
                          },
                          "已移出想买清单",
                        );
                      if (dialog.kind === "removePlan") {
                        const pl = extra.plans.find(
                          (p) => p.id === dialog.item!.id,
                        );
                        if (pl)
                          await extraAction(
                            "deletePlan",
                            { id: pl.id, revision: pl.revision },
                            "活动已移除",
                          );
                      }
                      setDialog(null);
                      setSelected("");
                    })
                  }
                >
                  {saving ? "正在处理…" : "确认移除"}
                </button>
                <button
                  className="wj-btn secondary"
                  onClick={() => setDialog(null)}
                >
                  保留
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
function ItemImage({ item, actor }: { item: Item; actor: Person }) {
  const src = itemPhoto(item, actor)?.src;
  return src ? (
    <img
      src={src}
      alt={item.name}
      loading="lazy"
      className={
        referenceAppliance(item) && src.startsWith("/products/real-v1/")
          ? "wj-real-product-photo"
          : undefined
      }
    />
  ) : (
    <div className="wj-no-photo">
      <Package size={34} strokeWidth={1} />
      <span>{item.name}</span>
    </div>
  );
}
function TaskEditor({
  item,
  items,
  actor,
  api,
  onSaved,
}: {
  item?: Item;
  items: Item[];
  actor: Person;
  api: API;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(item ? item.name + "需要检查" : ""),
    [dueDate, setDueDate] = useState(calendarToday()),
    [kind, setKind] = useState(item ? "repair" : "purchase"),
    [assignee, setAssignee] = useState<Person>("dad"),
    [itemId, setItemId] = useState(item?.shared ? item.id : ""),
    [stop, setStop] = useState(!!item && item.owner === actor),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID());
  return (
    <form
      className="wj-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const selectedDueDate = String(
          new FormData(e.currentTarget).get("dueDate") || "",
        );
        setBusy(true);
        try {
          await api("/api/companion", {
            action: "reportTask",
            input: {
              requestId: requestId.current,
              title,
              kind,
              assignee,
              itemId,
              dueDate: selectedDueDate,
              stop: stop && kind === "repair" && !!itemId,
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
      <label>
        什么事情需要处理？
        <textarea
          required
          value={title}
          maxLength={120}
          rows={3}
          placeholder="例如：保温壶还没修好，先不要用。"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <div className="wj-form-columns">
        <label>
          事情类型
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="repair">维修检查</option>
            <option value="clean">清洗保养</option>
            <option value="purchase">补充购买</option>
            <option value="notice">重要提醒</option>
            <option value="help">请家人帮忙</option>
          </select>
        </label>
        <label>
          交给谁？
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value as Person)}
          >
            <option value="lin">小林</option>
            <option value="dad">爸爸</option>
          </select>
        </label>
      </div>
      <label>
        待办日期
        <input
          type="date"
          name="dueDate"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          onInput={(e) => setDueDate(e.currentTarget.value)}
        />
        <small>到这一天处理；留空表示暂不设日期。</small>
      </label>
      <label>
        关联的家庭物品（可不选）
        <select
          value={itemId}
          onChange={(e) => {
            setItemId(e.target.value);
            setStop(false);
          }}
        >
          <option value="">不关联物品</option>
          {items
            .filter((i) => i.shared)
            .map((i) => (
              <option value={i.id} key={i.id}>
                {i.name}
              </option>
            ))}
        </select>
      </label>
      {item && !item.shared && (
        <p className="wj-muted">
          这是私人物品，本次可记录为不关联物品的家庭事项。
        </p>
      )}
      {kind === "repair" &&
        items.some((i) => i.id === itemId && i.owner === actor) && (
          <label className="wj-checkbox">
            <input
              type="checkbox"
              checked={stop}
              onChange={(e) => setStop(e.target.checked)}
            />
            同时将这件物品标记为暂停使用
          </label>
        )}
      {error && <p className="wj-form-error">{error}</p>}
      <button
        className="wj-btn"
        disabled={busy || !title.trim() || actor === "friend"}
      >
        {busy ? "正在保存…" : "确认记录并交给家人"}
      </button>
      {actor === "friend" && (
        <p className="wj-muted">
          朋友身份不能分配家庭事项，请在设置中切换家庭成员。
        </p>
      )}
    </form>
  );
}
function Support({
  item,
  session,
  onTask,
  copy,
  onDocs,
}: {
  item?: Item;
  session?: ServiceSession | null;
  onTask: () => void;
  copy: (s: string) => void;
  onDocs: () => void;
}) {
  const user =
    session?.messages
      .filter((m) => m.role === "user")
      .map((m) => m.text)
      .join("\n") || "请补充具体故障现象。";
  const summary = `物品：${item?.name || "待确认"}\n型号：${item?.model || "待确认"}\n问题描述：${user}\n已尝试步骤：${
    session?.messages
      .flatMap((m) => m.reply?.steps || [])
      .filter((s) => session?.tried.includes(s.id))
      .map((s) => s.text)
      .join("；") || "暂无已确认的步骤记录"
  }\n处理结果：仍需进一步确认。`;
  return (
    <div className="wj-form">
      <p className="wj-muted">把问题、型号和已尝试的步骤带过去，少解释一遍。</p>
      <label>
        售后问题说明
        <textarea readOnly value={summary} rows={8} />
      </label>
      <div className="wj-actions">
        <button className="wj-btn" onClick={() => copy(summary)}>
          <Copy size={17} />
          复制问题说明
        </button>
        <button
          className="wj-btn secondary"
          onClick={() => download("物间-售后问题说明.txt", summary)}
        >
          下载说明
        </button>
      </div>
      {item?.supportUrl ? (
        <a
          className="wj-btn secondary"
          href={item.supportUrl}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={17} />
          打开已保存的售后入口
        </a>
      ) : (
        <button className="wj-detail-row" onClick={onDocs}>
          <Link2 size={17} />
          补充订单或售后链接
          <ChevronRight size={16} />
        </button>
      )}
      <button className="wj-btn secondary" onClick={onTask}>
        <Users size={17} />
        交给家人一起处理
      </button>
    </div>
  );
}
