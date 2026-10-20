"use client";
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
import { ActivityPlanner } from "../ActivityPlanner";
import { Intake } from "./Intake";
import { Stories, type Fragment } from "./Stories";
import { Discovery } from "./Discovery";
import { AISettings } from "./AISettings";
import type { ServiceSession, TurnInput } from "@/lib/agent/contracts";
import { ItemInformation } from "./ItemInformation";
import { syntheticItem } from "@/lib/life/availability";
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
  workspace: State;
  fragments: Fragment[];
  ideas: LifeIdea[];
  packs: ProductPack[];
  capabilities: {
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
export default function WujianApp() {
  const publicMode = usePublicDemo();
  const [actor, setActor] = useState<Person>("lin"),
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
  const [entryQuestion, setEntryQuestion] = useState("");
  const [askEntry, setAskEntry] = useState<{
    key: number;
    itemId?: string;
    sessionId?: string;
    origin: TurnInput["uiContext"];
    fresh?: boolean;
  }>({ key: 0, origin: { page: "assistant" } });
  const [askSession, setAskSession] = useState<ServiceSession | null>(null);
  const itemSessions = useRef<Record<string, string>>({});
  function ask(
    question = "",
    itemId?: string,
    planContext?: any,
    sessionId?: string,
    companion = false,
  ) {
    setEntryQuestion(question);
    setAskEntry((e) => ({
      key: e.key + 1,
      itemId,
      sessionId,
      origin: {
        page: planContext ? "discover" : itemId ? "item" : "assistant",
        goal: planContext?.continuation?.goal,
        planContext,
        companion,
      },
      fresh: !!planContext,
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
    if (!r.ok) throw Error(d.error);
    if (v === generation.current) setData(d);
  }
  async function request(action: string, input?: unknown) {
    const top = ["code", "lookup", "fetchSource", "demo"].includes(action);
    const r = await fetch("/api/life", {
      method: "POST",
      headers,
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
    try {
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
    }
  }
  useEffect(() => {
    setData(null);
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
    const back = (event: PopStateEvent) => {
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
    return () => window.removeEventListener("popstate", back);
  }, [actor]);
  useEffect(() => {
    const listener = () => load().catch((e) => setError(e.message));
    window.addEventListener("workspace-updated", listener);
    return () => window.removeEventListener("workspace-updated", listener);
  }, [actor]);
  function go(v: View, id = selected, nextTab = tab) {
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
  const items = data?.workspace.items.filter((i) => !i.demo) || [];
  const item = items.find((i) => i.id === selected);
  const activeAskItemId = askSession ? askSession.itemId : askEntry.itemId;
  const heroItem =
    items.find((i) => !syntheticItem(i) && i.photo) ||
    items.find((i) => i.id === "life-sample-13");
  function photo(i: Item) {
    // Never represent a purifier or a table by an unrelated house/lamp photograph.
    if (
      i.synthetic &&
      i.photo?.startsWith("/demo/life/") &&
      ![
        "life-sample-0",
        "life-sample-1",
        "life-sample-10",
        "life-sample-11",
        "life-sample-12",
        "life-sample-13",
        "life-sample-14",
        "life-sample-15",
        "life-sample-17",
      ].includes(i.id)
    )
      return undefined;
    return i.photo?.startsWith("/api/life/media/")
      ? i.photo.replace(/actor=[^&]+/, `actor=${actor}`)
      : i.photo;
  }
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
                alt={i.synthetic ? `${i.name} · 分类示意照` : i.name}
              />
            ) : (
              <div className="life-photo-placeholder">
                <Package size={44} />
                <span>等你留下一张照片</span>
              </div>
            )}
            <span className="life-image-label">
              {i.synthetic || i.source === "示例数据"
                ? "合成案例 · 分类示意照"
                : "我的物品"}
            </span>
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
    <div className="life-shell">
      <header className="life-header">
        <button className="life-brand" onClick={() => go("home")}>
          <span>物间</span>
          <small>WU JIAN · LIFE, WITH THINGS</small>
        </button>
        <nav aria-label="主要导航">
          {nav.map(([v, label, Icon]) => (
            <button
              className={view === v ? "active" : ""}
              key={v}
              onClick={() => go(v)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        {publicMode ? (
          <span className="life-actor">我的演示空间</span>
        ) : (
          <label className="life-actor">
            <span>本机演示身份</span>
            <select
              aria-label="演示家庭成员"
              value={actor}
              onChange={(e) => setActor(e.target.value as Person)}
            >
              {Object.entries(people).map(([id, n]) => (
                <option key={id} value={id}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      <main className="life-main">
        <div className="life-topline">
          <span>把日常用好，把生活留住。</span>
          <button onClick={() => go("add")}>
            <Plus size={16} />
            录入物品
          </button>
        </div>
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
        {data && (
          <details className="life-cloud-status">
            <summary>设置与 AI 状态</summary>
            <p>
              {data.capabilities.cloud.message}{" "}
              {!publicMode && <a href="/guide#cloud">本机配置与撤销</a>}
            </p>
            <p className="life-muted">
              官方资料按需联网，可在启动环境以 WUJIAN_ALLOW_PUBLIC_FETCH=false
              关闭；不会发送私人记忆。
            </p>
          </details>
        )}
        {!data ? (
          <div className="life-empty">正在打开你的生活展柜…</div>
        ) : (
          <>
            {view === "home" && (
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
                      <button className="life-text-link" onClick={() => ask()}>
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
                          alt={`${heroItem.name}${syntheticItem(heroItem) ? " · 合成案例分类示意照" : ""}`}
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
                          ? `${heroItem.name} · ${syntheticItem(heroItem) ? "合成案例示意照" : "我的物品照片"}`
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
                        (i, n, a) => a.findIndex((x) => x.id === i.id) === n,
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
                    <p>普通交流不必绑定物品。具体型号和资料会在需要时核对。</p>
                    <button className="button secondary" onClick={() => ask()}>
                      问物间
                    </button>
                    <small>{data.capabilities.cloud.message}</small>
                  </div>
                </section>
                {!items.some((i) => i.id === "life-sample-0") && (
                  <section className="life-demo-banner">
                    <div>
                      <h3>先用一组生活案例逛一逛</h3>
                      <p>
                        载入 20
                        件新增合成物品、公开资料绑定、旅行片段和家庭事项。不会冒充你的实际持有。
                      </p>
                    </div>
                    <button
                      disabled={busy}
                      onClick={async () => {
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
                      载入合成演示案例
                    </button>
                  </section>
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
                    <h1>问物间</h1>
                    <p>需要时使用相关物品和获准信息；普通聊天不必围绕物品。</p>
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
                  允许从这段对话整理待确认记忆（确认前不用于长期个性化；默认不发送历史记忆给云端）
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
                <AISettings actor={actor} />
                <AssistantConversation
                  key={actor + policy + askEntry.key}
                  actor={actor}
                  mode="auto"
                  initialQuestion={entryQuestion}
                  item={items.find((i) => i.id === askEntry.itemId)}
                  initialSessionId={askEntry.sessionId}
                  startFresh={askEntry.fresh}
                  allHistory
                  onSession={setAskSession}
                  uiContext={askEntry.origin}
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
                <div className="life-detail-hero">
                  <div className="life-detail-photo">
                    {photo(item) ? (
                      <img src={photo(item)} alt={item.name} />
                    ) : (
                      <Package size={90} />
                    )}
                  </div>
                  <div>
                    <span className="life-eyebrow">
                      {item.category} ·{" "}
                      {syntheticItem(item)
                        ? "合成案例 / 照片为示意"
                        : "物品档案"}
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
                          onClick={() =>
                            act(
                              "updateItem",
                              { itemId: item.id, shared: !item.shared },
                              item.shared
                                ? "已停止共享物品；私人故事仍独立"
                                : "已共享物品；私人故事没有随之共享",
                            )
                          }
                        >
                          {item.shared ? "停止家庭共享" : "共享给家庭"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
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
                    从它开始找玩法
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
                  <>
                    <p className="life-muted">
                      具体型号资料优先；无资料时说明未知。反馈来自本人报告，不能当作设备检测。
                    </p>
                    <div className="life-actions">
                      <button
                        onClick={() =>
                          ask(
                            "",
                            item.id,
                            undefined,
                            itemSessions.current[item.id],
                          )
                        }
                      >
                        在问物间继续
                      </button>
                    </div>
                    <AISettings
                      actor={actor}
                      item={item}
                      onChat={() =>
                        ask(
                          "想和你聊聊今天的事",
                          item.id,
                          undefined,
                          itemSessions.current[item.id],
                          true,
                        )
                      }
                    />
                    <AssistantConversation
                      key={actor + item.id}
                      onSession={(s) => {
                        if (s) itemSessions.current[item.id] = s.id;
                      }}
                      actor={actor}
                      item={item}
                      mode="auto"
                      uiContext={{ page: "item" }}
                      memoryPolicy="off"
                      onActivity={() => load().catch(() => {})}
                    />
                  </>
                )}
                {tab === "新玩法" && (
                  <Discovery
                    key={item.id}
                    itemId={item.id}
                    items={items}
                    ideas={data.ideas}
                    request={request}
                    refresh={load}
                    modelAvailable={data.capabilities.model}
                    onAsk={(context) =>
                      ask("继续这个目标，帮我进一步完善方案", item.id, context)
                    }
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
                <FamilyPanel
                  workspace={data.workspace}
                  actor={actor}
                  items={items}
                  act={act}
                  onItem={open}
                />
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
      <footer className="life-footer">
        <span>物间 · 用好物品，也留住生活。</span>
        <span>本机演示 / 真实资料、合成实例与创意候选分别标注</span>
        <a href="/legacy">旧版入口</a>
        <a href="/guide">操作指南</a>
      </footer>
    </div>
  );
}
