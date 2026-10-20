"use client";
import { useEffect, useRef, useState } from "react";
import type { Item, Person } from "@/lib/domain";
import { additionalQuestions } from "@/lib/agent/presentation";
import type {
  ServiceSession,
  TurnInput,
  TurnResult,
} from "@/lib/agent/contracts";
const labels = {
  "curated-guidance": "精选资料指导",
  "model-with-evidence": "AI 选择资料",
  "model-general": "AI 一般帮助",
  "local-memory": "来自本地记录",
  "local-dialogue": "本地简短回应",
  "local-planning": "离线能力规划 · 未实物验证",
  "user-source": "用户提供资料 · 未独立核验",
  "model-creative": "AI 创作 / 可选交流",
};
export function AssistantConversation({
  actor,
  item,
  initialQuestion = "",
  mode = "service",
  elder = false,
  onHandoff,
  onQuestion,
  onSession,
  onActivity,
  onBusy,
  onSelectItem,
  memoryPolicy,
  uiContext,
  initialSessionId,
  startFresh = false,
  allHistory = false,
}: {
  initialSessionId?: string;
  startFresh?: boolean;
  allHistory?: boolean;
  actor: Person;
  item?: Item;
  initialQuestion?: string;
  mode?: TurnInput["mode"];
  elder?: boolean;
  onHandoff?: () => void;
  onQuestion?: (text: string) => void;
  onSession?: (session: ServiceSession | null) => void;
  onActivity?: () => void;
  onBusy?: (busy: boolean) => void;
  onSelectItem?: (itemId: string) => void;
  memoryPolicy?: "candidates" | "off";
  uiContext?: TurnInput["uiContext"];
}) {
  const [session, setSession] = useState<ServiceSession | null>(null),
    [sessions, setSessions] = useState<ServiceSession[]>([]);
  const [question, setQuestion] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [temporary, setTemporary] = useState(false),
    [reason, setReason] = useState(""),
    [preview, setPreview] = useState(false),
    [summary, setSummary] = useState(""),
    [handed, setHanded] = useState(false);
  const current = useRef<ServiceSession | null>(null),
    alive = useRef(true),
    retry = useRef<TurnInput | null>(null),
    auto = useRef(false),
    handoffId = useRef("");
  const headers = { "Content-Type": "application/json", "x-demo-actor": actor };
  const messagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode === "auto" && messagesRef.current)
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [mode, session?.id, session?.revision]);
  useEffect(() => {
    onBusy?.(busy);
  }, [busy]);
  function update(s: ServiceSession | null) {
    current.current = s;
    onSession?.(s);
    setSession(s);
    if (s && !temporary)
      setSessions((rows) => [s, ...rows.filter((row) => row.id !== s.id)]);
  }
  async function request(body: unknown, method = "POST") {
    const r = await fetch("/api/assistant", {
      method,
      headers,
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "请求未完成");
    return d;
  }
  async function send(text: string, base = current.current, resend = false) {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    const input =
      resend && retry.current
        ? retry.current
        : {
            requestId: crypto.randomUUID(),
            sessionId: temporary ? undefined : base?.id,
            itemId:
              allHistory && base
                ? base.itemId
                : item?.id ||
                  (!temporary && uiContext ? base?.itemId : undefined),
            mode,
            question: text.trim(),
            temporary,
            memoryPolicy,
            uiContext: uiContext
              ? {
                  ...uiContext,
                  planContext: base ? undefined : uiContext.planContext,
                }
              : undefined,
            expectedRevision: temporary ? undefined : base?.revision,
          };
    retry.current = input;
    onQuestion?.(text);
    try {
      const d = (await request(input)) as TurnResult;
      if (!alive.current) return;
      update(d.session);
      window.dispatchEvent(new Event("memory-captured"));
      onActivity?.();
      retry.current = null;
      setQuestion("");
      setPreview(false);
      setHanded(false);
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "连接未完成，可以重试");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function refresh() {
    const p = new URLSearchParams({ mode });
    if (allHistory) p.set("scope", "all");
    if (item) p.set("itemId", item.id);
    const r = await fetch("/api/assistant?" + p, {
      headers,
      cache: "no-store",
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    return d.sessions as ServiceSession[];
  }
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    refresh()
      .then(async (rows) => {
        if (cancelled) return;
        setSessions(rows);
        let s = startFresh
          ? null
          : (allHistory && !item ? rows.find((r) => !r.itemId) : rows[0]) ||
            null;
        if (initialSessionId) {
          const response = await fetch(
            "/api/assistant?sessionId=" + encodeURIComponent(initialSessionId),
            { headers, cache: "no-store" },
          );
          const d = await response.json();
          if (!response.ok) throw Error(d.error);
          s = d.session;
        }
        if (cancelled) return;
        update(s);
        if (initialQuestion && !auto.current) {
          auto.current = true;
          send(initialQuestion, s);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [actor, item?.id, mode]);
  async function feedback(
    outcome: "completed" | "unresolved" | "tried",
    stepId?: string,
  ) {
    if (!session || temporary) return;
    setBusy(true);
    setError("");
    try {
      const d = await request({
        action: "feedback",
        input: {
          sessionId: session.id,
          requestId: crypto.randomUUID(),
          outcome,
          reason,
          stepId,
        },
      });
      if (alive.current) {
        update(d.session);
        window.dispatchEvent(new Event("memory-captured"));
        setReason("");
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    const clear = (event?: Event) => {
      const detail = (event as CustomEvent | undefined)?.detail;
      if (detail?.actor && detail.actor !== actor) return;
      if (detail?.scope && detail.scope !== item?.id) return;
      update(null);
      retry.current = null;
      setError("记忆或授权已更新，旧上下文已清除，可以重新提问。");
      refresh()
        .then((rows) => {
          if (alive.current) setSessions(rows);
        })
        .catch(() => {});
    };
    const storage = (e: StorageEvent) => {
      if (e.key === "product-agent-memory-revision" && e.newValue) {
        try {
          const detail = JSON.parse(e.newValue);
          if (detail.actor === actor)
            clear(new CustomEvent("memory-updated", { detail }));
        } catch {}
      }
    };
    window.addEventListener("memory-updated", clear);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("memory-updated", clear);
      window.removeEventListener("storage", storage);
    };
  }, [actor, item?.id, mode]);
  const last = session?.messages.filter((m) => m.role === "assistant").at(-1);
  async function decide(id: string, action: "confirm" | "cancel") {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/home", {
        method: "POST",
        headers,
        body: JSON.stringify({ action, id }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (!alive.current) return;
      if (d.session) update(d.session);
      setError("");
      onActivity?.();
      window.dispatchEvent(new Event("workspace-updated"));
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div
      className="assistant-conversation"
      role="region"
      aria-label={
        mode === "auto"
          ? "物间统一对话"
          : mode === "story"
            ? "与物品讲故事"
            : mode === "companion"
              ? "可选陪伴对话"
              : mode === "ideas"
                ? "结合我的物品找灵感"
                : "连续使用帮助"
      }
    >
      {!elder && (
        <details className="conversation-options">
          <summary>继续以前的问题 / 提问选项</summary>
          <label>
            之前的问题
            <select
              disabled={busy || temporary}
              value={session?.id || ""}
              onChange={(e) => {
                update(sessions.find((s) => s.id === e.target.value) || null);
                retry.current = null;
                setError("");
              }}
            >
              <option value="">开始新问题</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.messages
                    .find((m) => m.role === "user")
                    ?.text.slice(0, 30) || "已清除的会话"}{" "}
                  · {new Date(s.updatedAt).toLocaleDateString("zh-CN")}
                </option>
              ))}
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={temporary}
              disabled={busy}
              onChange={(e) => {
                setTemporary(e.target.checked);
                update(null);
                retry.current = null;
              }}
            />
            临时提问：不保存问题，也不使用个人记忆；每次独立处理
          </label>
          {session && !temporary && (
            <button
              className="text-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await request({ sessionId: session.id }, "DELETE");
                  if (alive.current) {
                    update(null);
                    setSessions(sessions.filter((s) => s.id !== session.id));
                  }
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              忘记这段对话
            </button>
          )}
        </details>
      )}
      <div
        className="conversation-messages"
        ref={messagesRef}
        aria-live="polite"
        aria-busy={busy}
      >
        {session?.messages.map((message) => (
          <article
            className={"conversation-message " + message.role}
            key={message.id}
          >
            <strong>
              {message.role === "user"
                ? "你"
                : message.role === "action"
                  ? "操作结果"
                  : message.role === "feedback"
                    ? "你的反馈"
                    : message.reply?.outcome === "unavailable"
                      ? message.reply.errorCode === "not_configured"
                        ? "未配置密钥或模型"
                        : message.reply.errorCode === "payment_not_authorized"
                          ? "未开启费用授权"
                          : "请求失败"
                      : labels[message.reply?.source || "curated-guidance"]}
            </strong>
            {message.reply?.route && (
              <small className="home-route-label">
                {message.reply.route.itemName
                  ? message.reply.route.itemName + " · "
                  : uiContext
                    ? "物间 · "
                    : "全屋 · "}
                {
                  {
                    app: "物间使用指南",
                    help: "使用帮助",
                    story: "故事与记忆",
                    companion: "陪你聊聊",
                    locate: "寻找物品",
                    plan: "准备计划",
                    move: "位置安排",
                    handoff: "家庭协作",
                    clarify: "请选一件",
                  }[message.reply.route.intent]
                }
              </small>
            )}
            <p>{message.text}</p>
            {!!message.reply?.route?.candidates?.length && onSelectItem && (
              <div className="home-candidate-items">
                {message.reply.route.candidates.map((i) => (
                  <button
                    className="button secondary"
                    key={i.id}
                    onClick={() => onSelectItem(i.id)}
                  >
                    和{i.name}继续聊
                  </button>
                ))}
              </div>
            )}
            {message.reply?.actionCards?.map((card) => (
              <div className="home-action-card" key={card.id}>
                <h3>{card.title}</h3>
                <ul>
                  {card.detail.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
                {card.status === "pending" ? (
                  <div className="inline">
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => decide(card.id, "confirm")}
                    >
                      {card.confirmLabel}
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => decide(card.id, "cancel")}
                    >
                      暂不执行
                    </button>
                  </div>
                ) : (
                  <p role="status">
                    {card.status === "applied"
                      ? card.kind === "handoff"
                        ? "已创建家庭事项，等待处理"
                        : card.kind === "plan"
                          ? "计划已保存，待你执行"
                          : "位置已保存"
                      : "已取消，未执行"}
                  </p>
                )}
                <small>确认后才执行；建议保留 15 分钟。</small>
              </div>
            ))}
            {!!message.reply?.steps.length && (
              <ol>
                {message.reply.steps.map((step) => (
                  <li key={step.id}>
                    {step.text}
                    {message.id === last?.id && !temporary && (
                      <button
                        className="text-button"
                        disabled={busy || session.tried.includes(step.id)}
                        onClick={() => feedback("tried", step.id)}
                      >
                        {session.tried.includes(step.id)
                          ? "已试过"
                          : "这步试过了"}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {message.reply &&
              additionalQuestions(message.reply).map((q) => <p key={q}>{q}</p>)}
            {message.reply?.caveat && <small>{message.reply.caveat}</small>}
            {!!message.reply?.citations.length && (
              <details>
                <summary>查看依据</summary>
                {message.reply.citations.map((c) => (
                  <p key={c.id}>
                    <a href={c.url} target="_blank" rel="noreferrer">
                      {c.title} ↗
                    </a>{" "}
                    {c.section}
                  </p>
                ))}
                <small>资料核对不代表已验证实物状态。</small>
              </details>
            )}
          </article>
        ))}
      </div>
      {busy && <p role="status">正在查看资料与本次条件…</p>}
      {error && (
        <div role="alert" className="answer">
          <p>{error}</p>
          {retry.current && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                send(retry.current!.question, current.current, true)
              }
            >
              重试这次请求
            </button>
          )}
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              try {
                const rows = await refresh();
                if (alive.current) {
                  setSessions(rows);
                  update(rows[0] || null);
                  retry.current = null;
                  setError("");
                }
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            刷新会话
          </button>
        </div>
      )}
      {mode === "auto" && !session?.messages.length && (
        <div className="example-questions">
          <small>可以这样开始：</small>
          {(item
            ? [
                item.demo?.questions.find((q) => !q.includes("故事")) ||
                  "怎么用这件物品？",
                "聊聊以前的故事",
              ]
            : ["帮我准备周末野餐", "家里有哪些物品？"]
          ).map((q) => (
            <button
              key={q}
              className="text-button"
              disabled={busy}
              onClick={() => setQuestion(q)}
            >
              {q}
            </button>
          ))}
        </div>
      )}
      {item?.demo && mode !== "auto" && (
        <div className="example-questions">
          <small>
            {mode === "story"
              ? "可以先回顾案例，再继续自己的讲述："
              : "先填入一个有资料可核对的问题："}
          </small>
          {(mode === "story"
            ? ["聊聊以前的故事"]
            : item.demo.questions.filter((q) => !q.includes("故事"))
          ).map((q) => (
            <button
              key={q}
              className="text-button"
              disabled={busy}
              onClick={() => setQuestion(q)}
            >
              {q}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(question);
        }}
      >
        <label>
          {mode === "auto"
            ? "对物间说"
            : mode === "story"
              ? "讲讲你与这件物品"
              : "写下你的问题"}
          <textarea
            name="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={2000}
            required
            placeholder={
              mode === "auto"
                ? item
                  ? "问问怎么用，讲一段故事，或说说今天的心情…"
                  : "想找什么、准备什么，或请家人做些什么…"
                : mode === "story"
                  ? "说说它的来历、一次经历，或问问以前留下的故事…"
                  : session
                    ? "补充情况，或告诉我哪一步卡住了…"
                    : "描述问题，或说说想用它做什么…"
            }
          />
        </label>
        <div className="inline">
          <button className="button" disabled={busy}>
            {busy
              ? "正在回应…"
              : mode === "auto" || mode === "story"
                ? "发送"
                : "发送问题"}
          </button>
          {session && (
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                update(null);
                retry.current = null;
                setError("");
                setPreview(false);
              }}
            >
              开始新问题
            </button>
          )}
        </div>
        <small>
          {temporary
            ? "本次不写入会话或记忆。"
            : memoryPolicy === "off"
              ? "仅保留必要的会话历史，不自动整理长期记忆。临时提问可进一步关闭历史保存；当前问题可能由已授权模型处理。"
              : memoryPolicy === "candidates"
                ? "会话历史与长期记忆分开：仅提取待确认候选，确认前不用于长期个性化；历史私人记忆默认不上云。"
                : "问答保存 7 天，确认解决后保存 30 天；相关内容会在本机静默整理为记忆，可在首页查看、暂停或忘记。必要问题可能交给云端模型；私人记忆默认不上云。"}
        </small>
      </form>
      {session?.known.lastOutcome === "unresolved" && !temporary && (
        <div className="answer">
          <p>已记下还没解决；接着看实际卡住的位置。</p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              send("还是没有解决，请根据已经记录的情况继续", current.current)
            }
          >
            继续排查
          </button>
        </div>
      )}
      {session?.status === "user_resolved" &&
        !!last?.reply?.steps.length &&
        !temporary && (
          <small>
            已按自动整理设置处理本轮方法；可在首页“记忆与陪伴”查看。仅代表你反馈有效。
          </small>
        )}
      {last &&
        !temporary &&
        mode !== "story" &&
        mode !== "companion" &&
        (mode !== "auto" || last.reply?.route?.intent === "help") && (
          <div className="conversation-feedback">
            <label>
              试过之后怎样？（可补充）
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="例如：第二步找不到，或还是没有反应"
              />
            </label>
            <div className="inline">
              <button
                className="button secondary"
                disabled={busy || session?.status === "user_resolved"}
                onClick={() => feedback("completed")}
              >
                {session?.status === "user_resolved"
                  ? "你已确认解决"
                  : "解决了"}
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => feedback("unresolved")}
              >
                还没解决
              </button>
            </div>
            <small>完成状态来自你的反馈；助手没有检测实物。</small>
          </div>
        )}
      {last &&
        mode === "service" &&
        item?.shared &&
        actor !== "friend" &&
        !temporary && (
          <div>
            <button
              className="button secondary"
              disabled={busy || handed}
              onClick={() => {
                setPreview(true);
                setSummary("使用求助：" + item.name);
                handoffId.current = crypto.randomUUID();
              }}
            >
              {handed ? "已交给家人" : "请家人帮我"}
            </button>
            {preview && (
              <form
                className="source-card"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    await request({
                      action: "handoff",
                      input: {
                        sessionId: session!.id,
                        expectedRevision: session!.revision,
                        requestId: handoffId.current,
                        summary,
                        assignee: actor === "dad" ? "lin" : "dad",
                      },
                    });
                    if (alive.current) {
                      setHanded(true);
                      setPreview(false);
                      onHandoff?.();
                    }
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  家人将看到这段求助摘要
                  <input
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    required
                    maxLength={120}
                  />
                </label>
                <p>
                  仅分享这段摘要、关联物品与已试 {session?.tried.length || 0}{" "}
                  步的数量，不附上私人记忆和整段对话。
                </p>
                <button className="button" disabled={busy}>
                  确认摘要并交给家人
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setPreview(false)}
                >
                  取消
                </button>
              </form>
            )}
          </div>
        )}
    </div>
  );
}
