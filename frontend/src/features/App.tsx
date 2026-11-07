import { useEffect, useRef, useState } from "react";
import { App as AntApp } from "antd";
import {
  ArrowLeft,
  BookHeart,
  Camera,
  ChevronDown,
  Coffee,
  Gift,
  Menu,
  MessageCircle,
  Package,
  Plus,
  Settings,
  Sparkles,
  TreePine,
  Users,
  X,
} from "lucide-react";
import {
  request,
  upload,
  type ChatMessage,
  type Conversation as Thread,
  type EntryContext,
  type Health,
  type Item,
  type Run,
  type TaskBoard as Board,
  type User,
} from "../api";
import DeviceConnection from "../DeviceConnection";
import SignIn from "./SignIn";
import Editors, { type Editor } from "./Editors";
import Conversation, { type Draft } from "./Conversation";
import Items from "./Items";
import Memories from "./Memories";
import Friends from "./Friends";
import Care from "./Care";
import CreativeSources from "./CreativeSources";
import { TaskCanvas, TaskRail, GuidanceTools } from "./TaskBoard";
import { Companion, ObjectVisual, presentation } from "./shared";
import { navigate, useRoute, useWorkspace, type Section } from "./navigation";

export default function App() {
  const [user, setUser] = useState<User | null>(),
    [health, setHealth] = useState<Health>();
  useEffect(() => {
    void request<Health>("/health")
      .then(setHealth)
      .catch(() => {});
    void request<User>("/me")
      .then(setUser)
      .catch(() => setUser(null));
  }, []);
  if (user === undefined)
    return (
      <div className="loading-screen">
        <Companion small />
        <p>正在打开你的物间…</p>
      </div>
    );
  if (!user) return <SignIn health={health} onLogin={setUser} />;
  return (
    <WorkspaceApp
      key={user.id}
      user={user}
      health={health}
      onLogout={() => setUser(null)}
    />
  );
}

