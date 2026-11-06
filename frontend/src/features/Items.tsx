import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ChevronDown,
  Gift,
  Heart,
  LockKeyhole,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Search,
  Settings2,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import { request, type Item, type User, type Workspace } from "../api";
import type { Editor } from "./Editors";
import {
  attentionLabels,
  EmptyState,
  ItemCard,
  ObjectVisual,
  Pill,
  presentation,
  safeDate,
} from "./shared";
import { navigate, type Route } from "./navigation";
import Care from "./Care";
import FamilyMemories from "./FamilyMemories";
import { ObjectCompanion, PersonaGrowth } from "./ObjectCompanion";

type Props = {
  workspace: Workspace;
  user: User;
  route: Route;
  refresh: () => Promise<unknown>;
  edit: (editor: Editor) => void;
  ask: (item: Item, intent?: string) => void;
  task: (id: string) => void;
  device: (item: Item) => void;
};
export default function Items({
  workspace,
  user,
  route,
  refresh,
  edit,
  ask,
  task,
  device,
}: Props) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [room, setRoom] = useState("");
  const houses = workspace.households.filter(
    (house) => house.membership === "active",
  );
  const [houseId, setHouseId] = useState(houses[0]?.id || "");
  useEffect(() => {
    if (route.householdId && houses.some((house) => house.id === route.householdId))
      setHouseId(route.householdId);
    else if (!houses.some((house) => house.id === houseId))
      setHouseId(houses[0]?.id || "");
  }, [workspace.households, route.householdId]);
  const house = houses.find((house) => house.id === route.householdId)
    || houses.find((house) => house.id === houseId) || houses[0];
  const scope = route.scope || "household";
  const item = workspace.items.find((item) => item.id === route.itemId);
  const items = workspace.items.filter((item) =>
    scope === "personal"
      ? item.owner_id === user.id && !workspace.households.some((family) => family.item_ids.includes(item.id))
      : house?.item_ids.includes(item.id),
  );
  const visible = items.filter((item) => {
    const info = presentation(item);
    return (
      (!query ||
        (item.name + item.avatar.nickname + item.product.brand + item.product.commercial_name + item.product.model + info.location)
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!room || info.location === room) &&
      (filter === "all" ||
        (filter === "attention" &&
          ["paused", "needs_check"].includes(info.attention)) ||
        (filter === "stock" && info.attention === "needs_restock") ||
        (filter === "cherished" && info.cherished) ||
        (filter === "memories" &&
          workspace.experiences.some((exp) => exp.item_ids.includes(item.id))))
    );
  });
  const pending = items.filter((item) =>
    ["paused", "needs_check"].includes(presentation(item).attention),
  ).length;
  const stock = items.filter(
    (item) => presentation(item).attention === "needs_restock",
  ).length;
  function select(item: Item) {
    navigate({ section: "items", scope, itemId: item.id,
      householdId: scope === "household" ? house?.id : undefined });
  }
  if (route.itemId) {
    return (
      <main className="item-profile-page" aria-label="物品名片">
        {item ? (
          <ItemDetail
            key={item.id}
            item={item}
            workspace={workspace}
            user={user}
            refresh={refresh}
            edit={edit}
            ask={ask}
            task={task}
            device={device}
            householdId={scope === "household" && house?.item_ids.includes(item.id) ? house.id : undefined}
            onBack={() => navigate({ section: "items", scope, householdId: scope === "household" ? house?.id : undefined })}
          />
        ) : (
          <EmptyState
            title="暂时无法打开这件物品"
            action={<button className="soft-button" onClick={() => navigate({ section: "items", scope, householdId: scope === "household" ? house?.id : undefined })}>返回物品</button>}
          >它可能已被移走，或共享权限已改变。</EmptyState>
        )}
      </main>
    );
  }
  return (
    <div className={`items-workspace ${scope === "personal" ? "personal-items" : ""}`}>
      <section className="items-browser">
        <div className="segmented" role="group" aria-label="物品范围">
          <button
            className={scope === "household" ? "active" : ""}
            onClick={() => {
              setFilter("all");
              setRoom("");
              navigate({ section: "items", scope: "household", householdId: house?.id });
            }}
          >
            家庭物品
          </button>
          <button
            className={scope === "personal" ? "active" : ""}
            onClick={() => {
              setFilter("all");
              setRoom("");
              navigate({ section: "items", scope: "personal" });
            }}
          >
            我的物品
          </button>
        </div>
        {scope === "household" && (
          <div className="mobile-household-tools">
            {houses.length > 1 && <select className="family-household-select" aria-label="选择家庭" value={house?.id || ""}
              onChange={(event) => {
                setHouseId(event.target.value); setFilter("all"); setRoom("");
                navigate({ section: "items", scope: "household", householdId: event.target.value });
              }}>
              {houses.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
            </select>}
            <button
              className="quiet-button"
              onClick={() => edit({ kind: "household" })}
            >
              <Users size={16} />
              成员与家庭
            </button>
            <button
              className="quiet-button"
              onClick={() => navigate({ section: "care", householdId: house?.id })}
            >
              共同照顾的事
              <ArrowRight size={16} />
            </button>
          </div>
        )}
        <div className="items-toolbar">
          <label className="search-field">
            <Search size={20} />
            <input
              aria-label="查找物品"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                scope === "household" ? "找家里的东西" : "找自己的东西"
              }
            />
          </label>
          {scope === "household" && (
            <select
              aria-label="筛选房间"
              className="room-filter"
              value={room}
              onChange={(event) => setRoom(event.target.value)}
            >
              <option value="">所有房间</option>
              {[
                ...new Set(
                  items
                    .map((item) => presentation(item).location)
                    .filter(Boolean),
                ),
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          )}
        </div>
        <div className="filter-row">
          <Pill active={filter === "all"} onClick={() => setFilter("all")}>
            全部
          </Pill>
          {scope === "household" ? (
            <>
              <Pill
                active={filter === "attention"}
                onClick={() => setFilter("attention")}
              >
                待处理{pending > 0 && <b>{pending}</b>}
              </Pill>
              <Pill
                active={filter === "stock"}
                onClick={() => setFilter("stock")}
              >
                待补充{stock > 0 && <b>{stock}</b>}
              </Pill>
            </>
          ) : (
            <>
              <Pill
                active={filter === "cherished"}
                onClick={() => setFilter("cherished")}
              >
                珍藏
              </Pill>
              <Pill
                active={filter === "memories"}
                onClick={() => setFilter("memories")}
              >
                回忆
              </Pill>
              <span className="scope-note">
                <LockKeyhole size={14} />
                未加入家庭的私人物品
              </span>
            </>
          )}
        </div>
        {visible.length ? (
          <div className="item-grid">
            {visible.map((value) => (
              <ItemCard
                key={value.id}
                item={value}
                onSelect={() => select(value)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title={
              scope === "household" && !house
                ? "一起照看一个家"
                : "这里暂时还没有物品"
            }
            action={
              <button
                className="primary-button"
                onClick={() =>
                  edit({
                    kind:
                      scope === "household" && !house ? "household" : "item",
                  })
                }
              >
                <Camera size={18} />
                {scope === "household" && !house
                  ? "创建或加入家庭"
                  : "记一件物品"}
              </button>
            }
          >
            {query || filter !== "all"
              ? "换个关键词或筛选条件看看。"
              : "可以先从一件熟悉的东西开始。"}
          </EmptyState>
        )}
        {scope === "household" &&
          workspace.households.some(
            (house) => house.membership === "invited",
          ) && (
            <button
              className="invitation-banner"
              onClick={() => edit({ kind: "household" })}
            >
              <Users size={18} />
              你有一份家庭邀请，查看并选择是否加入
              <ArrowRight size={16} />
            </button>
          )}
      </section>
      {scope === "household" && <aside className="detail-pane">
            <section className="rail-section">
              <div className="section-title">
                <h2>一起照看这个家</h2>
                <button
                  className="icon-button"
                  title="管理家庭成员"
                  onClick={() => edit({ kind: "household" })}
                >
                  <Settings2 size={18} />
                </button>
              </div>
              {houses.length > 1 && (
                <select
                  aria-label="当前家庭"
                  value={houseId}
                  onChange={(event) => setHouseId(event.target.value)}
                >
                  {houses.map((house) => (
                    <option key={house.id} value={house.id}>
                      {house.name}
                    </option>
                  ))}
                </select>
              )}
              <div className="member-avatars">
                {house?.members
                  .filter((member) => member.status === "active")
                  .map((member) => (
                    <button
                      key={member.id}
                      title={member.display_name}
                      onClick={() => edit({ kind: "household" })}
                    >
                      <span className="person-avatar">
                        {member.display_name.slice(-1)}
                      </span>
                      <small>{member.display_name}</small>
                    </button>
                  ))}
              </div>
              {!house && (
                <p className="muted">
                  好友和家庭成员分别授权，加入后再选择共同物品。
                </p>
              )}
            </section>
            <section className="rail-section">
              <h2>需要处理</h2>
              <Care
                workspace={workspace}
                user={user}
                refresh={refresh}
                onItem={(id, reminderHouseholdId) =>
                  navigate({ section: "items", scope, itemId: id, householdId: reminderHouseholdId || house?.id })
                }
                householdId={house?.id}
                compact
              />
            </section>
            {items
              .filter((item) => presentation(item).attention === "paused")
              .slice(0, 1)
              .map((item) => (
                <button
                  className="attention-summary"
                  key={item.id}
                  onClick={() => select(item)}
                >
                  <ObjectVisual item={item} />
                  <div>
                    <strong>{item.name}还需要留意</strong>
                    <p>{presentation(item).note || "处理前先暂停使用。"}</p>
                  </div>
                </button>
              ))}
            <button
              className="primary-button full-width"
              onClick={() => edit({ kind: "reminder", householdId: house?.id })}
            >
              <Wrench size={18} />
              记录一件需要处理的事
            </button>
      </aside>}
    </div>
  );
}

function ItemDetail({
  item,
  workspace,
  user,
  refresh,
  edit,
  ask,
  task,
  device,
  onBack,
  householdId,
}: Omit<Props, "route"> & { item: Item; onBack: () => void; householdId?: string }) {
  const [growthBusy, setGrowthBusy] = useState(false);
  const [growthError, setGrowthError] = useState("");
  async function changeGrowth(change: { growth_enabled?: boolean; growth_dismissed_ids?: string[] }) {
    if (growthBusy) return;
    setGrowthBusy(true);
    setGrowthError("");
    try {
      await request(`/items/${item.id}`, "PUT", {
        name: item.name, kind: item.kind, product: item.product,
        description: item.description, photo_id: item.photo_id, state: item.state,
        expected_version: item.version,
        avatar: {
          enabled: item.avatar.enabled, form: item.avatar.form,
          nickname: item.avatar.nickname, personality: item.avatar.personality,
          color: item.avatar.color, growth_enabled: item.avatar.growth_enabled,
          growth_dismissed_ids: item.avatar.growth_dismissed_ids, ...change,
        },
      });
      await refresh();
    } catch (error) {
      setGrowthError((error as Error).message);
    } finally {
      setGrowthBusy(false);
    }
  }
  const [tab, setTab] = useState("story"),
    [more, setMore] = useState(false),
    [attempt, setAttempt] = useState(0),
    [knowledge, setKnowledge] = useState<{
      identity: string;
      rows: Record<string, unknown>[];
      error: string;
      loading: boolean;
    }>({ identity: "", rows: [], error: "", loading: true });
  const info = presentation(item),
    owned = item.owner_id === user.id;
  useEffect(() => {
    let current = true;
    const identity = `${item.id}:${item.version}`;
    setKnowledge({ identity, rows: [], error: "", loading: true });
    void request<Record<string, unknown>[]>(`/items/${item.id}/knowledge`)
      .then((rows) => {
        if (current) setKnowledge({ identity, rows, error: "", loading: false });
      })
      .catch((error: Error) => {
        if (current) setKnowledge({ identity, rows: [], error: error.message, loading: false });
      });
    return () => { current = false; };
  }, [item.id, item.version, attempt]);
  const knowledgeCurrent = knowledge.identity === `${item.id}:${item.version}`;
  const experiences = workspace.experiences.filter((exp) =>
    exp.item_ids.includes(item.id),
  );
  const tasks = workspace.tasks.filter(
    (task) =>
      task.item_ids.includes(item.id) &&
      !["completed", "cancelled"].includes(task.status),
  );
  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={18} />
        返回物品
      </button>
      <div className="detail-hero">
        {!item.photo_id && item.avatar.enabled ? (
          <div className="detail-companion-hero">
            <ObjectCompanion item={item} size={220} className="object-companion-alive" />
            <small>{item.avatar.nickname || item.name} · 物品分身</small>
          </div>
        ) : <ObjectVisual item={item} />}
      </div>
      <div className="detail-heading">
        <div>
          <h1>{item.name}</h1>
          {item.kind === "standard_product" && item.product.model && (
            <p>{[item.product.brand, item.product.commercial_name, item.product.model].filter(Boolean).join(" · ")}</p>
          )}
          <p>
            <MapPin size={16} />
            {info.location || item.product.model || "独一份的存在"}
          </p>
        </div>
        <span className="privacy-label">
          <LockKeyhole size={15} />
          {householdId ? "家庭共享物品 · 回忆另选范围" : owned ? "私人介绍仅自己可见" : "获准共享的物品"}
        </span>
      </div>
      {info.attention !== "normal" && (
        <div className="item-attention">
          <span className={`status-tag ${info.attention}`}>
            {attentionLabels[info.attention]}
          </span>
          <span>{info.note || "使用前请先核对当前状态。"}</span>
        </div>
      )}
      <div className="detail-actions">
        <button
          className="soft-button"
          onClick={() =>
            ask(
              item,
              item.kind === "nonstandard_object" ? "general" : "guidance",
            )
          }
        >
          <MessageCircle size={18} />
          {item.kind === "nonstandard_object" ? "问问这件物" : "问问用法"}
        </button>
        <button
          className="soft-button"
          onClick={() => ask(item, "creative")}
        >
          <Sparkles size={18} />
          发现新玩法
        </button>
        <button
          className="primary-button"
          onClick={() => edit({ kind: "experience", item, householdId })}
        >
          {householdId ? "和家人记一段" : "记一段"}
        </button>
        <button
          className="icon-button"
          title="更多物品操作"
          aria-expanded={more}
          onClick={() => setMore(!more)}
        >
          <MoreHorizontal size={22} />
        </button>
      </div>
      {more && (
        <div className="detail-more">
          {owned && (
            <>
              <button onClick={() => edit({ kind: "item", item })}>
                <Settings2 size={17} />
                编辑物品资料
              </button>
              <button onClick={() => edit({ kind: "presentation", item })}>
                <MapPin size={17} />
                位置与当前状态
              </button>
              <button onClick={() => edit({ kind: "sharing", item })}>
                <Users size={17} />
                共享与家庭用品
              </button>
              <button onClick={() => edit({ kind: "gift", item })}>
                <Gift size={17} />
                送出这件物品
              </button>
              <button onClick={() => edit({ kind: "reminder", item, householdId })}>
                照顾与提醒
              </button>
              <button onClick={() => device(item)}>让它更合心意</button>
            </>
          )}
          {householdId && !owned && <button onClick={() => edit({ kind: "reminder", item, householdId })}>给家人留个提醒</button>}
        </div>
      )}
      {item.avatar.enabled && (
        <div className="persona-strip">
          {item.photo_id && <ObjectCompanion item={item} size={80} />}
          <div className="persona-identity">
            <strong>{item.avatar.nickname || item.name}</strong>
            <p>{item.avatar.personality || "相处时的样子，由你慢慢决定。"}</p>
            {owned && <PersonaGrowth avatar={item.avatar} busy={growthBusy}
              onToggle={(enabled) => { void changeGrowth({ growth_enabled: enabled }); }}
              onDismiss={(id) => { void changeGrowth({ growth_dismissed_ids:
                [...new Set([...(item.avatar.growth_dismissed_ids || []), id])] }); }}
              onExperience={(id) => navigate({ section: "memories", itemId: item.id, experienceId: id })} />}
            {growthError && <p className="inline-error" role="alert">{growthError}</p>}
          </div>
          <div className="persona-strip-actions">
            <button className="soft-button" onClick={() => ask(item, "persona")}>
              和它聊聊
            </button>
            {owned && <button className="quiet-button" onClick={() => edit({ kind: "persona", item })}>它的模样与性格</button>}
          </div>
        </div>
      )}
      {item.description && (
        <blockquote className="personal-story">
          <p>{item.description}</p>
        </blockquote>
      )}
      {!item.avatar.enabled && owned && (
        <button className="persona-invitation" onClick={() => edit({ kind: "persona", item })}>
          <Heart size={19} strokeWidth={1.5} />
          <span>给它一个分身<small>有些东西，也可以成为陪伴。</small></span>
          <ArrowRight size={17} />
        </button>
      )}
      {!!tasks.length && (
        <section className="related-tasks">
          <h3>正在做的事</h3>
          {tasks.map((value) => (
            <button key={value.id} onClick={() => task(value.id)}>
              {value.goal}
              <ArrowRight size={16} />
            </button>
          ))}
        </section>
      )}
      <div className="detail-tabs">
        <Pill active={tab === "story"} onClick={() => setTab("story")}>
          {householdId ? "家庭共同回忆" : "它的经历"}
        </Pill>
        <Pill active={tab === "knowledge"} onClick={() => setTab("knowledge")}>
          用法与资料
        </Pill>
        <Pill active={tab === "care"} onClick={() => setTab("care")}>
          照顾与历史
        </Pill>
      </div>
      {tab === "story" && householdId && <FamilyMemories workspace={workspace} item={item} householdId={householdId} edit={edit} />}
      {tab === "story" && !householdId && (
        <div className="story-timeline">
          {experiences.map((exp) => (
            <button
              key={exp.id}
              onClick={() => navigate({ section: "memories", experienceId: exp.id })}
            >
              <span className="timeline-dot" />
              <time>{safeDate(exp.occurred_on)}</time>
              <strong>{exp.title}</strong>
              <p>{exp.text.slice(0, 180)}</p>
              <small>{exp.origin_id ? "随礼物收到的故事 · 保留原作者" : exp.access === "shared" ? "朋友分享的经历" : "我记录的回忆"}</small>
            </button>
          ))}
          {!experiences.length && (
            <p className="empty-note">它的第一段故事，可以从今天开始。</p>
          )}
          {!!experiences.length && <button className="quiet-button" onClick={() => navigate({ section: "memories" })}>去回忆墙看看 <ArrowRight size={16} /></button>}
        </div>
      )}
      {tab === "knowledge" && (
        <section className="knowledge-section">
          <dl>
            <dt>品牌／型号</dt>
            <dd>
              {[item.product.brand, item.product.model]
                .filter(Boolean)
                .join(" · ") || "尚待确认"}
            </dd>
            <dt>地区／版本</dt>
            <dd>
              {[
                item.product.market,
                item.product.edition,
                item.product.firmware_version,
              ]
                .filter(Boolean)
                .join(" · ") || "尚待确认"}
            </dd>
          </dl>
          {(!knowledgeCurrent || knowledge.loading) && <p className="empty-note" role="status">正在读取这件物品的资料…</p>}
          {knowledgeCurrent && knowledge.error && (
            <div className="inline-error" role="alert">
              <p>资料暂时没有读取成功：{knowledge.error}</p>
              <button className="quiet-button" onClick={() => setAttempt((value) => value + 1)}>重新读取</button>
            </div>
          )}
          {knowledgeCurrent && knowledge.rows.map((claim, index) => (
            <article key={String(claim.id || index)}>
              <strong>{String(claim.content || "")}</strong>
              <p>{String(claim.source_quote || "")}</p>
              <small>
                {claim.basis === "document"
                  ? "资料中的依据，仍须核对适用条件"
                  : "来自用户报告或待核实认识"}
              </small>
            </article>
          ))}
          {knowledgeCurrent && !knowledge.loading && !knowledge.error && !knowledge.rows.length && (
            <p className="empty-note">
              尚未取得适用资料，先确认型号，再核对具体用法。
            </p>
          )}
          <button className="soft-button" onClick={() => ask(item, "guidance")}>
            和物伴一起核对用法
            <ArrowRight size={16} />
          </button>
        </section>
      )}
      {tab === "care" && (
        <>
          <Care
            workspace={{
              ...workspace,
              reminders: workspace.reminders.filter(
                (value) => value.item_id === item.id,
              ),
            }}
            user={user}
            refresh={refresh}
            onItem={() => {}}
            householdId={householdId}
          />
          <p className="form-note">
            处理反馈和实物状态分别保留，需要改变状态时再明确更新。
          </p>
          {owned && (
            <button
              className="soft-button"
              onClick={() => edit({ kind: "presentation", item })}
            >
              更新实际状态
            </button>
          )}
        </>
      )}
      {owned && (
        <button
          className="keep-record"
          onClick={() => edit({ kind: "presentation", item })}
        >
          实物不在了，也可以保留记录
          <ArrowRight size={17} />
        </button>
      )}
    </>
  );
}
