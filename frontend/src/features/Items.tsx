import { useEffect, useState } from "react";
import { App as AntApp } from "antd";
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
  Companion,
  EmptyState,
  ItemCard,
  ObjectVisual,
  Pill,
  presentation,
  safeDate,
} from "./shared";
import { navigate, type Route } from "./navigation";
import Care from "./Care";

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
    if (!houses.some((house) => house.id === houseId))
      setHouseId(houses[0]?.id || "");
  }, [workspace.households]);
  const house = houses.find((house) => house.id === houseId);
  const scope = route.scope || "household";
  const item = workspace.items.find((item) => item.id === route.itemId);
  const items = workspace.items.filter((item) =>
    scope === "personal"
      ? item.owner_id === user.id
      : house?.item_ids.includes(item.id),
  );
  const visible = items.filter((item) => {
    const info = presentation(item);
    return (
      (!query ||
        (item.name + item.avatar.nickname + item.product.model + info.location)
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
    navigate({ section: "items", scope, itemId: item.id });
  }
  return (
    <div className={`items-workspace ${item ? "has-detail" : ""}`}>
      <section className="items-browser">
        <div className="segmented" role="group" aria-label="物品范围">
          <button
            className={scope === "household" ? "active" : ""}
            onClick={() => {
              setFilter("all");
              setRoom("");
              navigate({ section: "items", scope: "household" });
            }}
          >
            家庭用品
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
            <button
              className="quiet-button"
              onClick={() => edit({ kind: "household" })}
            >
              <Users size={16} />
              成员与家庭
            </button>
            <button
              className="quiet-button"
              onClick={() => navigate({ section: "care" })}
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
                私人故事单独管理
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
                selected={item?.id === value.id}
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
      <aside className={`detail-pane ${item ? "visible" : ""}`}>
        {item ? (
          <ItemDetail
            item={item}
            workspace={workspace}
            user={user}
            refresh={refresh}
            edit={edit}
            ask={ask}
            task={task}
            device={device}
            onBack={() => navigate({ section: "items", scope })}
          />
        ) : (
          <>
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
                onItem={(id) =>
                  navigate({ section: "items", scope, itemId: id })
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
              onClick={() => edit({ kind: "reminder" })}
            >
              <Wrench size={18} />
              记录一件需要处理的事
            </button>
          </>
        )}
      </aside>
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
}: Omit<Props, "route"> & { item: Item; onBack: () => void }) {
  const [tab, setTab] = useState("story"),
    [more, setMore] = useState(false),
    [knowledge, setKnowledge] = useState<Record<string, unknown>[]>([]);
  const { message } = AntApp.useApp();
  const info = presentation(item),
    owned = item.owner_id === user.id;
  useEffect(() => {
    void request<Record<string, unknown>[]>(`/items/${item.id}/knowledge`)
      .then(setKnowledge)
      .catch(() => setKnowledge([]));
  }, [item.id, item.version]);
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
      <button className="back-link mobile-only" onClick={onBack}>
        <ArrowLeft size={18} />
        返回物品
      </button>
      <div className="detail-hero">
        <ObjectVisual item={item} />
      </div>
      <div className="detail-heading">
        <div>
          <h1>{item.name}</h1>
          <p>
            <MapPin size={16} />
            {info.location || item.product.model || "独一份的存在"}
          </p>
        </div>
        <span className="privacy-label">
          <LockKeyhole size={15} />
          {owned ? "私人介绍仅自己可见" : "获准共享的物品"}
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
          {item.kind === "nonstandard_object" ? "聊聊它" : "问问用法"}
        </button>
        <button
          className="primary-button"
          onClick={() => edit({ kind: "experience", item })}
        >
          记一段
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
          <button onClick={() => ask(item, "creative")}>
            <Sparkles size={17} />
            发现新玩法
          </button>
          {owned && (
            <>
              <button onClick={() => edit({ kind: "item", item })}>
                <Settings2 size={17} />
                物品与分身设置
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
              <button onClick={() => edit({ kind: "reminder", item })}>
                照顾与提醒
              </button>
              <button onClick={() => device(item)}>连接设备与探索</button>
            </>
          )}
        </div>
      )}
      {item.description && (
        <blockquote className="personal-story">
          <Companion small />
          <p>{item.description}</p>
        </blockquote>
      )}
      {item.avatar.enabled && (
        <div className="persona-strip">
          <Companion small />
          <div>
            <strong>{item.avatar.nickname || item.name}的分身</strong>
            <p>{item.avatar.personality || "相处时的样子，由你慢慢决定。"}</p>
          </div>
          <button className="quiet-button" onClick={() => ask(item, "persona")}>
            和它聊聊
          </button>
        </div>
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
          它的经历
        </Pill>
        <Pill active={tab === "knowledge"} onClick={() => setTab("knowledge")}>
          用法与资料
        </Pill>
        <Pill active={tab === "care"} onClick={() => setTab("care")}>
          照顾与历史
        </Pill>
      </div>
      {tab === "story" && (
        <div className="story-timeline">
          {experiences.map((exp) => (
            <button
              key={exp.id}
              onClick={() => edit({ kind: "experience", experience: exp })}
              disabled={exp.access === "shared"}
            >
              <span className="timeline-dot" />
              <time>{safeDate(exp.occurred_on)}</time>
              <strong>{exp.title}</strong>
              <p>{exp.text.slice(0, 180)}</p>
            </button>
          ))}
          {!experiences.length && (
            <p className="empty-note">它的第一段故事，可以从今天开始。</p>
          )}
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
          {knowledge.map((claim, index) => (
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
          {!knowledge.length && (
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