const navigation = [
  { key: "companion" as Section, label: "物伴", Icon: MessageCircle },
  { key: "items" as Section, label: "物品", Icon: Package },
  { key: "memories" as Section, label: "回忆", Icon: BookHeart },
  { key: "friends" as Section, label: "朋友", Icon: Users },
];
type Context = { itemIds: string[]; entry: EntryContext };
function WorkspaceApp({
  user,
  health,
  onLogout,
}: {
  user: User;
  health?: Health;
  onLogout: () => void;
}) {
  const { workspace, refresh, error } = useWorkspace(user),
    route = useRoute();
  const { message } = AntApp.useApp();
  const [editor, setEditor] = useState<Editor>(),
    [device, setDevice] = useState<Item>(),
    [sidebar, setSidebar] = useState(false);
  const [threadId, setThreadId] = useState<string>(),
    [messages, setMessages] = useState<ChatMessage[]>([]),
    [run, setRun] = useState<Run | null>(null);
  const [context, setContext] = useState<Context>({
      itemIds: [],
      entry: { intent: "general" },
    }),
    [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [board, setBoard] = useState<Board>(),
    [sending, setSending] = useState(false);
  const source = useRef<EventSource | null>(null),
    file = useRef<HTMLInputElement>(null),
    opening = useRef(""),
    currentThread = useRef<string | undefined>(undefined);
  const draftKey =
    threadId || `new:${context.entry.intent}:${context.itemIds.join(",")}`;
  const draft = drafts[draftKey] || { text: "", photos: [] };
  const large = workspace?.preferences.display_mode === "large",
    companionName = workspace?.preferences.companion_name || "阿圆";
  currentThread.current = threadId;
  function setDraft(value: Draft) {
    setDrafts((previous) => ({ ...previous, [draftKey]: value }));
  }
  function stopWatching() {
    source.current?.close();
    source.current = null;
  }
  useEffect(() => () => stopWatching(), []);
  async function updateMessages(identity: string) {
    const next = await request<ChatMessage[]>(
      `/conversations/${identity}/messages`,
    );
    if (currentThread.current === identity) setMessages(next);
  }
  function watch(
    initial: Run,
    taskId: string | null | undefined = context.entry.task_id,
  ) {
    stopWatching();
    setRun(initial);
    const settle = (value: Run) => {
      void updateMessages(value.conversation_id);
      void refresh()
        .then((nextWorkspace) => {
          const live = nextWorkspace.conversations.find((thread) => thread.id === value.conversation_id);
          if (currentThread.current !== value.conversation_id) return;
          if (live) setContext({itemIds: live.item_ids, entry: live.entry_context as EntryContext});
          const continued = [...value.events]
            .reverse()
            .find((event) => event.type === "continuation_saved")?.task_id;
          const nextTask =
            (typeof continued === "string" ? continued : live ? live.entry_context?.task_id as string | undefined : taskId) || undefined;
          if (!nextTask) setBoard(undefined);
          if (nextTask)
            void request<Board>(`/tasks/${nextTask}/board`)
              .then((next) => {
                if (currentThread.current === value.conversation_id) {
                  setBoard(next);
                  setContext((previous) => ({
                    ...previous,
                    itemIds: next.task.item_ids,
                    entry: { ...previous.entry, task_id: nextTask },
                  }));
                }
              })
              .catch(() => setBoard(undefined));
        })
        .catch(() => {});
    };
    if (!["queued", "running"].includes(initial.status)) {
      settle(initial);
      return;
    }
    const eventSource = new EventSource(`/api/runs/${initial.id}/events`);
    source.current = eventSource;
    eventSource.onmessage = (event) => {
      const value = JSON.parse(event.data) as Run;
      if (currentThread.current !== value.conversation_id) return;
      setRun(value);
      if (!["queued", "running"].includes(value.status)) {
        eventSource.close();
        settle(value);
      }
    };
    eventSource.onerror = () => {
      // Keep EventSource's automatic reconnection after a temporary loss.
      void request<Run>(`/runs/${initial.id}`)
        .then((value) => {
          if (currentThread.current === value.conversation_id) {
            setRun(value);
            if (!["queued", "running"].includes(value.status)) {
              eventSource.close();
              settle(value);
            }
          }
        })
        .catch(() => {});
    };
  }
  async function openThread(identity: string, override?: Context) {
    stopWatching();
    currentThread.current = identity;
    setThreadId(identity);
    setRun(null);
    setMessages([]);
    setSidebar(false);
    const thread = workspace?.conversations.find(
      (thread) => thread.id === identity,
    );
    const nextContext = override || {
      itemIds: thread?.item_ids || [],
      entry: (thread?.entry_context || { intent: "general" }) as EntryContext,
    };
    setContext(nextContext);
    if (!nextContext.entry.task_id) setBoard(undefined);
    navigate({
      section: "companion",
      taskId: nextContext.entry.task_id || undefined,
    });
    try {
      const history = await request<ChatMessage[]>(
        `/conversations/${identity}/messages`,
      );
      if (currentThread.current !== identity) return;
      setMessages(history);
      const last = history.at(-1);
      if (last?.run_id)
        watch(
          await request<Run>(`/runs/${last.run_id}`),
          nextContext.entry.task_id || null,
        );
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  function newTopic(itemIds: string[] = [], intent = "general", text = "") {
    stopWatching();
    currentThread.current = undefined;
    setThreadId(undefined);
    setMessages([]);
    setRun(null);
    setBoard(undefined);
    const entry = { intent } as EntryContext;
    setContext({ itemIds, entry });
    setDrafts((previous) => {
      const key = `new:${intent}:${itemIds.join(",")}`;
      const saved = previous[key];
      return {
        ...previous,
        [key]:
          saved && (saved.text.trim() || saved.photos.length)
            ? saved
            : { text, photos: [] },
      };
    });
    navigate({ section: "companion" });
    setSidebar(false);
  }
  async function openTask(identity: string) {
    if (opening.current === identity) return;
    opening.current = identity;
    try {
      const next = await request<Board>(`/tasks/${identity}/board`);
      setBoard(next);
      const resumed = await request<{
        conversation_id: string;
        entry_context: EntryContext;
      }>(`/tasks/${identity}/conversation`, "POST");
      await openThread(resumed.conversation_id, {
        itemIds: next.task.item_ids,
        entry: { ...resumed.entry_context, task_id: identity },
      });
      setBoard(next);
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
      navigate({ section: "companion" });
    } finally {
      opening.current = "";
    }
  }
  useEffect(() => {
    if (
      route.section === "companion" &&
      route.taskId &&
      board?.task.id !== route.taskId
    )
      void openTask(route.taskId);
  }, [route.taskId, route.section]);
  async function send() {
    if (
      sending ||
      (run && ["running", "queued"].includes(run.status)) ||
      (!draft.text.trim() && !draft.photos.length)
    )
      return;
    setSending(true);
    const original = { ...draft };
    try {
      const next =
        context.entry.intent === "creative" && !threadId
          ? await request<Run>("/creative-explorations", "POST", {
              goal:
                original.text ||
                "看看照片中的东西还能怎么玩，先核对识别和实际条件。",
              item_ids: context.itemIds,
              photo_ids: original.photos,
            })
          : await request<Run>("/chat", "POST", {
              text: original.text,
              photo_ids: original.photos,
              conversation_id: threadId || null,
              item_ids: context.itemIds,
              entry_context: context.entry,
            });
      currentThread.current = next.conversation_id;
      setThreadId(next.conversation_id);
      setDrafts((previous) => ({
        ...previous,
        [draftKey]: { text: "", photos: [] },
        [next.conversation_id]: { text: "", photos: [] },
      }));
      await updateMessages(next.conversation_id);
      watch(next);
      await refresh();
    } catch (error) {
      setDraft(original);
      message.error(
        health?.model_configured
          ? (error as Error).message
          : "对话服务暂不可用，草稿已保留；物品和回忆仍可使用。",
      );
    } finally {
      setSending(false);
    }
  }
  async function addPhoto(selected?: File) {
    if (!selected) return;
    const key = draftKey;
    try {
      const result = await upload(selected);
      setDrafts((previous) => {
        const current = previous[key] || { text: "", photos: [] };
        return {
          ...previous,
          [key]: {
            ...current,
            photos: [...current.photos, result.id].slice(-4),
          },
        };
      });
      navigate({
        section: "companion",
        taskId: context.entry.task_id || undefined,
      });
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  function ask(item: Item, intent = "general") {
    newTopic(
      [item.id],
      intent,
      intent === "guidance"
        ? `我想了解${item.name}的用法，请先核对型号、现状和适用资料。`
        : intent === "creative"
          ? `用${item.name}还能做些什么？请结合已有物品与我的实际条件，一起找找新玩法。`
          : intent === "persona"
            ? "想和你聊聊今天的事。"
            : `想聊聊${item.name}。`,
    );
  }
  function onItem(identity: string) {
    navigate({
      section: "items",
      scope:
        workspace?.items.find((item) => item.id === identity)?.owner_id ===
        user.id
          ? "personal"
          : "household",
      itemId: identity,
    });
  }
  async function changeMode(value: string) {
    if (!workspace) return;
    try {
      await request("/preferences", "PUT", {
        ...workspace.preferences,
        display_mode: value,
      });
      await refresh();
      if (value === "large") navigate({ section: "companion" });
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  async function logout() {
    try {
      await request("/auth/logout", "POST");
      stopWatching();
      onLogout();
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  if (!workspace)
    return (
      <div className="loading-screen">
        <Companion small />
        <p>{error || "正在整理你的物与经历…"}</p>
        {error && (
          <button
            className="soft-button"
            onClick={() => void refresh().catch(() => {})}
          >
            再试一次
          </button>
        )}
      </div>
    );
  const focusedItem = workspace.items.find((item) =>
    context.itemIds.includes(item.id),
  );
  const title =
    route.section === "companion"
      ? board?.task.goal ||
        workspace.conversations.find((thread) => thread.id === threadId)
          ?.title ||
        `和${companionName}聊聊`
      : (
          {
            items: "物品",
            memories: "回忆",
            friends: "朋友",
            care: "家人提醒",
          } as Record<string, string>
        )[route.section];
  const boardActions = board
    ? {
        board,
        workspace,
        user,
        update: setBoard,
        refresh,
        onItem,
        onCamera: () => file.current?.click(),
        running: !!run && ["queued", "running"].includes(run.status),
        onRun: async (next: Run) => {
          await openThread(next.conversation_id, {
            itemIds: board.task.item_ids,
            entry: { intent: "guidance", task_id: board.task.id },
          });
          watch(next, board.task.id);
        },
      }
    : undefined;
  return (
    <div
      className={`app-shell ${large ? "large-mode" : ""} ${sidebar ? "sidebar-open" : ""}`}
    >
      <aside className="sidebar">
        <a className="brand" href="#companion">
          <strong>物间</strong>
          <span>和生活里的东西好好相处</span>
        </a>
        <button
          className="icon-button mobile-only sidebar-close"
          onClick={() => setSidebar(false)}
          aria-label="关闭导航"
        >
          <X size={20} />
        </button>
        <nav className="primary-navigation">
          {(large
            ? [
                {
                  key: "companion" as Section,
                  label: "问一问",
                  Icon: MessageCircle,
                },
                { key: "care" as Section, label: "家人提醒", Icon: BookHeart },
              ]
            : navigation
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              className={route.section === key ? "active" : ""}
              onClick={() => {
                navigate({
                  section: key,
                  taskId:
                    key === "companion"
                      ? context.entry.task_id || undefined
                      : undefined,
                });
                setSidebar(false);
              }}
            >
              <Icon size={23} strokeWidth={1.6} />
              {label}
            </button>
          ))}
        </nav>
        <section className="recent-topics">
          <div className="section-title">
            <h3>最近的对话</h3>
            <button
              className="icon-button"
              title="另起一个话题"
              onClick={() => newTopic()}
            >
              <Plus size={17} />
            </button>
          </div>
          {workspace.conversations.slice(0, 8).map((thread) => (
            <button
              key={thread.id}
              className={threadId === thread.id ? "active" : ""}
              onClick={() => void openThread(thread.id)}
            >
              <MessageCircle size={18} />
              <span>{thread.title}</span>
            </button>
          ))}
          {!workspace.conversations.length && (
            <p className="empty-note">从你此刻想做的事开始。</p>
          )}
        </section>
        <section className="sidebar-tasks">
          <div className="section-title">
            <h3>正在做的事</h3>
            <button
              className="icon-button"
              title="整理一件事"
              onClick={() => setEditor({ kind: "task" })}
            >
              <Plus size={17} />
            </button>
          </div>
          {workspace.tasks
            .filter((task) => !["completed", "cancelled"].includes(task.status))
            .slice(0, 5)
            .map((task) => (
              <button
                key={task.id}
                className={board?.task.id === task.id ? "active" : ""}
                onClick={() => void openTask(task.id)}
              >
                <span className="task-dot" />
                <span>{task.goal}</span>
              </button>
            ))}
        </section>
        <div className="sidebar-account">
          <span className="person-avatar">{user.display_name.slice(-1)}</span>
          <div>
            <strong>{user.display_name}</strong>
            <button className="quiet-button" onClick={() => void logout()}>
              退出／切换账号
            </button>
          </div>
          <button
            className="icon-button"
            title="个人设置与理解"
            onClick={() => setEditor({ kind: "settings" })}
          >
            <Settings size={21} />
          </button>
        </div>
      </aside>
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="关闭侧边导航"
          onClick={() => setSidebar(false)}
        />
      )}
      <div className="app-body">
        <header className="topbar">
          <div className="topbar-heading">
            <button
              className="icon-button mobile-only"
              title="历史与正在做的事"
              onClick={() => setSidebar(true)}
            >
              <Menu size={22} />
            </button>
            <h1>{title}</h1>
          </div>
          <div className="topbar-actions">
            <label className="mode-switch">
              <select
                aria-label="显示版本"
                value={large ? "large" : "normal"}
                onChange={(event) => void changeMode(event.target.value)}
              >
                <option value="normal">普通版</option>
                <option value="large">大字版</option>
              </select>
              <ChevronDown size={13} />
            </label>
            <span className="topbar-divider" />
            <button
              className="camera-action"
              onClick={() =>
                route.section === "items"
                  ? setEditor({ kind: "item" })
                  : route.section === "memories"
                    ? setEditor({ kind: "experience" })
                    : file.current?.click()
              }
            >
              <Camera size={22} />
              <span>
                {route.section === "items"
                  ? "记一件"
                  : route.section === "memories"
                    ? "记一刻"
                    : "拍一下"}
              </span>
            </button>
            <button
              className="avatar-button"
              title="设置与个性化"
              onClick={() => setEditor({ kind: "settings" })}
            >
              <Companion small />
            </button>
          </div>
        </header>
        {health?.demo_mode && user.id.startsWith("person_demo_") && (
          <div className="demo-ribbon">
            体验档案 · 人物、持有与生活记录为模拟；操作结果按实际记录呈现。
          </div>
        )}
        {route.section === "companion" && (
          <div className={`companion-workspace ${board ? "with-task" : ""}`}>
            <main className="companion-main">
              <Conversation
                messages={messages}
                run={
                  sending && !run
                    ? {
                        id: "",
                        conversation_id: threadId || "",
                        status: "queued",
                        text: "",
                        events: [],
                        error: "",
                        usage: {},
                      }
                    : run
                }
                draft={draft}
                setDraft={setDraft}
                onSend={send}
                onStop={() => {
                  if (run)
                    void request(`/runs/${run.id}/cancel`, "POST").catch(
                      (error) => message.error(error.message),
                    );
                }}
                companionName={companionName}
                contextLabel={
                  focusedItem
                    ? context.entry.intent === "persona"
                      ? `和${focusedItem.avatar.nickname || focusedItem.name}的分身聊聊`
                      : `${focusedItem.name}${context.entry.intent === "creative" ? " · 发现新玩法" : ""}`
                    : context.entry.intent === "creative"
                      ? "一起发现新玩法"
                      : undefined
                }
                afterMessages={
                  <>
                    {(context.entry.intent === "creative" || run?.events.some((event) => typeof event.type === "string" && ["research_search", "research_source", "research_unavailable"].includes(event.type))) && (
                      <div className="creative-sources-inline">
                        <CreativeSources run={run} guidance={context.entry.intent !== "creative"} />
                      </div>
                    )}
                    {board?.kind === "guidance" && (
                      <GuidanceTools
                        board={board}
                        update={setBoard}
                        initial={!messages.length}
                        onRun={boardActions!.onRun}
                        running={
                          sending ||
                          (!!run && ["queued", "running"].includes(run.status))
                        }
                        explain={(text) =>
                          request<Run>("/chat", "POST", {
                            text: text || "这一步怎么做？",
                            conversation_id: threadId,
                            item_ids: board.task.item_ids,
                            entry_context: {
                              intent: "guidance",
                              task_id: board.task.id,
                            },
                          })
                            .then(boardActions!.onRun)
                            .catch((error) => { message.error(error.message); })
                        }
                      />
                    )}
                  </>
                }
                onCameraRef={() => {}}
              >
                {!messages.length && !board && (
                  <div className="companion-home">
                    <div className="companion-greeting">
                      <Companion />
                      <div className="greeting-bubble">
                        <p>
                          我在。今天想问什么，
                          <br />
                          或记下什么？
                        </p>
                        <span className="greeting-spark">✦</span>
                      </div>
                    </div>
                    <div className="quick-starts">
                      <button
                        onClick={() =>
                          newTopic([], "guidance", "想问一件东西的用法。")
                        }
                      >
                        <Coffee size={24} strokeWidth={1.3} />
                        {large ? "问一问" : "东西怎么用"}
                      </button>
                      <button
                        onClick={() =>
                          large
                            ? file.current?.click()
                            : newTopic(
                                [],
                                "planning",
                                "周末想去野餐，先帮我看看已有的物品和需要核对的条件。",
                              )
                        }
                      >
                        <TreePine size={25} strokeWidth={1.3} />
                        {large ? "拍给我看" : "准备去野餐"}
                      </button>
                      <button
                        onClick={() =>
                          large
                            ? navigate({ section: "care" })
                            : setEditor({ kind: "item" })
                        }
                      >
                        <Gift size={24} strokeWidth={1.3} />
                        {large ? "家人提醒" : "记下一件礼物"}
                      </button>
                    </div>
                    {workspace.reminders.some((value) => !value.completed) && (
                      <button
                        className="mobile-attention"
                        onClick={() => navigate({ section: "care" })}
                      >
                        <BookHeart size={23} />
                        <span>
                          家人提醒 ·{" "}
                          {
                            workspace.reminders.find(
                              (value) => !value.completed,
                            )?.title
                          }
                        </span>
                        <ArrowLeft size={17} />
                      </button>
                    )}
                    <button
                      className="companion-creative-entry"
                      onClick={() =>
                        newTopic(
                          [],
                          "creative",
                          "最近有点无聊，想用身边已有的东西找点新玩法。先帮我找找相关公开分享，再一起探索。\n",
                        )
                      }
                    >
                      <Sparkles size={22} />
                      <span>和阿圆找找新玩法</span>
                      <ArrowLeft size={17} />
                    </button>
                    <div className="home-continuations">
                      <div className="section-title">
                        <h2>继续手边的事</h2>
                        <button
                          className="quiet-button"
                          onClick={() => setEditor({ kind: "task" })}
                        >
                          <Plus size={16} />
                          整理一件事
                        </button>
                      </div>
                      {workspace.tasks
                        .filter(
                          (task) =>
                            !["completed", "cancelled"].includes(task.status),
                        )
                        .slice(0, 3)
                        .map((task) => (
                          <button
                            className="continue-topic"
                            key={task.id}
                            onClick={() => void openTask(task.id)}
                          >
                            <MessageCircle size={18} />
                            {task.goal}
                            <ArrowLeft size={16} />
                          </button>
                        ))}
                      {workspace.tasks.length === 0 && (
                        <p className="empty-note">
                          可以轻轻问一句，也可以从拍一张照片开始。
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {board && board.kind !== "guidance" && boardActions && (
                  <TaskCanvas {...boardActions} />
                )}
              </Conversation>
            </main>
            <aside className="context-rail">
              {board && boardActions ? (
                <TaskRail {...boardActions} />
              ) : context.entry.intent === "creative" ? (
                <CreativeSources run={run} />
              ) : (
                <>
                  <section className="rail-section">
                    <h2>今天需要留意</h2>
                    <Care
                      workspace={{
                        ...workspace,
                        reminders: workspace.reminders
                          .filter((value) => !value.completed)
                          .slice(0, 3),
                      }}
                      user={user}
                      refresh={refresh}
                      onItem={onItem}
                    />
                    {workspace.tasks
                      .filter(
                        (task) =>
                          !["completed", "cancelled"].includes(task.status),
                      )
                      .slice(0, 1)
                      .map((task) => (
                        <button
                          className="context-task"
                          key={task.id}
                          onClick={() => void openTask(task.id)}
                        >
                          <TreePine size={30} strokeWidth={1.2} />
                          <div>
                            <strong>{task.goal}</strong>
                            <p>继续核对准备与实际进度</p>
                          </div>
                          <ArrowLeft size={16} />
                        </button>
                      ))}
                  </section>
                  <section className="rail-section">
                    <h2>身边的物品</h2>
                    <div className="recent-items">
                      {workspace.items.slice(0, 4).map((item) => (
                        <button key={item.id} onClick={() => onItem(item.id)}>
                          <ObjectVisual item={item} />
                          <strong>{item.name}</strong>
                        </button>
                      ))}
                    </div>
                  </section>
                  <button
                    className="soft-button full-width"
                    onClick={() =>
                      newTopic(
                        [],
                        "creative",
                        "最近有点无聊，能不能用身边已有的东西，找几个不一样的新玩法？",
                      )
                    }
                  >
                    和物伴找找新玩法
                  </button>
                </>
              )}
            </aside>
          </div>
        )}
        {route.section === "items" && (
          <Items
            workspace={workspace}
            user={user}
            route={route}
            refresh={refresh}
            edit={setEditor}
            ask={ask}
            task={(id) => void openTask(id)}
            device={setDevice}
            creative={(item) => ask(item, "creative")}
          />
        )}
        {route.section === "memories" && (
          <Memories
            workspace={workspace}
            edit={setEditor}
            refresh={refresh}
            onItem={onItem}
          />
        )}
        {route.section === "friends" && (
          <Friends
            workspace={workspace}
            user={user}
            route={route}
            edit={setEditor}
            refresh={refresh}
            onItem={onItem}
            askText={(text) => newTopic([], "general", text)}
          />
        )}
        {route.section === "care" && (
          <main className="page-content large-care">
            <div className="page-heading">
              <h1>家人提醒</h1>
              <button
                className="soft-button"
                onClick={() => setEditor({ kind: "reminder" })}
              >
                记录一件事
              </button>
            </div>
            <Care
              workspace={workspace}
              user={user}
              refresh={refresh}
              onItem={onItem}
            />
          </main>
        )}
      </div>
      <nav className="bottom-navigation" aria-label="主要栏目">
        {large ? (
          <>
            <button
              className={route.section === "companion" ? "active" : ""}
              onClick={() =>
                navigate({
                  section: "companion",
                  taskId: context.entry.task_id || undefined,
                })
              }
            >
              <MessageCircle size={25} />
              问一问
            </button>
            <button
              className={route.section === "care" ? "active" : ""}
              onClick={() => navigate({ section: "care" })}
            >
              <Users size={25} />
              家人提醒
            </button>
          </>
        ) : (
          navigation.map(({ key, label, Icon }) => (
            <button
              key={key}
              className={route.section === key ? "active" : ""}
              onClick={() =>
                navigate({
                  section: key,
                  taskId:
                    key === "companion"
                      ? context.entry.task_id || undefined
                      : undefined,
                })
              }
            >
              <Icon size={23} strokeWidth={1.7} />
              <span>{label}</span>
            </button>
          ))
        )}
      </nav>
      <input
        ref={file}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          void addPhoto(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {editor && (
        <Editors
          key={editor.kind + (editor.item?.id || editor.experience?.id || "")}
          editor={editor}
          workspace={workspace}
          user={user}
          onClose={() => setEditor(undefined)}
          onDone={refresh}
          onItem={(item) => onItem(item.id)}
          onTask={(id) => void openTask(id)}
        />
      )}
      {device && (
        <DeviceConnection
          item={device}
          onClose={() => setDevice(undefined)}
          onAsk={(text) => {
            setDevice(undefined);
            newTopic([device.id], "general", text);
          }}
        />
      )}
    </div>
  );
}
