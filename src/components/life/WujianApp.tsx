"use client";
import { VirtualHome, HomeSources, type VirtualHomeData } from "./VirtualHome";
import { ProductArrival } from "./ProductArrival";
import { TaskContinuity } from "./TaskContinuity";
import { ItemBelonging } from "./ItemBelonging";
import { usePublicDemo } from "../DemoBoundary";
import { useEffect, useRef, useState } from "react";
import {
  Plus,
  ArrowUpRight,
  Search,
  Package,
  MessageCircle,
  Sparkles,
  BookOpen,
  Users,
  ArrowLeft,
  Leaf,
} from "lucide-react";
import { people, type Item, type State, type Person } from "@/lib/domain";
import type { ProductPack } from "@/lib/products";
import type { LifeIdea } from "@/lib/life/ideas";
import { AssistantConversation } from "../AssistantConversation";
import { MemoryCenter } from "../MemoryCenter";
import { FamilyPanel, SocialPanel } from "./FamilyPanel";
import { AccountFamily } from "./AccountFamily";
import { ActivityPlanner } from "../ActivityPlanner";
import { PreparationPlans } from "./PreparationPlans";
import { CareView } from "./CareView";
import { Intake } from "./Intake";
import { Stories, type Fragment } from "./Stories";
import { Discovery } from "./Discovery";
import { AISettings } from "./AISettings";
import type { ServiceSession, TurnInput } from "@/lib/agent/contracts";
import { ItemInformation } from "./ItemInformation";
import { syntheticItem } from "@/lib/life/availability";
import { itemPhoto } from "@/lib/life/item-photos";
type View =
  | "home"
  | "items"
  | "discover"
  | "stories"
  | "assistant"
  | "family"
  | "social"
  | "add"
  | "item";
