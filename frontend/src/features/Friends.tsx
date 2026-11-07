import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Gift as GiftIcon,
  Link,
  Plus,
  Pencil,
  Trash2,
  Users,
} from "lucide-react";
import {
  request,
  type FriendSpace,
  type Item,
  type User,
  type Wish,
  type Workspace,
} from "../api";
import type { Editor } from "./Editors";
import { EmptyState, ItemCard, Pill, safeDate } from "./shared";
import { navigate, type Route } from "./navigation";
import GiftExperience from "./GiftExperience";
import { wishImage } from "./wishImages";

export default function Friends({
  workspace,
  user,
  route,
  edit,
  refresh,
  onItem,
  onCompanion,
  askText,
}: {
  workspace: Workspace;
  user: User;
  route: Route;
  edit: (editor: Editor) => void;
  refresh: () => Promise<unknown>;
  onItem: (id: string) => void;
  onCompanion: (item: Item, text?: string) => void;
  askText: (text: string) => void;
}) {
  const [tab, setTab] = useState("friends"),
    [space, setSpace] = useState<FriendSpace>(),
    [subtab, setSubtab] = useState("wishes");
  const [selected, setSelected] = useState<Wish>(),
    [giftId, setGiftId] = useState<string>();
  const gift = workspace.gifts.find((candidate) => candidate.id === giftId);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setSelected(undefined);
    setSpace(undefined);
    setError("");
    if (route.friendId)
      void request<FriendSpace>(`/friends/${route.friendId}/space`)
        .then((value) => { if (current) setSpace(value); })
        .catch((error) => { if (current) setError(error.message); });
    return () => { current = false; };
  }, [route.friendId, workspace]);
  async function action(operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const person = space?.person;
  function wishCards(wishes: Wish[], own = false) {
    return (
      <div className="wish-grid">
        {wishes.map((wish) => (
          <button
            key={wish.id}
            className={`wish-card ${selected?.id === wish.id ? "selected" : ""}`}
            onClick={() => setSelected(wish)}
          >
            <div className={`wish-visual ${wishImage(wish.title).framed ? "wish-photo-frame" : ""}`}>
              <img src={wishImage(wish.title).src} alt={wish.title} loading="lazy" />
            </div>
            <div>
              <h3>{wish.title}</h3>
              <p>{wish.note || "一个想要，慢慢了解"}</p>
              <small>
                {own
                  ? wish.visible_to_friends
                    ? "已向好友开放"
                    : "仅自己可见"
                  : "对方选择向好友分享"}
              </small>
            </div>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className={`friends-workspace ${selected ? "has-detail" : ""}`}>
      <section className="friends-main page-content">
        {person ? (
          <>
            <button
              className="back-link"
              onClick={() => {
                navigate({ section: "friends" });
                setSpace(undefined);
              }}
            >
              <ArrowLeft size={17} />
              返回朋友
            </button>
            <div className="friend-profile">
              <span className="person-avatar large">
                {person.display_name.slice(-1)}
              </span>
              <div>
                <h1>{person.display_name}的主页</h1>
                <p>看看TA想收到的礼物，也看看愿意与你分享的物与故事。</p>
              </div>
            </div>
            <div className="segmented">
              <button
                className={subtab === "wishes" ? "active" : ""}
                onClick={() => setSubtab("wishes")}
              >
                心愿单 {space.wishes.length}
              </button>
              <button
                className={subtab === "items" ? "active" : ""}
                onClick={() => setSubtab("items")}
              >
                分享的物品
              </button>
              <button
                className={subtab === "stories" ? "active" : ""}
                onClick={() => setSubtab("stories")}
              >
                故事
              </button>
            </div>
            {subtab === "wishes" && (
              <>
                <h2 className="subsection-heading">想收到的礼物</h2>
                {space.wishes.length ? (
                  wishCards(space.wishes)
                ) : (
                  <EmptyState title="对方还没有分享心愿">
                    没有公开的内容，不代表对方没有喜欢的东西。
                  </EmptyState>
                )}
              </>
            )}
            {subtab === "items" &&
              (space.items.length ? (
                <div className="item-grid">
                  {space.items.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onSelect={() => onItem(item.id)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState title="还没有向你开放的物品">
                  成为好友不会自动开放全部库存。
                </EmptyState>
              ))}
            {subtab === "stories" &&
              (space.experiences.length ? (
                <div className="shared-story-list">
                  {space.experiences.map((exp) => (
                    <article key={exp.id}>
                      <time>{safeDate(exp.occurred_on)}</time>
                      <h3>{exp.title}</h3>
                      <p>{exp.text}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState title="故事会在对方愿意分享时出现" />
              ))}
          </>
        ) : (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">THINGS THAT CONNECT US</span>
                <h1>朋友与心意</h1>
                <p>让熟悉的物，带去一点照顾和想念。</p>
              </div>
              <button
                className="primary-button"
                onClick={() => edit({ kind: "friend" })}
              >
                <Users size={18} />
                添加朋友
              </button>
            </div>
            <div className="filter-row">
              <Pill
                active={tab === "friends"}
                onClick={() => setTab("friends")}
              >
                朋友
              </Pill>
              <Pill active={tab === "gifts"} onClick={() => setTab("gifts")}>
                往来的心意
                {workspace.gifts.filter(
                  (g) => g.recipient.id === user.id && g.status === "pending",
                ).length > 0 && (
                  <b>
                    {
                      workspace.gifts.filter(
                        (g) =>
                          g.recipient.id === user.id && g.status === "pending",
                      ).length
                    }
                  </b>
                )}
              </Pill>
              <Pill active={tab === "wishes"} onClick={() => setTab("wishes")}>
                我的心愿
              </Pill>
            </div>
            {tab === "friends" && (
              <div className="friend-grid">
                {workspace.friends.map((friend) => (
                  <article key={friend.id} className="friend-card">
                    <button
                      className="friend-main-button"
                      disabled={!friend.accepted}
                      onClick={() => {
                        navigate({ section: "friends", friendId: friend.id });
                        setSubtab("wishes");
                      }}
                    >
                      <span className="person-avatar large">
                        {friend.display_name.slice(-1)}
                      </span>
                      <div>
                        <h2>{friend.display_name}</h2>
                        <p>
                          {friend.accepted
                            ? "看看TA想收到的礼物"
                            : friend.incoming
                              ? "希望和你相连"
                              : "等待对方接受"}
                        </p>
                      </div>
                      {friend.accepted && <ArrowRight size={18} />}
                    </button>
                    {!friend.accepted && friend.incoming && (
                      <button
                        className="primary-button"
                        disabled={busy}
                        onClick={() =>
                          void action(() =>
                            request(
                              `/friends/${friend.sender_id}/accept`,
                              "POST",
                            ),
                          )
                        }
                      >
                        接受邀请
                      </button>
                    )}
                  </article>
                ))}
                {!workspace.friends.length && (
                  <EmptyState
                    title="先认识一位朋友"
                    action={
                      <button
                        className="primary-button"
                        onClick={() => edit({ kind: "friend" })}
                      >
                        通过用户名邀请
                      </button>
                    }
                  />
                )}
              </div>
            )}
            {tab === "gifts" && (
              <div className="gift-grid">
                {workspace.gifts.map((gift) => (
                  <button
                    className="gift-card"
                    key={gift.id}
                    onClick={() => setGiftId(gift.id)}
                  >
                    <GiftIcon size={32} strokeWidth={1.2} />
                    <div>
                      <small>
                        {gift.recipient.id === user.id
                          ? `${gift.sender.display_name}送来的`
                          : `送给${gift.recipient.display_name}`}
                      </small>
                      <h3>{gift.snapshot.name}</h3>
                      <p>{gift.snapshot.message || "一份带着心意的礼物"}</p>
                      <span className="status-tag">
                        {(
                          {
                            pending: "等待接收",
                            accepted: "已数字接受",
                            declined: "已婉拒",
                            cancelled: "已取消",
                          } as Record<string, string>
                        )[gift.status] || gift.status}{" "}
                        · {gift.snapshot.experiences.length}段故事
                      </span>
                    </div>
                    <ArrowRight size={17} />
                  </button>
                ))}
                {!workspace.gifts.length && (
                  <EmptyState title="一份心意，也可以有自己的故事">
                    从你的一件物品开始，选择想送出的内容。
                  </EmptyState>
                )}
              </div>
            )}
            {tab === "wishes" && (
              <>
                <div className="subsection-heading">
                  <p>想要和已经拥有，是两回事。</p>
                  <button
                    className="soft-button"
                    onClick={() => edit({ kind: "wish" })}
                  >
                    <Plus size={17} />
                    记下一个心愿
                  </button>
                </div>
                {workspace.wishes.length ? (
                  wishCards(workspace.wishes, true)
                ) : (
                  <EmptyState title="有个喜欢的东西，可以先记在这里" />
                )}
              </>
            )}
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <aside className={`detail-pane ${selected ? "visible" : ""}`}>
        {selected ? (
          <>
            <button
              className="back-link mobile-only"
              onClick={() => setSelected(undefined)}
            >
              <ArrowLeft size={17} />
              返回心愿
            </button>
            <div className={`wish-detail-visual ${wishImage(selected.title).framed ? "wish-photo-frame" : ""}`}>
              <img src={wishImage(selected.title).src} alt={selected.title} />
            </div>
            <h1>{selected.title}</h1>
            <p className="wish-owner">
              {selected.user_id === user.id ? "我" : person?.display_name}
              加入了心愿单
            </p>
            <blockquote className="wish-note">
              {selected.note || "有个喜欢的东西，慢慢了解。"}
            </blockquote>
            {selected.url.startsWith("https://") && (
              <a
                className="source-link"
                href={selected.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Link size={18} />
                商品详情与链接
                <ArrowRight size={17} />
              </a>
            )}
            <button
              className="primary-button full-width"
              onClick={() =>
                askText(
                  `我想${selected.user_id === user.id ? "了解" : `送给${person?.display_name}`}「${selected.title}」，${selected.note}。先帮我看看需要核对哪些条件。`,
                )
              }
            >
              <GiftIcon size={19} />
              {selected.user_id === user.id
                ? "问问物伴是否适合"
                : "聊聊这份心意"}
            </button>
            <p className="form-note">
              这里只整理心意与条件，不代表已经购买、拥有或完成实物交付。
            </p>
            {selected.user_id === user.id && (
              <button className="soft-button" onClick={() => edit({ kind: "wish", wish: selected })}>
                <Pencil size={16} />编辑心愿与可见范围
              </button>
            )}
            {selected.user_id === user.id && (
              <button
                className="quiet-button"
                onClick={() =>
                  void action(async () => {
                    await request(`/wishes/${selected.id}`, "DELETE", {
                      expected_version: selected.version,
                    });
                    setSelected(undefined);
                  })
                }
              >
                <Trash2 size={16} />
                移除这个心愿
              </button>
            )}
          </>
        ) : (
          <div className="friends-rail">
            <GiftIcon size={42} strokeWidth={1} />
            <h2>把故事，一起传递</h2>
            <p>物品、回忆和私人理解分别授权。朋友只看到你主动选择的内容。</p>
            <button
              className="soft-button"
              onClick={() => navigate({ section: "items", scope: "personal" })}
            >
              从我的物品挑一件
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </aside>
      {gift && <GiftExperience key={gift.id} gift={gift} userId={user.id} workspace={workspace}
        refresh={refresh} onClose={() => setGiftId(undefined)} onItem={onItem} onCompanion={onCompanion} />}
    </div>
  );
}
