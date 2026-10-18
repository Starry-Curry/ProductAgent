"use client";
import { HouseholdCases } from "@/components/HouseholdCases";
import { AssistantConversation } from "@/components/AssistantConversation";
import { MemoryCenter } from "@/components/MemoryCenter";
import { PersonalContext } from "@/components/PersonalContext";
import { EvidenceDiscovery } from "@/components/EvidenceDiscovery";
import { HelpEntry } from "@/components/HelpEntry";
import { ActivityPlanner } from "@/components/ActivityPlanner";
import { TaskList, TaskComposer } from "@/components/FamilyTasks";
import { SellerSupport } from "@/components/SellerSupport";
import { ItemService } from "@/components/ItemService";
import { useEffect, useState, useRef, type ReactNode } from "react";
import {
  ArrowUpRight,
  Plus,
  Search,
  House,
  Package,
  Sparkles,
  Users,
  Gift,
  ArrowLeft,
  Check,
  ChevronRight,
  LampDesk,
  Frame,
  Grid3X3,
  GlassWater,
  Droplets,
  Heart,
  ShieldCheck,
  Camera,
  Coffee,
  Wind,
  CookingPot,
  Brush,
  Library,
  Table2,
  ShoppingCart,
  Bookmark,
  Leaf,
  ChevronDown,
} from "lucide-react";
import {
  people,
  ideas,
  careMessage,
  type State,
  type Person,
  type Item,
} from "@/lib/domain";
type View =
  | "home"
  | "items"
  | "discover"
  | "family"
  | "gifts"
  | "item"
  | "plan"
  | "add"
  | "idea"
  | "compose"
  | "ask";