type Data = {
  virtualHome: VirtualHomeData;
  workspace: State;
  fragments: Fragment[];
  ideas: LifeIdea[];
  packs: ProductPack[];
  capabilities: {
    softwareLab?: boolean;
    model: boolean;
    vision?: { ready: boolean; message: string };
    cloud: { state: string; ready: boolean; message: string };
  };
  stats: {
    items: number;
    syntheticItems: number;
    packs: number;
    facts: number;
    procedures: number;
    fragments: number;
  };
};
const nav = [
  ["home", "生活首页", Leaf],
  ["items", "物品展柜", Package],
  ["discover", "发现新玩法", Sparkles],
  ["stories", "生活故事", BookOpen],
  ["assistant", "问物间", MessageCircle],
  ["family", "家庭", Users],
  ["social", "社交", BookOpen],
] as const;
export default function WujianApp({ authenticatedAccount }: { authenticatedAccount?: { id: Person; name: string } } = {}) {
  const publicMode = usePublicDemo();
  const [elder, setElder] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [mutating, setMutating] = useState(false);
  const mutationPending = useRef(false);
  const [actor, setActor] = useState<Person>(authenticatedAccount?.id || "lin"),
    [data, setData] = useState<Data | null>(null),
    [view, setView] = useState<View>("home"),
    [selected, setSelected] = useState(""),
    [tab, setTab] = useState("帮助"),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("全部"),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [policy, setPolicy] = useState<"off" | "candidates">("off");
  useEffect(() => {
    try {
      setElder(
        (localStorage.getItem("wujian-interface-mode") ||
          localStorage.getItem("product-agent-mode")) === "elder",
      );
      const saved =
        localStorage.getItem("wujian-demo-actor") ||
        localStorage.getItem("product-agent-actor");
      if (
        !publicMode && !authenticatedAccount &&
        (saved === "lin" || saved === "dad" || saved === "friend")
      )
        setActor(saved);
    } catch {
      /* Browsing without persistent preferences is supported. */
    }
    setPreferencesReady(true);
  }, [publicMode]);
  const visibleNav = elder
    ? ([
        ["home", "问一问", MessageCircle],
        ["family", "家人交代的事", Users],
      ] as const)
    : nav;
  const [entryQuestion, setEntryQuestion] = useState("");
  const [activeTaskId,setActiveTaskId]=useState<string>();
  const [askEntry, setAskEntry] = useState<{
    key: number;
    itemId?: string;
    sessionId?: string;
    origin: TurnInput["uiContext"];
    fresh?: boolean;
  }>({ key: 0, origin: { page: "assistant" } });
  const [homeChoice, setHomeChoice] = useState<boolean | null>(null);
  const homeActive = homeChoice ?? data?.virtualHome?.itemIds.length === 8;
  function switchHome(value: boolean) {
    setHomeChoice(value);
    setMission(null);
    setAskSession(null);
    setEntryQuestion("");
    setAskEntry((e) => ({
      key: e.key + 1,
      origin: {
        page: "assistant",
        ...(value ? { homeId: "young-apartment-v1" as const } : {}),
      },
      fresh: true,
    }));
  }
  const [homeQuestion, setHomeQuestion] = useState("");
  const [mission, setMission] = useState<{
    session: ServiceSession;
    origin: TurnInput["uiContext"];
  } | null>(null);
  function returnToTask(voiceItemId?: string) {
    if (!mission) return;
    setEntryQuestion("");
    setAskEntry((e) => ({
      key: e.key + 1,
      itemId: mission.session.itemId,
      sessionId: mission.session.id,
      origin: { ...mission.origin!, voiceItemId, companion: false },
      fresh: false,
    }));
    setAskSession(mission.session);
    go("assistant");
  }
  const [askSession, setAskSession] = useState<ServiceSession | null>(null);
  function continueWithIdea(context: any, itemId?: string) {
    if (!homeActive || !mission) {
      ask(
        "带着刚才的创意和反馈，帮我完善下一步；别把设想当成已验证结果。",
        itemId,
        context,
      );
      return;
    }
    setEntryQuestion(
      "结合刚才选中的创意和我的反馈，调整当前任务的下一步；区分设想与已确认事实。",
    );
    setAskEntry((e) => ({
      key: e.key + 1,
      itemId: mission.session.itemId,
      sessionId: mission.session.id,
      origin: { ...mission.origin!, planContext: context },
      fresh: false,
    }));
    setAskSession(mission.session);
    go("assistant");
  }
  const itemSessions = useRef<Record<string, string>>({});
  function ask(
    question = "",
    itemId?: string,
    planContext?: any,
    sessionId?: string,
    companion = false,
    taskPlanId?: string,
    taskId: string|undefined = activeTaskId,
  ) {
    setActiveTaskId(taskId);
    setEntryQuestion(question);
    setAskEntry((e) => ({
      key: e.key + 1,
      itemId,
      sessionId,
      origin: {
        ...(homeActive ? { homeId: "young-apartment-v1" as const } : {}),
        page: planContext ? "discover" : itemId ? "item" : "assistant",
        goal: planContext?.continuation?.goal,
        planContext,
        companion,
        taskPlanId,
      },
      fresh: (homeActive && !sessionId) || !!planContext || !!taskPlanId,
    }));
    setAskSession(null);
    go("assistant");
  }
  const [giftPicking, setGiftPicking] = useState(false);
  const generation = useRef(0);
  const [backView, setBackView] = useState<View>("items");
  const headers = { "Content-Type": "application/json", "x-demo-actor": actor };
  async function load() {
    const v = ++generation.current;
    const r = await fetch("/api/life", { headers, cache: "no-store" });
    const d = await r.json();
    if (!r.ok) { if(r.status===401||r.status===403)setData(null); throw Error(d.error); }
    if (v === generation.current) setData(d);
  }
  async function request(action: string, input?: unknown) {
    const top = ["code", "lookup", "fetchSource", "demo"].includes(action);
    const r = await fetch("/api/life", {
      method: "POST",
      headers:{...headers,...(activeTaskId?{"x-wujian-task":activeTaskId}:{})},
      body: JSON.stringify(
        top ? { action, ...(input as object) } : { action, input },
      ),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    return d;
  }
  async function upload(file: File, kind: string) {
    const f = new FormData();
    f.set("file", file);
    f.set("kind", kind);
    const r = await fetch("/api/life", {
      method: "POST",
      headers: { "x-demo-actor": actor },
      body: f,
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    return d;
  }
  async function act(
    action: string,
    p: Record<string, unknown>,
    message = "已保存",
  ) {
    if (mutationPending.current) return false;
    mutationPending.current = true;
    generation.current++;
    setMutating(true);
    try {
      if (authenticatedAccount && ["task", "ackTask"].includes(action)) {
        const command = action === "ackTask" ? "seen" : ({ "进行中": "accept", "用户确认完成": "report_done", "未解决": "unresolved" } as Record<string,string>)[String(p.status)];
        if (!command) throw Error("请在家庭事项中确认接手或报告结果");
        const response = await fetch("/api/collaboration", {
          method: "POST", headers,
          body: JSON.stringify({ action: command, taskId: p.taskId, requestId: crypto.randomUUID(), confirmed: true, summary: typeof p.text === "string" ? p.text : undefined }),
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error);
        await load(); setNotice(message); return true;
      }
      const r = await fetch("/api/workspace", {
        method: "POST",
        headers,
        body: JSON.stringify({ action, ...p }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      await load();
      setNotice(message);
      return true;
    } catch (e) {
      setNotice((e as Error).message);
      return false;
    } finally {
      mutationPending.current = false;
      setMutating(false);
    }
  }
  useEffect(() => {
    setData(null);
    setHomeChoice(null);
    setMission(null);
    setSelected("");
    const initial = [
      "home",
      "items",
      "discover",
      "stories",
      "assistant",
      "family",
      "social",
    ].includes(window.location.hash.slice(1))
      ? (window.location.hash.slice(1) as View)
      : "home";
    setView(initial);
    window.history.replaceState(
      { wujian: true, actor, view: initial, selected: "", tab: "帮助" },
      "",
      `#${initial}`,
    );
    load().catch((e) => setError(e.message));
    return () => {
      generation.current++;
    };
  }, [actor]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && !mutationPending.current)
        load().catch((e) => setError(e.message));
    };
    const timer = setInterval(refresh, elder ? 15000 : 10000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [elder, actor]);
  useEffect(() => {
    const back = (event: PopStateEvent) => {
      if(!mutationPending.current)void load().catch(e=>setError(e.message));
      const s = event.state;
      if (s?.wujian && s.actor === actor) {
        setView(s.view);
        setSelected(s.selected || "");
        setTab(s.tab || "帮助");
        setNotice("");
        setError("");
      }
    };
    window.addEventListener("popstate", back);
    const hash = () => {
      if(!mutationPending.current)void load().catch(e=>setError(e.message));
      const [next, id] = window.location.hash.slice(1).split("/");
      if (
        [
          "home",
          "items",
          "discover",
          "stories",
          "assistant",
          "family",
          "social",
          "add",
          "item",
        ].includes(next)
      ) {
        setView(next as View);
        if (next === "item" && id) {
          try {
            setSelected(decodeURIComponent(id));
          } catch {
            setError("物品地址不完整");
          }
        }
      }
    };
    window.addEventListener("hashchange", hash);
    return () => {
      window.removeEventListener("popstate", back);
      window.removeEventListener("hashchange", hash);
    };
  }, [actor]);
  useEffect(() => {
    const listener = () => load().catch((e) => setError(e.message));
    window.addEventListener("workspace-updated", listener);
    return () => window.removeEventListener("workspace-updated", listener);
  }, [actor]);
  function go(v: View, id = selected, nextTab = tab) {
    if(!mutationPending.current)void load().catch(e=>setError(e.message));
    if (v !== "items") setGiftPicking(false);
    setView(v);
    window.history.pushState(
      { wujian: true, actor, view: v, selected: id, tab: nextTab },
      "",
      `#${v}${v === "item" ? "/" + encodeURIComponent(id) : ""}`,
    );
    setNotice("");
    setError("");
    window.scrollTo({ top: 0 });
  }
  function open(id: string, nextTab = "帮助") {
    setBackView(view === "add" || view === "item" ? "items" : view);
    setSelected(id);
    setTab(nextTab);
    go("item", id, nextTab);
  }
  const allItems = data?.workspace.items.filter((i) => !i.demo) || [];
  const items = homeActive
    ? allItems.filter((i) => data?.virtualHome.itemIds.includes(i.id))
    : allItems;
  const item = items.find((i) => i.id === selected);
  const activeAskItemId = askSession ? askSession.itemId : askEntry.itemId;
  const heroItem =
    items.find((i) => !syntheticItem(i) && itemPhoto(i, actor)) ||
    items.find((i) => i.id === "life-sample-13" && itemPhoto(i, actor)) ||
    items.find((i) => itemPhoto(i, actor));
  const photo = (i: Item) => itemPhoto(i, actor)?.src;
  const photoLabel = (i: Item) =>
    itemPhoto(i, actor)?.label ||
    (i.id.startsWith("virtual-home:")
      ? "模拟持有 · 图标占位"
      : syntheticItem(i)
        ? "演示物品"
        : "我的物品");
  const cards = (rows: Item[]) => (
    <div className="life-item-grid">
      {rows.map((i) => (
        <button
          className="life-item-card"
          key={i.id}
          onClick={() =>
            open(i.id, view === "items" && giftPicking ? "资料与管理" : "帮助")
          }
        >
          <div className="life-item-image">
            {photo(i) ? (
              <img
                src={photo(i)}
                alt={`${i.name} · ${photoLabel(i)}`}
                width={960}
                height={960}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="life-photo-placeholder">
                <Package size={44} />
                <span>
                  {i.id.startsWith("virtual-home:")
                    ? "型号占位展示 · 非实拍"
                    : "等你留下一张照片"}
                </span>
              </div>
            )}
            <span className="life-image-label">{photoLabel(i)}</span>
          </div>
          <div className="life-item-copy">
            <small>
              {i.category} · {i.lifecycle || "待补充"}
            </small>
            <h3>{i.name}</h3>
            <p>{i.model}</p>
            <small>
              {i.attributes?.quantity !== undefined
                ? `余量 ${i.attributes.quantity}${i.attributes.quantityUnit || ""} · `
                : ""}
              {i.attributes?.expiresOn
                ? `有效期 ${i.attributes.expiresOn} · `
                : ""}
              {data?.fragments.filter((f) => f.itemIds.includes(i.id)).length ||
                0}{" "}
              段故事 · 用途与玩法 ↗
            </small>
            <div className="life-actions">
              <span className="life-status">{i.state}</span>
              <ArrowUpRight size={17} />
            </div>
          </div>
        </button>
      ))}
    </div>
  );
  return (
    <div className={`life-shell${elder ? " life-care" : ""}`}>
      <header className="life-header">
        <button className="life-brand" onClick={() => go("home")}>
          <span>物间</span>
          <small>WU JIAN · LIFE, WITH THINGS</small>
        </button>
        <nav aria-label="主要导航">
          {visibleNav.map(([v, label, Icon]) => (
            <button
              className={
                (elder ? (view === "family" ? "family" : "home") : view) === v
                  ? "active"
                  : ""
              }
              key={v}
              onClick={() => go(v)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="life-header-controls">
          {authenticatedAccount ? <span className="life-actor">{authenticatedAccount.name}的空间</span> : publicMode ? (
            <span className="life-actor">我的演示空间</span>
          ) : (
            <label className="life-actor">
              <span>本机演示身份</span>
              <select
                aria-label="演示家庭成员"
                value={actor}
                disabled={conversationBusy || mutating || busy}
                onChange={(e) => {
                  generation.current++;
                  setData(null);
                  setActor(e.target.value as Person);
                  try {
                    localStorage.setItem("wujian-demo-actor", e.target.value);
                  } catch {}
                }}
              >
                {Object.entries(people).map(([id, n]) => (
                  <option key={id} value={id}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="life-version">
            <span>界面版本</span>
            <select
              aria-label="界面版本"
              value={elder ? "elder" : "standard"}
              disabled={
                !preferencesReady || conversationBusy || mutating || busy
              }
              onChange={(e) => {
                const enabled = e.target.value === "elder";
                setElder(enabled);
                try {
                  localStorage.setItem("wujian-interface-mode", e.target.value);
                } catch {}
                go("home");
              }}
            >
              <option value="standard">普通版</option>
              <option value="elder">大字关怀版</option>
            </select>
          </label>
        </div>
      </header>
      <main className="life-main">
        {data && <TaskContinuity actor={actor} items={data.workspace.items} onExit={()=>setActiveTaskId(undefined)} onResume={(taskId,itemId,sessionId,newGoal)=>{ask(newGoal||"",itemId,undefined,sessionId,false,undefined,taskId);}}/>}
        {!elder && (
          <div className="life-topline">
            <span>把日常用好，把生活留住。</span>
            <button onClick={() => go("add")}>
              <Plus size={16} />
              录入物品
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="life-notice">
            {error}
            <button
              onClick={() =>
                load()
                  .then(() => setError(""))
                  .catch((e) => setError(e.message))
              }
            >
              重试
            </button>
          </p>
        )}
        {notice && (
          <p role="status" className="life-notice">
            {notice}
          </p>
        )}
        {data && !elder && (
          <details className="life-cloud-status">
            <summary>设置与 AI 状态</summary>
            <p>
              {data.capabilities.cloud.message}{" "}
              {!publicMode && <a href="/guide#cloud">本机配置与撤销</a>}
            </p>
            {!publicMode && (
              <p className="life-muted">
                官方资料按需联网，可在启动环境以 WUJIAN_ALLOW_PUBLIC_FETCH=false
                关闭；不会发送私人记忆。
              </p>
            )}
          </details>
        )}
        {!data || !preferencesReady ? (
          <div className="life-empty">正在打开你的生活展柜…</div>
        ) : elder ? (
          <CareView
            key={actor}
            actor={actor}
            workspace={data.workspace}
            items={items}
            view={view === "family" ? "family" : "home"}
            act={act}
            refresh={load}
            onBusy={setConversationBusy}
          />
        ) : (
          <>
            {view === "home" && (
              <>
                <VirtualHome
                  data={data.virtualHome}
                  items={allItems}
                  active={homeActive}
                  onActive={switchHome}
                  request={request}
                  refresh={load}
                  onAsk={(q) => ask(q)}
                  onItem={(id) => open(id)}
                  goalEntry={
                    homeActive ? (
                      <form
                        className="home-ask apartment-ask"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (homeQuestion.trim()) {
                            ask(homeQuestion);
                            setHomeQuestion("");
                          }
                        }}
                      >
                        <label htmlFor="home-question">
                          从你现在想做的事开始
                        </label>
                        <input
                          id="home-question"
                          value={homeQuestion}
                          onChange={(e) => setHomeQuestion(e.target.value)}
                          placeholder="例如：想把旅行手账和朋友送的画一起安排好…"
                          maxLength={2000}
                        />
                        <button className="button" aria-label="开始家庭对话">
                          一起想想 ↗
                        </button>
                      </form>
                    ) : undefined
                  }
                />
                {!homeActive && (
                  <>
                    <section className="life-hero">
                      <div>
                        <span className="life-eyebrow">
                          EVERYDAY THINGS, NEW POSSIBILITIES
                        </span>
                        <h1>
                          物有所用，
                          <br />
                          生活有迹。
                        </h1>
                        <p>
                          用好已经拥有的，发现意料之外的。
                          <br />
                          也留住那些，和它们一起发生的小事。
                        </p>
                        <form
                          className="home-ask"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (entryQuestion.trim()) ask(entryQuestion);
                          }}
                        >
                          <label className="sr-only" htmlFor="home-question">
                            随时问物间
                          </label>
                          <input
                            id="home-question"
                            value={entryQuestion}
                            onChange={(e) => setEntryQuestion(e.target.value)}
                            maxLength={2000}
                            placeholder="有件事想问问，或想一起试点新东西…"
                          />
                          <button className="button" aria-label="开始对话">
                            ↗
                          </button>
                        </form>
                        <div className="life-actions">
                          <button
                            className="button secondary"
                            onClick={() => go("discover")}
                          >
                            今天，试点新鲜的 <ArrowUpRight size={16} />
                          </button>
                          <button
                            className="life-text-link"
                            onClick={() => ask()}
                          >
                            有件事想问问
                          </button>
                        </div>
                      </div>
                      <div className="life-hero-photos">
                        {heroItem && photo(heroItem) ? (
                          <button
                            className="life-hero-object"
                            onClick={() => open(heroItem.id)}
                          >
                            <img
                              src={photo(heroItem)}
                              alt={`${heroItem.name} · ${photoLabel(heroItem)}`}
                              width={960}
                              height={960}
                              fetchPriority="high"
                            />
                          </button>
                        ) : (
                          <div className="life-upload-empty">
                            <Package size={48} />
                            <p>从一件身边的物品开始</p>
                            <button onClick={() => go("add")}>
                              留下它现在的样子
                            </button>
                          </div>
                        )}
                        <div className="life-hero-note">
                          <Leaf size={22} />
                          <span>
                            让已有的东西，
                            <br />
                            陪生活多走一步。
                          </span>
                          <small>
                            {heroItem
                              ? `${heroItem.name} · ${photoLabel(heroItem)}`
                              : "不必先布置虚拟空间"}
                          </small>
                        </div>
                      </div>
                    </section>
                    <section>
                      <div className="life-section-head">
                        <div>
                          <span className="life-eyebrow">
                            YOUR EVERYDAY COLLECTION
                          </span>
                          <h2>身边的物品，熟悉的新可能</h2>
                        </div>
                        <button onClick={() => go("items")}>
                          打开物品展柜 <ArrowUpRight size={16} />
                        </button>
                      </div>
                      {cards(
                        [
                          ...items.filter(
                            (i) => !i.synthetic && i.source !== "示例数据",
                          ),
                          ...[13, 14, 10, 12, 0, 1].flatMap((n) =>
                            items.filter((i) => i.id === `life-sample-${n}`),
                          ),
                          ...items,
                        ]
                          .filter(
                            (i, n, a) =>
                              a.findIndex((x) => x.id === i.id) === n,
                          )
                          .slice(0, 8),
                      )}
                    </section>
                    <section className="life-home-pair">
                      <button
                        className="life-story-teaser"
                        onClick={() => go("stories")}
                      >
                        <BookOpen size={25} />
                        <small>生活故事</small>
                        <h2>
                          照片之外，
                          <br />
                          再留下一句话。
                        </h2>
                        <p>
                          {data.fragments[0]?.text ||
                            "一件旧物的来历，一次新尝试，都值得被自己记住。"}
                        </p>
                        <span>写下一个生活片段 ↗</span>
                      </button>
                      <div className="life-card life-ask-teaser">
                        <MessageCircle size={27} />
                        <h2>
                          怎么用，能怎么玩，
                          <br />
                          或者，只想聊聊。
                        </h2>
                        <p>
                          普通交流不必绑定物品。具体型号和资料会在需要时核对。
                        </p>
                        <button
                          className="button secondary"
                          onClick={() => ask()}
                        >
                          问物间
                        </button>
                        <small>{data.capabilities.cloud.message}</small>
                      </div>
                    </section>
                    {(publicMode ||
                      !items.some((i) => i.id === "life-sample-0")) && (
                      <section className="life-demo-banner">
                        <div>
                          <h3>先用一组生活案例逛一逛</h3>
                          <p>
                            合成展柜、预置新玩法与生活故事已为演示准备；它们不代表你的实际持有或经历。
                          </p>
                        </div>
                        <button
                          disabled={busy}
                          onClick={async () => {
                            if (items.some((i) => i.id === "life-sample-0")) {
                              go("items");
                              return;
                            }
                            setBusy(true);
                            try {
                              await request("demo", { confirmed: true });
                              await load();
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          {items.some((i) => i.id === "life-sample-0")
                            ? "浏览演示物品"
                            : "载入合成演示案例"}
                        </button>
                      </section>
                    )}
                  </>
                )}
              </>
            )}
            {view === "items" && (
              <section>
                <div className="life-section-head">
                  <div>
                    <span className="life-eyebrow">
                      A CABINET OF EVERYDAY LIFE
                    </span>
                    <h1>物品展柜</h1>
                    {giftPicking && (
                      <p className="life-notice">
                        选择一件本人拥有的物品，进入资料与管理预览赠礼及选中的故事。未选择的私人内容不会附带。
                      </p>
                    )}
                    <p>类别、生命周期与用途，一起认识身边的物品。</p>
                  </div>
                  <button className="button" onClick={() => go("add")}>
                    <Plus size={17} />
                    录入一件物品
                  </button>
                </div>
                <div className="life-filters">
                  <label>
                    <Search size={18} />
                    <input
                      aria-label="搜索物品"
                      placeholder="名称、品牌、型号或能力"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="物品类别"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {["全部", ...new Set(items.map((i) => i.category))].map(
                      (x) => (
                        <option key={x}>{x}</option>
                      ),
                    )}
                  </select>
                  <span>
                    {items.length} 件物品 · {data.stats.syntheticItems}{" "}
                    件合成实例
                  </span>
                </div>
                {cards(
                  items.filter(
                    (i) =>
                      (!giftPicking || i.owner === actor) &&
                      (category === "全部" || i.category === category) &&
                      JSON.stringify([i.name, i.brand, i.model, i.attributes])
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                  ),
                )}
              </section>
            )}
            {view === "add" && (
              <ProductArrival
                request={request}
                upload={upload}
                onSaved={async (i) => {
                  await load();
                  open(i.id);
                  setNotice("已建立私人记录；官方事实与个人状态分别保留。");
                }}
              >
                {data.capabilities.softwareLab && <section className="life-card"><h2>体验一次可验证的软件能力</h2><p>创建自有虚拟灯的合成记录。分析与调光都在本机软件中发生，不代表连接真实台灯。</p><button disabled={busy} onClick={async () => { setBusy(true); try { const r = await fetch("/api/device-lab", { method: "POST", headers: { "Content-Type": "application/json", "x-demo-actor": actor }, body: JSON.stringify({ action: "create", confirmed: true, requestId: crypto.randomUUID() }) }); const d = await r.json(); if (!r.ok) throw Error(d.error); await load(); open(d.item.id); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>创建软件灯测试物品</button></section>}
                <Intake
                  vision={data.capabilities.vision}
                  key={actor}
                  packs={data.packs}
                  request={request}
                  upload={upload}
                  onSaved={async (i) => {
                    await load();
                    open(i.id);
                    setNotice("已录入；未知型号和状态仍保留为未知。");
                  }}
                />
              </ProductArrival>
            )}
            {view === "discover" && (
              <Discovery
                key={actor}
                items={items}
                ideas={data.ideas}
                request={request}
                refresh={load}
                modelAvailable={data.capabilities.model}
                onAsk={(context) =>
                  ask("继续这个目标，帮我进一步完善方案", undefined, context)
                }
              />
            )}
            {view === "stories" && (
              <Stories
                key={actor}
                actor={actor}
                items={items}
                fragments={data.fragments}
                request={request}
                upload={upload}
                refresh={load}
                onItem={(id) => open(id, "故事")}
                onAsk={() => ask("回忆一下以前保存的生活故事")}
              />
            )}
            {view === "assistant" && (
              <section>
                <div className="life-section-head">
                  <div>
                    <span className="life-eyebrow">
                      HERE TO HELP, AND TO LISTEN
                    </span>
                    <h1>{homeActive ? "一起，把生活安排好" : "问物间"}</h1>
                    <p>
                      {homeActive
                        ? "同一段对话，联系物品、获准故事与生活目标。这里使用独立标记的模拟家庭。"
                        : "需要时使用相关物品和获准信息；普通聊天不必围绕物品。"}
                    </p>
                  </div>
                </div>
                <label className="life-card life-check">
                  <input
                    type="checkbox"
                    checked={policy === "candidates"}
                    onChange={(e) =>
                      setPolicy(e.target.checked ? "candidates" : "off")
                    }
                  />
                  允许从这段对话建议记忆（模型可用时分析当前原话；先确认再用于长期个性化，历史私密记忆默认不上云）
                </label>
                {activeAskItemId && (
                  <div className="life-actions">
                    <span>
                      正在围绕：
                      {items.find((i) => i.id === activeAskItemId)?.name ||
                        "所选物品"}
                    </span>
                    <button onClick={() => ask()}>切换到普通聊天</button>
                  </div>
                )}
                {homeActive && (
                  <div className="home-task-banner">
                    <span>虚拟年轻人公寓 · 8 件物品</span>
                    <button onClick={() => go("home")}>
                      查看这个家与资料授权 ↗
                    </button>
                    {askEntry.origin?.voiceItemId && (
                      <button
                        onClick={() => {
                          setAskEntry((e) => ({
                            ...e,
                            origin: {
                              ...e.origin!,
                              voiceItemId: undefined,
                              companion: false,
                            },
                          }));
                        }}
                      >
                        让物间继续说
                      </button>
                    )}
                  </div>
                )}
                <details className="home-model-settings">
                  <summary>模型连接与设置</summary>
                  <AISettings actor={actor} />
                </details>
                <PreparationPlans
                  plans={data.workspace.plans || []}
                  act={act}
                  onContinue={(plan, question) =>
                    ask(
                      question,
                      undefined,
                      undefined,
                      undefined,
                      false,
                      plan.id,
                    )
                  }
                />
                <AssistantConversation
                  taskId={activeTaskId}
                  key={
                    actor +
                    policy +
                    askEntry.key +
                    (homeActive ? "home" : "personal")
                  }
                  actor={actor}
                  mode="auto"
                  initialQuestion={entryQuestion}
                  item={items.find((i) => i.id === askEntry.itemId)}
                  initialSessionId={askEntry.sessionId}
                  startFresh={askEntry.fresh}
                  allHistory
                  onSession={(s) => {
                    setAskSession(s);
                    if (s && s.known.homeId)
                      setMission({
                        session: s,
                        origin: {
                          ...askEntry.origin!,
                          ...(homeActive
                            ? { homeId: "young-apartment-v1" }
                            : {}),
                        },
                      });
                  }}
                  onSelectItem={(id) => open(id)}
                  onBusy={setConversationBusy}
                  uiContext={
                    homeActive
                      ? { ...askEntry.origin!, homeId: "young-apartment-v1" }
                      : askEntry.origin
                  }
                  memoryPolicy={policy}
                  onActivity={() => load().catch(() => {})}
                />
                <details className="life-card">
                  <summary>个人记忆、来源与可选交流方式</summary>
                  <MemoryCenter actor={actor} items={items} />
                </details>
              </section>
            )}
            {view === "item" && item && (
              <section>
                <button className="life-back" onClick={() => go(backView)}>
                  <ArrowLeft size={16} />
                  返回
                  {
                    {
                      home: "生活首页",
                      items: "物品展柜",
                      stories: "生活故事",
                      family: "家庭",
                      social: "社交",
                      discover: "发现新玩法",
                      assistant: "问物间",
                      add: "物品展柜",
                      item: "物品展柜",
                    }[backView]
                  }
                </button>
                {homeActive && mission && (
                  <div className="home-task-return">
                    <div>
                      <small>正在继续的生活任务</small>
                      <strong>
                        {mission.session.known.homeTaskGoal || "一起安排这个家"}
                      </strong>
                    </div>
                    <button onClick={() => returnToTask()}>返回原任务 ↗</button>
                  </div>
                )}
                <div className="life-detail-hero">
                  <div className="life-detail-photo">
                    {photo(item) ? (
                      <img
                        src={photo(item)}
                        alt={`${item.name} · ${photoLabel(item)}`}
                        width={960}
                        height={960}
                        decoding="async"
                      />
                    ) : (
                      <Package size={90} />
                    )}
                  </div>
                  <div>
                    <span className="life-eyebrow">
                      {item.category} · {photoLabel(item)}
                    </span>
                    <h1>{item.name}</h1>
                    <p>
                      {item.brand} {item.model}
                    </p>
                    <div className="life-tags">
                      <span>{item.lifecycle || "生命周期待补充"}</span>
                      <span>{item.state}</span>
                      <span>{item.shared ? "家庭共享物品" : "私人物品"}</span>
                    </div>
                    <p>{item.note}</p>
                    {item.owner === actor && (
                      <div className="life-actions">
                        <select
                          aria-label="物品可用状态"
                          value={item.availability || "unknown"}
                          onChange={async (e) => {
                            try {
                              await request("updateItem", {
                                itemId: item.id,
                                availability: e.target.value,
                              });
                              await load();
                            } catch (e) {
                              setNotice((e as Error).message);
                            }
                          }}
                        >
                          {Object.entries({
                            unknown: "状态待确认",
                            available: "确认在手且可用",
                            loaned: "已借出",
                            lost: "丢失",
                            broken: "损坏",
                            consumed: "用尽",
                          }).map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => authenticatedAccount ? (go("family"), setNotice("请在家庭中明确选择要授权的成员；不会自动共享私人故事。")) :
                            act(
                              "updateItem",
                              { itemId: item.id, shared: !item.shared },
                              item.shared
                                ? "已停止共享物品；私人故事仍独立"
                                : "已共享物品；私人故事没有随之共享",
                            )
                          }
                        >
                          {authenticatedAccount ? "管理家人使用权限" : item.shared ? "停止家庭共享" : "共享给家庭"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {homeActive &&
                  data.virtualHome.knowledge.find(
                    (k) => k.itemId === item.id && k.documents.length > 0,
                  ) && (
                    <HomeSources
                      knowledge={data.virtualHome.knowledge.find(
                        (k) => k.itemId === item.id,
                      )!}
                    />
                  )}
                <div className="life-card life-item-story-link">
                  <BookOpen size={20} />
                  <div>
                    <strong>它与你的故事</strong>
                    <p>
                      {data.fragments.find((f) => f.itemIds.includes(item.id))
                        ?.text ||
                        "使用中的一个小变化、一次新玩法，都可以和这件物品留在一起。"}
                    </p>
                  </div>
                  <button onClick={() => setTab("故事")}>
                    查看 / 留下片段（
                    {
                      data.fragments.filter((f) => f.itemIds.includes(item.id))
                        .length
                    }
                    ）
                  </button>
                  <button onClick={() => setTab("新玩法")}>
                    让它多一种可能
                  </button>
                </div>
                <div className="life-tabs">
                  {["帮助", "新玩法", "故事", "资料与管理"].map((s) => (
                    <button
                      className={tab === s ? "active" : ""}
                      key={s}
                      onClick={() => setTab(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                {tab === "帮助" && (
                  <ItemBelonging
                    key={actor + item.id}
                    actor={actor}
                    item={item}
                    items={items}
                    packs={data.packs}
                    fragments={data.fragments}
                    homeId={homeActive ? "young-apartment-v1" : undefined}
                    hasKnowledge={data.virtualHome.knowledge.some(
                      (k) => k.itemId === item.id && k.documents.length > 0,
                    )}
                    onContinueMission={
                      homeActive && mission
                        ? (voiceId) => returnToTask(voiceId)
                        : undefined
                    }
                    request={request}
                    upload={upload}
                    refresh={load}
                    onSession={(s) => {
                      if (s) itemSessions.current[item.id] = s.id;
                    }}
                    onContinue={() =>
                      ask("", item.id, undefined, itemSessions.current[item.id])
                    }
                  />
                )}
                {tab === "新玩法" && (
                  <Discovery
                    key={item.id}
                    itemId={item.id}
                    items={items}
                    ideas={data.ideas}
                    homeId={homeActive ? "young-apartment-v1" : undefined}
                    request={request}
                    refresh={load}
                    modelAvailable={data.capabilities.model}
                    onAsk={(context) => continueWithIdea(context, item.id)}
                  />
                )}
                {tab === "故事" && (
                  <Stories
                    key={actor + item.id}
                    actor={actor}
                    itemId={item.id}
                    items={items}
                    fragments={data.fragments}
                    request={request}
                    upload={upload}
                    refresh={load}
                    onItem={(id) => open(id, "故事")}
                    onAsk={() => ask("回忆一下这件物品的故事", item.id)}
                  />
                )}
                {tab === "资料与管理" && (
                  <ItemInformation
                    key={actor + item.id}
                    item={item}
                    actor={actor}
                    packs={data.packs}
                    request={request}
                    upload={upload}
                    act={act}
                    fragments={data.fragments}
                    refresh={load}
                  />
                )}
              </section>
            )}
            {view === "family" && (
              <>
                {authenticatedAccount ? <AccountFamily actor={actor} items={items} refresh={load} onItem={open} taskId={activeTaskId}/> : <FamilyPanel
                  workspace={data.workspace}
                  actor={actor}
                  items={items}
                  act={act}
                  onItem={open}
                />}
                <details className="life-card life-extra-plans">
                  <summary>活动准备与已保存计划</summary>
                  <ActivityPlanner
                    actor={actor}
                    items={items}
                    plans={data.workspace.plans || []}
                    save={act}
                  />
                </details>
              </>
            )}
            {view === "social" && (
              <SocialPanel
                workspace={data.workspace}
                actor={actor}
                act={act}
                onCabinet={() => {
                  setQuery("");
                  setCategory("全部");
                  setGiftPicking(true);
                  go("items");
                }}
              />
            )}
          </>
        )}
      </main>
      {!elder && (
        <footer className="life-footer">
          <span>物间 · 用好物品，也留住生活。</span>
          <span>
            {publicMode
              ? "在线演示 / 测试案例、资料与创意分别标注"
              : "本机演示 / 真实资料、合成实例与创意候选分别标注"}
          </span>
          <a href="/legacy">旧版入口</a>
          <a href="/guide">操作指南</a>
        </footer>
      )}
    </div>
  );
}