type Data = Omit<State, "care" | "saved"> & {
  care: State["care"] | null;
  saved: Partial<State["saved"]>;
};
const nav = [
  ["home", "使用帮助", House],
  ["plan", "活动准备", Package],
  ["family", "家庭事项", Users],
  ["discover", "发现", Sparkles],
  ["gifts", "礼物与记忆", Gift],
] as const;
function Icon({ item, size = 42 }: { item: Item; size?: number }) {
  const C =
    (
      {
        lamp: LampDesk,
        frame: Frame,
        beads: Grid3X3,
        cup: GlassWater,
        filter: Droplets,
        kettle: Coffee,
        purifier: Wind,
        fryer: CookingPot,
        vacuum: Brush,
        shelf: Library,
        table: Table2,
        trolley: ShoppingCart,
      } as Record<string, typeof Package>
    )[item.icon] || Package;
  return item.photo ? (
    <img className="item-photo" src={item.photo} alt={item.name} />
  ) : (
    <C size={size} strokeWidth={1.15} />
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export default function App() {
  const [elder, setElder] = useState(false);
  const [initialQuestion, setInitialQuestion] = useState("");
  const [unboundSession, setUnboundSession] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  useEffect(() => {
    setElder(localStorage.getItem("product-agent-mode") === "elder");
    const savedActor = localStorage.getItem("product-agent-actor");
    if (savedActor === "lin" || savedActor === "dad" || savedActor === "friend")
      setActor(savedActor);
  }, []);
  const visibleNav = elder
    ? ([
        ["home", "问一问", House],
        ["family", "家人交代的事", Users],
      ] as const)
    : nav;
  const [actor, setActor] = useState<Person>("lin");
  const [data, setData] = useState<Data | null>(null);
  const [view, setView] = useState<View>("home");
  const [selected, setSelected] = useState("");
  const [ideaId, setIdeaId] = useState("light");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("概览");
  const [answer, setAnswer] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [photo, setPhoto] = useState("");
  const [draft, setDraft] = useState("");
  const headers = { "Content-Type": "application/json", "x-demo-actor": actor };
  const mutationPending = useRef(false);
  const loadVersion = useRef(0);
  async function load() {
    if (mutationPending.current) return;
    const version = ++loadVersion.current;
    setError("");
    try {
      const r = await fetch("/api/workspace", { headers });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (version === loadVersion.current) setData(d);
    } catch (e) {
      if (version === loadVersion.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    setData(null);
    setUnboundSession(null);
    setSelected("");
    setView("home");
    setAnswer("");
    load();
  }, [actor]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") load();
    };
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener("workspace-updated", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("workspace-updated", refresh);
    };
  }, [actor]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  async function act(
    action: string,
    p: Record<string, unknown> = {},
    message = "已保存",
  ) {
    if (mutationPending.current) return false;
    mutationPending.current = true;
    ++loadVersion.current;
    setBusy(true);
    try {
      const r = await fetch("/api/workspace", {
        method: "POST",
        headers,
        body: JSON.stringify({ action, ...p }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setData(d);
      setToast(message);
      return true;
    } catch (e) {
      setToast((e as Error).message);
      return false;
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  }
  function go(v: View) {
    setView(v);
    setQuery("");
    setAnswer("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function open(i: Item) {
    setSelected(i.id);
    setTab("智能服务");
    setInitialQuestion("");
    go("item");
  }
  async function ask(itemId: string, question: string, mode = "service") {
    if (aiBusy) return;
    setAiBusy(true);
    setAnswer("");
    try {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers,
        body: JSON.stringify({ itemId, question, mode }),
      });
      const d = await r.json();
      setAnswer(
        r.ok
          ? `${d.source} · ${d.model}\n\n${d.answer}\n\n依据边界：${d.evidence}`
          : d.error,
      );
    } catch {
      setAnswer("网络连接失败，请稍后重试。");
    } finally {
      setAiBusy(false);
    }
  }
  function startHelp(itemId: string, question: string) {
    const chosen = data?.items.find((i) => i.id === itemId);
    if (chosen) {
      open(chosen);
      setInitialQuestion(question);
    } else {
      setDraft(question);
      go("ask");
    }
  }
  const item = data?.items.find((i) => i.id === selected);
  const active = nav.some((n) => n[0] === view)
    ? view
    : view === "idea"
      ? "discover"
      : view === "compose"
        ? "gifts"
        : view === "item"
          ? "home"
          : "home";
  const idea = ideas.find((i) => i.id === ideaId)!;
  const displayItems =
    data?.items.filter((i) =>
      `${i.name}${i.model}${i.location}`.includes(query),
    ) || [];
  function cards(items: Item[]) {
    return (
      <div className="item-grid">
        {items.map((i) => (
          <button key={i.id} className="item-card" onClick={() => open(i)}>
            <div className={`item-art ${i.icon}`}>
              <Icon item={i} />
              <span className="art-dot" />
            </div>
            <div className="item-meta">
              <div>
                <h3>{i.name}</h3>
                <p>
                  {i.location} <span>·</span> {i.category}
                </p>
              </div>
              <ChevronRight size={16} />
            </div>
            <div className="card-tags">
              <Badge>{i.state}</Badge>
              <span>{i.shared ? "家庭共享" : "个人物品"}</span>
            </div>
          </button>
        ))}
      </div>
    );
  }
  function title(
    eyebrow: string,
    text: string,
    sub: string,
    action?: ReactNode,
  ) {
    return (
      <div className="page-title">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1>{text}</h1>
          <p>{sub}</p>
        </div>
        {action}
      </div>
    );
  }
  function button(text: string, onClick: () => void, secondary = false) {
    return (
      <button
        disabled={busy}
        className={secondary ? "button secondary" : "button"}
        onClick={onClick}
      >
        {text}
      </button>
    );
  }
  return (
    <div className={`shell ${elder ? "elder" : "standard"}`}>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="物间首页">
          <span className="brand-mark">
            <Package size={23} />
          </span>
          <span>
            物间<small>PRODUCT AGENT</small>
          </span>
        </a>
        <div className="space">
          <span className="avatar">林</span>
          <div>
            日常生活空间<small>个人物品与家庭共享</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <nav>
          {visibleNav.map(([v, label, I]) => (
            <button
              key={v}
              className={active === v ? "active" : ""}
              onClick={() => go(v)}
            >
              <I size={20} />
              <span>{label}</span>
              {v === "discover" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        {!elder && (
          <button
            className="text-button secondary-items"
            onClick={() => go("items")}
          >
            <Package size={18} /> 我的物品
          </button>
        )}
        <div className="side-note">
          <Leaf size={20} />
          <p>
            好好使用，
            <br />
            也是一种新的发现。
          </p>
          <small>让已有之物，创造更多可能</small>
        </div>
        <div className="demo-switch">
          <label htmlFor="actor">演示角色 · 非真实账号</label>
          <select
            disabled={busy}
            id="actor"
            value={actor}
            onChange={(e) => {
              setActor(e.target.value as Person);
              localStorage.setItem("product-agent-actor", e.target.value);
            }}
          >
            {Object.entries(people).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
                {id === "friend" ? " · 收礼人" : " · 家庭成员"}
              </option>
            ))}
          </select>
        </div>
      </aside>
      <div className="body">
        <header className="topbar">
          <span className="breadcrumb">
            我的生活 <ChevronRight size={13} />{" "}
            {nav.find((n) => n[0] === active)?.[1]}
          </span>
          <label className="mode-switch">
            版本
            <select
              aria-label="界面版本"
              value={elder ? "elder" : "standard"}
              onChange={(e) => {
                const enabled = e.target.value === "elder";
                setElder(enabled);
                localStorage.setItem(
                  "product-agent-mode",
                  enabled ? "elder" : "standard",
                );
                go("home");
              }}
            >
              <option value="standard">标准版</option>
              <option value="elder">长辈版</option>
            </select>
          </label>
        </header>
        <main>
          {error ? (
            <div className="empty">
              <h2>暂时无法读取物品空间</h2>
              <p>{error}</p>
              {button("重试", load)}
            </div>
          ) : !data ? (
            <div className="empty">正在打开你的物品空间…</div>
          ) : (
            <>
              {view === "home" && (
                <>
                  {elder &&
                    data.tasks.some(
                      (t) =>
                        t.assignee === actor &&
                        t.kind === "notice" &&
                        t.status !== "用户确认完成",
                    ) && (
                      <section className="panel elder-alerts">
                        <h2>先看一眼家人的提醒</h2>
                        <TaskList
                          tasks={data.tasks.filter((t) => t.kind === "notice")}
                          actor={actor}
                          act={act}
                          elder
                        />
                      </section>
                    )}
                  <HelpEntry
                    items={data.items}
                    onAsk={startHelp}
                    elder={elder}
                  />
                  {(data.contexts || []).some(
                    (c) => c.owner === actor && c.status === "explicit",
                  ) && (
                    <PersonalContext
                      actor={actor}
                      facts={data.contexts || []}
                      act={act}
                    />
                  )}
                  {!elder && (
                    <details className="panel usage-map">
                      <summary>第一次使用？先看这几个入口</summary>
                      <p>
                        使用帮助解决具体问题；活动准备核对现有物品；家庭事项接力处理；发现提供资料核对与灵感候选；礼物与记忆留下人与物的故事。
                      </p>
                      <ol>
                        <li>
                          在上方填入“分步帮助”示例并发送，尝试一步后反馈结果。
                        </li>
                        <li>
                          平时正常表达喜好、记录自己新添的物品，不必填写记忆表。
                        </li>
                        <li>
                          在下方“记忆与陪伴”查看来源、纠正或忘记；想聊天时再开启陪伴。
                        </li>
                      </ol>
                      <p>
                        AI
                        一般帮助、官方资料指导、本地记忆会分别标明来源。演示角色和示例物品用于体验。
                      </p>
                      <p>
                        <a href="/guide" target="_blank" rel="noreferrer">
                          打开完整功能与操作指南 ↗
                        </a>
                      </p>
                    </details>
                  )}
                  {!elder && (
                    <HouseholdCases
                      items={data.items}
                      onOpen={(i, t) => {
                        open(i);
                        setTab(t);
                      }}
                    />
                  )}
                  <MemoryCenter
                    key={actor + (elder ? "elder" : "standard")}
                    actor={actor}
                    items={data.items}
                  />
                  {elder ? (
                    <section className="panel elder-inbox">
                      <h2>{people[actor]}，家人交代的事</h2>
                      <TaskList
                        tasks={data.tasks.filter((t) => t.kind !== "notice")}
                        actor={actor}
                        act={act}
                        elder
                      />
                    </section>
                  ) : (
                    <>
                      <div className="primary-actions">
                        <button onClick={() => go("plan")}>
                          <Package size={24} />
                          <div>
                            <h2>准备一次活动</h2>
                            <p>野餐、出游，看看要带什么</p>
                          </div>
                          <ChevronRight size={18} />
                        </button>
                        <button onClick={() => go("family")}>
                          <Users size={24} />
                          <div>
                            <h2>家里有件事</h2>
                            <p>记下维修、清洗或采购，交给家人</p>
                          </div>
                          <ChevronRight size={18} />
                        </button>
                      </div>
                      <div className="section-head">
                        <h2>点一件物品，获得帮助</h2>
                        <div className="inline">
                          <button
                            className="text-button"
                            onClick={() => go("items")}
                          >
                            查看全部
                          </button>
                          <button
                            className="text-button"
                            onClick={() => go("add")}
                          >
                            添加物品
                          </button>
                        </div>
                      </div>
                      {cards(data.items.slice(0, 4))}
                      {data.tasks.some(
                        (t) =>
                          t.assignee === actor && t.status !== "用户确认完成",
                      ) && (
                        <section className="panel">
                          <h2>等我处理</h2>
                          <TaskList
                            tasks={data.tasks
                              .filter((t) => t.assignee === actor)
                              .slice(0, 3)}
                            actor={actor}
                            act={act}
                            elder
                          />
                        </section>
                      )}
                      <div className="quiet-actions">
                        <button onClick={() => go("discover")}>
                          <Sparkles size={18} /> 发现物品新用法{" "}
                          <ArrowUpRight size={16} />
                        </button>
                        <button onClick={() => go("gifts")}>
                          <Heart size={18} /> 给朋友一点心意{" "}
                          <ArrowUpRight size={16} />
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
              {view === "items" && (
                <>
                  {title(
                    "YOUR EVERYDAY OBJECTS",
                    "我的物品",
                    "不必盘点所有东西，从值得关注的一件开始。",
                    button("＋ 添加物品", () => go("add")),
                  )}
                  <label className="search">
                    <Search size={18} />
                    <input
                      placeholder="搜索名称、型号或位置"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  {cards(displayItems)}
                  {!displayItems.length && (
                    <div className="empty">
                      没有匹配物品，可以添加一件自己的物品。
                    </div>
                  )}
                </>
              )}
              {view === "add" && (
                <>
                  {title(
                    "START WITH ONE OBJECT",
                    "留住一件物品",
                    "任何渠道、旧物或自制作品，都可以拥有自己的档案。",
                  )}
                  <form
                    className="panel form-panel"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      if (
                        await act(
                          "createItem",
                          {
                            name: f.get("name"),
                            model: f.get("model"),
                            location: f.get("location"),
                            category: f.get("category"),
                            note: f.get("note"),
                            photo,
                          },
                          "物品已保存，可以继续使用服务",
                        )
                      ) {
                        setPhoto("");
                        go("items");
                      }
                    }}
                  >
                    <label className="upload">
                      {photo ? (
                        <img src={photo} alt="待录入照片" />
                      ) : (
                        <>
                          <Camera size={30} />
                          <strong>添加实物照片</strong>
                          <span>上传用于档案展示；当前未接入视觉识别</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          if (f.size > 1000000) {
                            setToast("首轮照片请小于 1MB");
                            return;
                          }
                          const r = new FileReader();
                          r.onload = () => setPhoto(String(r.result));
                          r.readAsDataURL(f);
                        }}
                      />
                    </label>
                    <div>
                      <label>
                        物品名称 *
                        <input
                          name="name"
                          required
                          maxLength={80}
                          placeholder="例如：陪我读书的小台灯"
                        />
                      </label>
                      <details className="optional-fields">
                        <summary>补充照片之外的信息（可选）</summary>
                        <div className="form-grid">
                          <label>
                            品牌 / 型号
                            <input
                              name="model"
                              placeholder="不知道可以先留空"
                            />
                          </label>
                          <label>
                            放在哪里
                            <input name="location" placeholder="例如：书房" />
                          </label>
                          <label>
                            分类
                            <select name="category">
                              <option>日常家居</option>
                              <option>家用电器</option>
                              <option>手工与收藏</option>
                              <option>出行用品</option>
                              <option>其他</option>
                            </select>
                          </label>
                        </div>
                        <label>
                          补充说明
                          <textarea
                            name="note"
                            placeholder="谁在使用、有什么需要记住的事…"
                          />
                        </label>
                      </details>
                    </div>
                    <p className="notice">
                      <ShieldCheck size={16} />{" "}
                      当前保存到所选演示身份；真实账号与跨设备同步尚未接入。
                    </p>
                    <button className="button" disabled={busy}>
                      保存到我的物品
                    </button>
                  </form>
                </>
              )}
              {view === "item" && item && (
                <>
                  <button
                    className="back"
                    onClick={() => go(elder ? "home" : "items")}
                  >
                    <ArrowLeft size={16} /> {elder ? "返回问一问" : "我的物品"}
                  </button>
                  <div className="item-detail-head">
                    <div className={`item-art ${item.icon}`}>
                      <Icon item={item} size={65} />
                    </div>
                    <div>
                      <Badge>{item.source}</Badge>
                      <h1>{item.name}</h1>
                      <p>
                        {item.model} · {item.location}
                      </p>
                      <div className="inline">
                        <Badge tone="green">{item.state}</Badge>
                        <span>
                          {people[item.owner]}拥有 ·{" "}
                          {item.shared ? "家庭共享" : "个人空间"}
                        </span>
                      </div>
                    </div>
                  </div>
                  {item.demo && (
                    <section className="demo-notice">
                      <strong>演示案例：{item.demo.title}</strong>
                      <p>
                        商品资料有官方来源；故事和记忆为合成内容，不表示实际持有、使用或已完成检查。本案例中的对话仅影响该演示物品。
                      </p>
                    </section>
                  )}
                  <div className="tabs">
                    {(elder
                      ? ["智能服务"]
                      : ["智能服务", "概览", "故事与记录"]
                    ).map((t) => (
                      <button
                        className={tab === t ? "selected" : ""}
                        key={t}
                        onClick={() => setTab(t)}
                      >
                        {t === "智能服务"
                          ? "使用帮助"
                          : t === "概览"
                            ? "物品资料"
                            : t}
                      </button>
                    ))}
                  </div>
                  {tab === "概览" && (
                    <div className="detail-grid">
                      <section className="panel">
                        <h2>关于这件物品</h2>
                        <p>{item.note || "还没有补充说明。"}</p>
                        <dl>
                          <dt>所有者</dt>
                          <dd>{people[item.owner]}</dd>
                          <dt>当前状态</dt>
                          <dd>{item.state}</dd>
                          <dt>数据来源</dt>
                          <dd>{item.source}</dd>
                        </dl>
                        {item.owner === actor && (
                          <details>
                            <summary>修改物品资料</summary>
                            <form
                              onSubmit={async (e) => {
                                e.preventDefault();
                                const f = new FormData(e.currentTarget);
                                await act("updateItem", {
                                  itemId: item.id,
                                  name: f.get("name"),
                                  model: f.get("model"),
                                  location: f.get("location"),
                                  state: f.get("state"),
                                  note: f.get("note"),
                                });
                              }}
                              key={item.id}
                            >
                              <label>
                                名称
                                <input
                                  name="name"
                                  defaultValue={item.name}
                                  required
                                />
                              </label>
                              <label>
                                型号
                                <input name="model" defaultValue={item.model} />
                              </label>
                              <div className="form-grid">
                                <label>
                                  位置
                                  <input
                                    name="location"
                                    defaultValue={item.location}
                                  />
                                </label>
                                <label>
                                  状态
                                  <select
                                    name="state"
                                    defaultValue={item.state}
                                  >
                                    <option>在用</option>
                                    <option>闲置</option>
                                    <option>待确认</option>
                                    <option>已用完</option>
                                    <option>归档</option>
                                  </select>
                                </label>
                              </div>
                              <label>
                                备注
                                <textarea
                                  name="note"
                                  defaultValue={item.note}
                                />
                              </label>
                              <button
                                className="button secondary"
                                disabled={busy}
                              >
                                保存修改
                              </button>
                            </form>
                          </details>
                        )}
                      </section>
                      <div className="stack">
                        <section className="panel">
                          <h2>让它继续发挥价值</h2>
                          <div className="stack">
                            {button("获得使用帮助", () => setTab("智能服务"))}
                            {button(
                              "看看它的新用法",
                              () => go("discover"),
                              true,
                            )}
                            {item.owner === actor &&
                              button("制作数字礼物", () => go("compose"), true)}
                          </div>
                        </section>
                        <section className="panel">
                          <h2>共享与照料</h2>
                          <p>共享必要的物品资料，不共享私人故事。</p>
                          {item.owner === actor &&
                            button(
                              item.shared ? "停止共享给家庭" : "共享给家庭",
                              () =>
                                act("updateItem", {
                                  itemId: item.id,
                                  shared: !item.shared,
                                }),
                              true,
                            )}
                          {item.maintenance && (
                            <p>
                              上次维护：{item.maintenance}
                              <br />
                              演示周期：{item.cycle} 天
                            </p>
                          )}
                        </section>
                      </div>
                    </div>
                  )}
                  {tab === "智能服务" && (
                    <div className="help-detail-layout">
                      {data.tasks
                        .filter(
                          (t) =>
                            t.itemId === item.id &&
                            t.kind === "notice" &&
                            t.status !== "用户确认完成",
                        )
                        .map((t) => (
                          <div
                            role="note"
                            className="important-task simple-task"
                            key={t.id}
                          >
                            <strong>家人提醒：{t.title}</strong>
                          </div>
                        ))}
                      <ItemService
                        key={
                          actor +
                          item.id +
                          (item.productBinding?.confirmedAt || "")
                        }
                        item={item}
                        actor={actor}
                        elder={elder}
                        initialQuestion={initialQuestion}
                        act={act}
                        bind={(packId) =>
                          act(
                            "bindProduct",
                            { itemId: item.id, packId, confirmed: true },
                            "已确认型号并关联资料",
                          )
                        }
                      />
                      {!elder && (
                        <details className="panel">
                          <summary>坏了 / 要清洗 / 请家人帮忙</summary>
                          {item.shared ? (
                            <TaskComposer
                              items={data.items}
                              actor={actor}
                              act={act}
                              initialItem={item.id}
                              initialTitle={"处理：" + item.name}
                            />
                          ) : (
                            <>
                              <p>
                                这件物品尚未共享，可以先在物品对话中说明遇到的情况。
                              </p>
                              <button
                                className="button secondary"
                                onClick={() => setTab("故事与记录")}
                              >
                                去物品对话说明情况
                              </button>
                              <p>如需分配给家人，可在物品资料中主动共享。</p>
                            </>
                          )}
                        </details>
                      )}
                    </div>
                  )}
                  {tab === "故事与记录" && (
                    <section className="panel">
                      <h2>物品的经历，生活的片段</h2>
                      <p>
                        把这件物品与你、家人的经历讲给它听。这里是理解人与物关系的主要窗口；不用填写喜好档案。原始故事默认私人，送礼时仍由你选择要传递的部分。
                      </p>
                      <AssistantConversation
                        key={actor + item.id + "story"}
                        actor={actor}
                        item={item}
                        mode="story"
                        onActivity={load}
                      />
                      {data.memories
                        .filter((m) => m.itemId === item.id)
                        .map((m) => (
                          <article className="timeline" key={m.id}>
                            <span className="timeline-dot" />
                            <small>
                              {m.at.slice(0, 10)} ·{" "}
                              {m.author ? people[m.author] : "原作者未知"} ·{" "}
                              {m.demo
                                ? "合成案例故事"
                                : m.shared
                                  ? "共享记录"
                                  : "私人记忆"}
                            </small>
                            <p>{m.text}</p>
                          </article>
                        ))}
                      <MemoryCenter
                        actor={actor}
                        items={data.items}
                        focusItemId={item.id}
                      />
                    </section>
                  )}
                </>
              )}
              {view === "discover" && (
                <>
                  <EvidenceDiscovery key={actor} actor={actor} />
                  <details className="panel">
                    <summary>结合我记下的兴趣，找点灵感</summary>
                    <AssistantConversation
                      key={actor + "ideas"}
                      actor={actor}
                      mode="ideas"
                    />
                  </details>
                  {title(
                    "A LITTLE DISCOVERY",
                    "熟悉的东西，新的可能。",
                    "主动探索，按自己的节奏尝试。创意会说明条件，不把想象当成实测。",
                  )}
                  <div className="discovery-banner">
                    <Sparkles size={32} />
                    <div>
                      <h2>不用添置，也可以开始。</h2>
                      <p>从已拥有的物品中，找到值得试试的组合。</p>
                    </div>
                    <Badge>精选内容 · 非模型生成</Badge>
                  </div>
                  <div className="idea-grid">
                    {ideas.map((it, index) => (
                      <article className="idea-card" key={it.id}>
                        <button
                          className={`idea-art idea-${index}`}
                          onClick={() => {
                            setIdeaId(it.id);
                            go("idea");
                          }}
                        >
                          {index === 0 ? (
                            <>
                              <LampDesk size={76} strokeWidth={1} />
                              <span>＋</span>
                              <Frame size={72} strokeWidth={1} />
                            </>
                          ) : (
                            <>
                              <Grid3X3 size={70} strokeWidth={1} />
                              <span>＋</span>
                              <Frame size={72} strokeWidth={1} />
                            </>
                          )}
                          <span className="art-caption">{it.subtitle}</span>
                        </button>
                        <div className="idea-body">
                          <div className="inline">
                            <Badge>{it.kind}</Badge>
                            <small>{it.time}</small>
                          </div>
                          <h2>{it.title}</h2>
                          <p>{it.conditions}</p>
                          <div className="section-head">
                            <button
                              className="text-button"
                              onClick={() => {
                                setIdeaId(it.id);
                                go("idea");
                              }}
                            >
                              查看做法 <ArrowUpRight size={16} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label="收藏灵感"
                              onClick={() =>
                                act(
                                  "saveIdea",
                                  { ideaId: it.id },
                                  "收藏状态已更新",
                                )
                              }
                            >
                              <Bookmark
                                size={19}
                                fill={
                                  data.saved[actor]?.includes(it.id)
                                    ? "currentColor"
                                    : "none"
                                }
                              />
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                  <section className="panel">
                    <h2>让 AI 提出更多候选组合</h2>
                    <p>
                      使用当前有权查看的物品名称与状态；不发送私人故事。千问未配置时会明确提示。
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (data.items[0])
                          ask(
                            data.items[0].id,
                            "请根据已有物品提出两个低风险、无需购买的生活妙用组合。列出条件、步骤与尚未验证之处。",
                            "ideas",
                          );
                      }}
                    >
                      <button
                        className="button"
                        disabled={aiBusy || !data.items.length}
                      >
                        {aiBusy ? "正在请求…" : "请求 AI 组合建议"}
                        <Sparkles size={16} />
                      </button>
                    </form>
                    {answer && <div className="answer">{answer}</div>}
                  </section>
                </>
              )}
              {view === "idea" && (
                <>
                  <button className="back" onClick={() => go("discover")}>
                    <ArrowLeft size={16} /> 返回发现
                  </button>
                  {title("MAKE A LITTLE MOMENT", idea.title, idea.subtitle)}
                  <div className="detail-grid">
                    <section className="panel">
                      <Badge>精选创意 · 未经实测</Badge>
                      <p>{idea.description}</p>
                      <h3>开始前，确认这些条件</h3>
                      <p className="notice">{idea.conditions}</p>
                      {idea.steps.map((s, i) => (
                        <label className="check-row" key={s}>
                          <input type="checkbox" />
                          {i + 1}. {s}
                        </label>
                      ))}
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          await act(
                            "attempt",
                            { ideaId: idea.id, text: f.get("result") },
                            "尝试记录已保存",
                          );
                        }}
                      >
                        <label>
                          真实尝试记录
                          <textarea
                            name="result"
                            required
                            placeholder="做了什么？成功、失败或还需要确认什么？"
                          />
                        </label>
                        <button className="button" disabled={busy}>
                          保存尝试结果
                        </button>
                      </form>
                      {data.attempts
                        .filter((t) => t.ideaId === idea.id)
                        .map((t) => (
                          <div className="timeline" key={t.id}>
                            <small>{t.at.slice(0, 10)} · 我的尝试</small>
                            <p>{t.text}</p>
                          </div>
                        ))}
                    </section>
                    <section className="panel">
                      <h2>这次会用到</h2>
                      {idea.items.map((id) => {
                        const i = data.items.find((i) => i.id === id);
                        return i ? (
                          <button
                            key={id}
                            className="resource"
                            onClick={() => open(i)}
                          >
                            <Icon item={i} size={25} />
                            <span>
                              {i.name}
                              <small>{i.state} · 使用前再次确认</small>
                            </span>
                            <ChevronRight size={16} />
                          </button>
                        ) : (
                          <p key={id} className="notice">
                            缺少可访问的所需物品，请先录入或获得共享授权。
                          </p>
                        );
                      })}
                      {button(
                        data.saved[actor]?.includes(idea.id)
                          ? "取消收藏"
                          : "收藏，留待下次",
                        () => act("saveIdea", { ideaId: idea.id }),
                        true,
                      )}
                    </section>
                  </div>
                </>
              )}
              {view === "plan" && !elder && (
                <ActivityPlanner
                  items={data.items}
                  actor={actor}
                  plans={data.plans || []}
                  save={act}
                />
              )}
              {view === "family" && (
                <>
                  <h1>{elder ? "家人交代的事" : "家里有件事，一起处理。"}</h1>
                  <p>
                    {elder
                      ? "只显示交给你的提醒和待办。"
                      : "坏了要修、脏了要洗、缺了要买，写一句就能记下来。"}
                  </p>
                  {actor === "friend" ? (
                    <p>当前演示角色尚未加入家庭。</p>
                  ) : (
                    <>
                      {!elder && (
                        <section className="panel">
                          <h2>记一件事</h2>
                          <TaskComposer
                            items={data.items}
                            actor={actor}
                            act={act}
                          />
                        </section>
                      )}
                      <section className="panel">
                        <h2>{elder ? "需要你留意" : "正在处理"}</h2>
                        <TaskList
                          tasks={data.tasks}
                          actor={actor}
                          act={act}
                          elder={elder}
                        />
                      </section>
                      {!elder && (
                        <details className="panel">
                          <summary>维护周期与关怀设置</summary>{" "}
                          <div className="stack">
                            <section className="panel">
                              <Badge>A · 物品照料</Badge>
                              <h2>维护提醒</h2>
                              {data.items
                                .filter((i) => i.maintenance)
                                .map((i) => {
                                  const due = new Date(i.maintenance!);
                                  due.setDate(due.getDate() + (i.cycle || 90));
                                  return (
                                    <div key={i.id}>
                                      <h3>{i.name}</h3>
                                      <p>
                                        记录日期 {i.maintenance}
                                        <br />
                                        下次计划{" "}
                                        {due.toISOString().slice(0, 10)}
                                      </p>
                                      <Badge
                                        tone={
                                          due.getTime() < Date.now()
                                            ? "amber"
                                            : "green"
                                        }
                                      >
                                        {due.getTime() < Date.now()
                                          ? "计划已到期，请确认是否需要维护"
                                          : "尚未到计划日期"}
                                      </Badge>
                                      <p className="muted">
                                        按示例周期计算，非设备检测。
                                      </p>
                                      {button(
                                        "我已完成维护，记录今天",
                                        () => act("maintain", { itemId: i.id }),
                                        true,
                                      )}
                                    </div>
                                  );
                                })}
                            </section>
                            <section className="panel care">
                              <Badge tone="amber">B · 模拟设备信号</Badge>
                              <h2>温和关心，尊重自主</h2>
                              <p>
                                示例设备：爸爸常用的饮水设备。接收人：小林。演示规则：过去
                                24 小时缺少预期记录，不推断健康状态。
                              </p>
                              {data.care && (
                                <>
                                  <div className="notice">
                                    {careMessage(data.care)}
                                  </div>
                                  {actor === "dad" ? (
                                    <>
                                      {(
                                        [
                                          [
                                            "consent",
                                            "我同意使用这台设备的示例信号，并向小林提醒",
                                          ],
                                          ["paused", "暂停监测"],
                                          ["away", "我正在外出"],
                                          ["offline", "模拟设备离线"],
                                        ] as const
                                      ).map(([k, label]) => (
                                        <label className="check-row" key={k}>
                                          <input
                                            type="checkbox"
                                            checked={data.care![k]}
                                            onChange={(e) =>
                                              act("care", {
                                                [k]: e.target.checked,
                                              })
                                            }
                                          />
                                          {label}
                                        </label>
                                      ))}
                                      <label>
                                        注入示例信号
                                        <select
                                          value={data.care.signal}
                                          onChange={(e) =>
                                            act("care", {
                                              signal: e.target.value,
                                            })
                                          }
                                        >
                                          <option value="normal">
                                            有使用记录
                                          </option>
                                          <option value="missing">
                                            缺少预期记录
                                          </option>
                                        </select>
                                      </label>
                                    </>
                                  ) : (
                                    <p className="muted">
                                      请切换爸爸演示身份，由本人授权或暂停。
                                    </p>
                                  )}
                                </>
                              )}
                            </section>
                          </div>
                        </details>
                      )}
                      {!elder && (
                        <details className="panel">
                          <summary>已完成的事项</summary>
                          {data.tasks
                            .filter((t) => t.status === "用户确认完成")
                            .map((t) => (
                              <p key={t.id}>
                                {t.title} · {people[t.assignee]}确认完成
                              </p>
                            ))}
                        </details>
                      )}
                    </>
                  )}
                </>
              )}
              {view === "gifts" && (
                <>
                  {title(
                    "A GIFT THAT KEEPS ITS STORY",
                    "心意，随物品一起延续。",
                    "先有一件真实物品，再为它添上一段只属于你们的故事。",
                  )}
                  <section className="gift-hero">
                    <Gift size={48} strokeWidth={1} />
                    <h2>一份礼物，不只有打开的那一刻。</h2>
                    <p>
                      附上一句祝福、一段共同记忆。接收者可以先看，愿意时再认领。
                    </p>
                    {button("从我的物品开始", () => go("items"))}
                  </section>
                  <h2>我的礼物记录</h2>
                  {!data.gifts.length && (
                    <p className="muted">
                      还没有礼物。打开一件自己拥有的物品，选择「制作数字礼物」。
                    </p>
                  )}
                  {data.gifts.map((g) => (
                    <article className="panel gift-row" key={g.id}>
                      <div>
                        <Badge>
                          {g.revoked
                            ? "已撤销"
                            : g.claimedBy
                              ? "已认领"
                              : "等待认领"}
                        </Badge>
                        <h3>{g.itemName}</h3>
                        <p>{g.message}</p>
                      </div>
                      <div className="inline">
                        <a
                          className="button secondary"
                          href={`/gift/${g.token}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          接收预览 <ArrowUpRight size={15} />
                        </a>
                        {g.sender === actor &&
                          !g.claimedBy &&
                          !g.revoked &&
                          button(
                            "撤销链接",
                            () => act("revoke", { giftId: g.id }),
                            true,
                          )}
                      </div>
                    </article>
                  ))}
                  <h2>保存的片段</h2>
                  {data.memories
                    .filter((m) => (m.owner ?? m.author) === actor)
                    .map((m) => (
                      <article className="panel" key={m.id}>
                        <small>{m.at.slice(0, 10)} · 私人记忆</small>
                        <p>{m.text}</p>
                      </article>
                    ))}
                </>
              )}
              {view === "compose" && item && (
                <>
                  {title(
                    "MAKE IT PERSONAL",
                    `把「${item.name}」送给重要的人`,
                    "只传递你选择的内容。阅读祝福，不会转移物品归属。",
                  )}
                  <form
                    className="panel form-panel"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      if (
                        await act(
                          "gift",
                          {
                            itemId: item.id,
                            message: f.get("message"),
                            nickname: f.get("nickname"),
                            memoryIds: f.getAll("memory"),
                            includeKnowledge: f.get("knowledge") === "on",
                          },
                          "数字心意已保存，可预览接收体验",
                        )
                      )
                        go("gifts");
                    }}
                  >
                    <label>
                      给对方的话
                      <textarea
                        name="message"
                        required
                        placeholder="我想把它送给你，因为…"
                      />
                    </label>
                    <label>
                      可选角色昵称
                      <input
                        name="nickname"
                        placeholder="仅保存昵称；不启用角色对话"
                      />
                    </label>
                    <h3>选择愿意传递的故事</h3>
                    {data.memories
                      .filter(
                        (m) =>
                          m.itemId === item.id &&
                          (m.owner ?? m.author) === actor,
                      )
                      .map((m) => (
                        <label className="check-row" key={m.id}>
                          <input type="checkbox" name="memory" value={m.id} />
                          {m.text}
                        </label>
                      ))}
                    <label className="check-row">
                      <input type="checkbox" name="knowledge" />
                      附带通用使用提示（当前没有该型号官方资料）
                    </label>
                    <p className="notice">
                      <ShieldCheck size={17} />{" "}
                      私人订单、未选择的故事和后续私人记录均不会传递。
                    </p>
                    <button className="button" disabled={busy}>
                      制作并保存数字心意 <Gift size={16} />
                    </button>
                  </form>
                </>
              )}
              {view === "ask" && (
                <section className="simple-page">
                  <h1>先帮你找到合适的帮助</h1>
                  <section className="panel">
                    <h2>你的问题</h2>
                    <p>{draft || "可以先选一件物品，再描述遇到的情况。"}</p>
                    <p>可以先解决通用问题；涉及专属操作时再补充具体型号。</p>
                    <AssistantConversation
                      key={actor + draft}
                      actor={actor}
                      initialQuestion={draft}
                      elder={elder}
                      onSession={(s) =>
                        setUnboundSession(
                          s ? { id: s.id, revision: s.revision } : null,
                        )
                      }
                    />
                    <label>
                      这是家里的哪件物品？
                      <select
                        defaultValue=""
                        onChange={async (e) => {
                          const itemId = e.target.value;
                          if (!itemId) return;
                          try {
                            if (unboundSession) {
                              const r = await fetch("/api/assistant", {
                                method: "POST",
                                headers,
                                body: JSON.stringify({
                                  action: "attach",
                                  input: {
                                    sessionId: unboundSession.id,
                                    expectedRevision: unboundSession.revision,
                                    itemId,
                                  },
                                }),
                              });
                              const d = await r.json();
                              if (!r.ok) throw Error(d.error);
                              startHelp(itemId, "");
                            } else startHelp(itemId, draft);
                          } catch (e) {
                            setToast((e as Error).message);
                          }
                        }}
                      >
                        <option value="">选择已有物品</option>
                        {data.items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <SellerSupport actor={actor} question={draft} />
                    {!elder && (
                      <button className="text-button" onClick={() => go("add")}>
                        保存一件新物品
                      </button>
                    )}
                    <button
                      className="text-button"
                      onClick={() => {
                        setDraft("");
                        go("home");
                      }}
                    >
                      返回重新问
                    </button>
                  </section>
                </section>
              )}
            </>
          )}
          <footer className={elder ? "elder-footer" : ""}>
            物间 · 从物品出发，回到生活与彼此{" "}
            <span>示例数据与模型能力分别标识</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      <nav className="mobile-nav">
        {visibleNav.map(([v, label, I]) => (
          <button
            key={v}
            className={active === v ? "active" : ""}
            onClick={() => go(v)}
          >
            <I size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
