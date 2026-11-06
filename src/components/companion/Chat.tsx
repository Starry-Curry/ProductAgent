"use client";
import { useEffect, useRef, useState } from "react";
import {
  Send,
  Mic,
  Camera,
  Volume2,
  Check,
  Loader2,
  ArrowRight,
  FileText,
  RotateCcw,
  X,
  Plus,
  AlertCircle,
  Image as ImageIcon,
} from "lucide-react";
import {
  matchInventoryQuestion,
  isEventPreparationRequest,
} from "@/lib/companion/item-matching";
import { itemPhoto } from "@/lib/life/item-photos";
import type { Item, Person } from "@/lib/domain";
import type { ServiceSession, TurnResult } from "@/lib/agent/contracts";
import { demonstrationAnswer } from "@/lib/agent/demonstration";
import { guideSketch, type GuideStep } from "@/lib/companion/visual-guide";

export function speak(text: string, onError?: (s: string) => void) {
  if (!("speechSynthesis" in window)) {
    onError?.("当前浏览器不支持朗读，请换用 Chrome 或 Edge。");
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN";
  u.rate = 0.88;
  const voice = window.speechSynthesis
    .getVoices()
    .find((v) => v.lang.startsWith("zh"));
  if (voice) u.voice = voice;
  u.onerror = (e) => {
    if (e.error !== "interrupted" && e.error !== "canceled")
      onError?.("朗读未能启动，请检查系统中文语音。");
  };
  window.speechSynthesis.speak(u);
}
export function VoiceButton({
  onText,
  notify,
  className = "",
  large = false,
}: {
  onText: (s: string) => void;
  notify: (s: string) => void;
  className?: string;
  large?: boolean;
}) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<any>(null);
  useEffect(() => () => recognition.current?.abort(), []);
  function start() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const API =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!API) {
      notify(
        "此浏览器暂不支持语音识别，可以打字或使用系统听写。建议用 Chrome / Edge。",
      );
      return;
    }
    const r = new API();
    recognition.current = r;
    r.lang = "zh-CN";
    r.interimResults = false;
    r.continuous = false;
    r.onstart = () => setListening(true);
    r.onend = () => setListening(false);
    r.onresult = (e: any) => onText(e.results[0][0].transcript);
    r.onerror = (e: any) => {
      setListening(false);
      notify(
        e.error === "not-allowed"
          ? "请允许浏览器使用麦克风，再试一次。"
          : e.error === "no-speech"
            ? "没听清，请再说一遍。"
            : "语音连接未完成，可继续打字提问。",
      );
    };
    try {
      r.start();
    } catch {
      notify("麦克风暂时无法启动，请稍后重试。");
    }
  }
  return (
    <button
      type="button"
      className={className + (listening ? " is-listening" : "")}
      onClick={start}
      title={listening ? "停止录音" : "语音输入"}
      aria-label={listening ? "停止录音" : "语音输入"}
    >
      <Mic size={large ? 30 : 20} />
      {large ? (listening ? "正在听，点此结束" : "点击说话") : null}
    </button>
  );
}
export function CompanionChat({
  actor,
  item,
  inventory = [],
  initialQuestion = "",
  initialSessionId,
  name,
  elder = false,
  color = "original",
  onChange,
  onSession,
  onItem,
  onPhoto,
  onPlan,
  onSupport,
  notify,
  skipPlan = false,
  demonstration = false,
  onVisual,
}: {
  actor: Person;
  item?: Item;
  inventory?: Item[];
  initialQuestion?: string;
  initialSessionId?: string;
  name: string;
  elder?: boolean;
  color?: string;
  onChange: () => void;
  onSession: (s: ServiceSession) => void;
  onItem: (id: string) => void;
  onPhoto: () => void;
  onPlan: (goal: string) => void;
  onSupport: (s: ServiceSession | null) => void;
  notify: (text: string) => void;
  skipPlan?: boolean;
  demonstration?: boolean;
  onVisual: (steps: GuideStep[], question: string, itemId?: string) => void;
}) {
  const [pendingMatch, setPendingMatch] = useState<{
    question: string;
    candidates: Item[];
  } | null>(null);
  const [session, setSession] = useState<ServiceSession | null>(null),
    [localDemo, setLocalDemo] = useState<ReturnType<
      typeof demonstrationAnswer
    > | null>(null),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(""),
    [error, setError] = useState(""),
    [seconds, setSeconds] = useState(0);
  const bottom = useRef<HTMLDivElement>(null),
    current = useRef<ServiceSession | null>(null),
    retry = useRef<any>(null),
    alive = useRef(true),
    started = useRef(false),
    input = useRef<HTMLTextAreaElement>(null);
  const headers = { "Content-Type": "application/json", "x-demo-actor": actor };
  function update(s: ServiceSession) {
    current.current = s;
    setSession(s);
    onSession(s);
  }
  async function post(body: unknown) {
    const r = await fetch("/api/assistant", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "请求未完成");
    return d;
  }
  async function send(
    question: string,
    base = current.current,
    replay = false,
    confirmedItem?: string | false,
  ) {
    if (!question.trim() || busy) return;
    if (!skipPlan && isEventPreparationRequest(question)) {
      onPlan(question);
      return;
    }
    if (
      !item &&
      confirmedItem === undefined &&
      !replay &&
      !isEventPreparationRequest(question)
    ) {
      const match = matchInventoryQuestion(question, inventory, actor);
      if (
        match.candidates.length &&
        (match.alias || match.candidates.length > 1) &&
        !match.candidates.some((i) => i.id === base?.itemId)
      ) {
        setPendingMatch({ question, candidates: match.candidates });
        setText("");
        return;
      }
    }
    setPendingMatch(null);
    if (confirmedItem === false) base = null;
    const selectedItem =
      typeof confirmedItem === "string"
        ? inventory.find((i) => i.id === confirmedItem)
        : item;
    if (confirmedItem && base?.itemId && base.itemId !== confirmedItem)
      base = null;
    setBusy(true);
    setLocalDemo(null);
    setError("");
    setPending(question);
    setText("");
    const body =
      replay && retry.current
        ? retry.current
        : {
            requestId: crypto.randomUUID(),
            question: question.trim(),
            mode: "auto",
            memoryPolicy: "off",
            itemId: selectedItem?.id || base?.itemId,
            sessionId: base?.id,
            expectedRevision: base?.revision,
            uiContext: {
              client: "companion-v1",
              skipItemMatch: confirmedItem === false,
              page: selectedItem ? "item" : "home",
              interfaceMode: elder ? "care" : "standard",
            },
          };
    retry.current = body;
    try {
      const d = (await post(body)) as TurnResult;
      if (!alive.current) return;
      update(d.session);
      setPending("");
      retry.current = null;
      onChange();
    } catch (e) {
      if (alive.current) {
        if (demonstration) {
          setLocalDemo(demonstrationAnswer(question, selectedItem));
          setError("");
          setPending(question);
        } else setError((e as Error).message);
        setText(question);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    (async () => {
      try {
        let base: ServiceSession | null = null;
        if (initialSessionId) {
          const r = await fetch(
            "/api/assistant?sessionId=" + encodeURIComponent(initialSessionId),
            { headers },
          );
          const d = await r.json();
          if (!r.ok) throw Error(d.error);
          if (cancelled) return;
          base = d.session;
          update(base!);
        }
        if (initialQuestion && !started.current) {
          started.current = true;
          await send(initialQuestion, base);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      alive.current = false;
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!busy) {
      setSeconds(0);
      return;
    }
    const time = Date.now();
    const t = setInterval(
      () => setSeconds(Math.floor((Date.now() - time) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [busy]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [session?.revision, pending, busy]);
  async function feedback(
    outcome: "tried" | "completed" | "unresolved",
    stepId?: string,
  ) {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try {
      const d = await post({
        action: "feedback",
        input: {
          sessionId: session.id,
          requestId: crypto.randomUUID(),
          outcome,
          stepId,
        },
      });
      update(d.session);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function decide(id: string, action: "confirm" | "cancel") {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/home", {
        method: "POST",
        headers,
        body: JSON.stringify({ id, action }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (d.session) update(d.session);
      notify(action === "confirm" ? "已确认并保存" : "已取消");
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const replies = session?.messages.filter((m) => m.role === "assistant") || [];
  const latest = replies.at(-1);
  const lastStep = latest?.reply?.steps.find(
    (s) => !session?.tried.includes(s.id),
  );
  const messages = elder
    ? (
        session?.messages.filter((m) => m.role === "user").slice(-1) || []
      ).concat(latest ? [latest] : [])
    : session?.messages || [];
  return (
    <div className={"wj-chat " + (elder ? "wj-chat-elder" : "")}>
      <div className="wj-messages" aria-live="polite" aria-busy={busy}>
        {!session && !busy && !pendingMatch && (
          <div className="wj-welcome">
            <div className="wj-welcome-top">
              <img
                className={"wj-mascot " + color}
                src="/companion/ayuan.webp"
                alt={name}
              />
              <div className="wj-hello">
                我在。今天想问什么，
                <br />
                或者记下什么？
              </div>
            </div>
            <p>从一件东西、一段回忆，或一个想做的事情开始。</p>
            <div
              className={"wj-suggestions" + (elder ? " elder-suggestions" : "")}
            >
              <button
                onClick={() => {
                  setText(
                    item ? `${item.name}怎么用？` : "我想问一件东西怎么用",
                  );
                  input.current?.focus();
                }}
              >
                <FileText size={18} />
                东西怎么用
              </button>
              <button
                onClick={() => onPlan("周六四个人去公园野餐，帮我看看要带什么")}
              >
                <span>☀</span>准备去野餐
              </button>
              <button onClick={onPhoto}>
                <span>♡</span>记下一件礼物
              </button>
              <button onClick={() => onVisual([], "洗衣机怎么用？", item?.id)}>
                <Camera size={18} />
                看图一步一步
              </button>
            </div>
          </div>
        )}
        {pendingMatch && (
          <section
            className="wj-item-confirmation"
            role="dialog"
            aria-label="确认你说的物品"
          >
            <small>我在家里的记录中找到了</small>
            <h3>
              你说的是不是
              {pendingMatch.candidates.length === 1
                ? "这件物品？"
                : "下面的某一件？"}
            </h3>
            <p className="wj-confirm-question">“{pendingMatch.question}”</p>
            {pendingMatch.candidates.map((candidate) => (
              <button
                key={candidate.id}
                className="wj-confirm-item"
                onClick={() =>
                  void send(
                    pendingMatch.question,
                    current.current,
                    false,
                    candidate.id,
                  )
                }
              >
                {itemPhoto(candidate, actor)?.src && (
                  <img
                    src={itemPhoto(candidate, actor)!.src}
                    alt={candidate.name}
                  />
                )}
                <span>
                  <strong>{candidate.name}</strong>
                  <small>
                    {[candidate.brand, candidate.model, candidate.location]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                <span className="wj-confirm-yes">
                  是的，继续 <ArrowRight size={16} />
                </span>
              </button>
            ))}
            <button
              className="wj-link"
              onClick={() =>
                void send(pendingMatch.question, current.current, false, false)
              }
            >
              不是这些，先给我一般建议
            </button>
          </section>
        )}
        {item && (
          <div className="wj-chat-context">
            <FileText size={15} />
            <span>正在聊：{item.name}</span>
            <small>{item.model === "待确认" ? "型号待核对" : item.model}</small>
          </div>
        )}
        {messages.map((m) => (
          <article key={m.id} className={"wj-message " + m.role}>
            {m.role === "assistant" && (
              <img
                className="wj-bubble-avatar"
                src="/companion/ayuan.webp"
                alt=""
              />
            )}
            <div className="wj-bubble">
              <p>{m.text}</p>
              {m.reply?.source && (
                <small className="wj-source-label">
                  {m.reply.demonstration
                    ? "演示建议"
                    : m.reply.source.startsWith("model")
                      ? "AI 回答"
                      : m.reply.source === "curated-guidance"
                        ? "已收录资料指导"
                        : m.reply.source === "user-source"
                          ? "来自你提供的资料"
                          : "本地资料与规则"}
                  {m.reply.model ? " · " + m.reply.model : ""}
                </small>
              )}
              {m.role === "assistant" &&
                m.id === latest?.id &&
                !!m.reply?.steps.length && (
                  <button
                    className="wj-chat-visual"
                    onClick={() =>
                      onVisual(
                        m.reply!.steps,
                        session?.messages
                          .filter((m) => m.role === "user")
                          .at(-1)?.text || initialQuestion,
                        m.reply?.route?.itemId || item?.id || session?.itemId,
                      )
                    }
                  >
                    <img
                      src={guideSketch(
                        item?.name || "操作图解",
                        m.reply.steps[0]?.text,
                      )}
                      alt="分步操作示意"
                    />
                    <span>
                      <strong>
                        看图跟着做 <ArrowRight size={15} />
                      </strong>
                      <small>红色箭头指示 · 摄像头定位 · 演示视频</small>
                    </span>
                  </button>
                )}
              {!!m.reply?.steps.length && (
                <div className="wj-guidance">
                  <div className="wj-step-heading">
                    <span>一步一步来</span>
                    <small>{session?.tried.length || 0} 步已尝试</small>
                  </div>
                  {(elder && m.id === latest?.id
                    ? lastStep
                      ? [lastStep]
                      : []
                    : m.reply.steps
                  ).map((s, n) => (
                    <div
                      className={
                        "wj-step " +
                        (session?.tried.includes(s.id) ? "done" : "")
                      }
                      key={s.id}
                    >
                      <span className="wj-step-number">
                        {session?.tried.includes(s.id) ? (
                          <Check size={15} />
                        ) : (
                          n + 1
                        )}
                      </span>
                      <div>
                        <p>{s.text}</p>
                        {m.id === latest?.id && (
                          <div className="wj-step-actions">
                            <button
                              disabled={busy || session?.tried.includes(s.id)}
                              onClick={() => feedback("tried", s.id)}
                            >
                              {session?.tried.includes(s.id)
                                ? "已试过"
                                : "这步完成了"}
                            </button>
                            <button onClick={() => speak(s.text, notify)}>
                              <Volume2 size={14} />
                              听一遍
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {m.id === latest?.id && (
                    <button
                      className="wj-btn secondary"
                      disabled={busy}
                      onClick={() =>
                        send("这一步已经完成，请接着告诉我下一步。")
                      }
                    >
                      继续下一步
                      <ArrowRight size={16} />
                    </button>
                  )}
                </div>
              )}
              {m.reply?.questions?.map((q) => (
                <button
                  className="wj-question"
                  key={q}
                  onClick={() => {
                    setText(q);
                    input.current?.focus();
                  }}
                >
                  {q}
                </button>
              ))}
              {m.reply?.route?.candidates?.map((c) => (
                <button
                  className="wj-question"
                  key={c.id}
                  onClick={() =>
                    void send(
                      session?.messages.filter((m) => m.role === "user").at(-1)
                        ?.text || initialQuestion,
                      null,
                      false,
                      c.id,
                    )
                  }
                >
                  和{c.name}继续聊 <ArrowRight size={14} />
                </button>
              ))}
              {m.reply?.actionCards?.map((c) => (
                <div className="wj-action-card" key={c.id}>
                  <h3>{c.title}</h3>
                  {c.detail.map((t, i) => (
                    <p key={i}>{t}</p>
                  ))}
                  {c.status === "pending" ? (
                    <div className="wj-actions">
                      <button
                        className="wj-btn"
                        disabled={busy}
                        onClick={() => decide(c.id, "confirm")}
                      >
                        {c.confirmLabel}
                      </button>
                      <button
                        className="wj-btn secondary"
                        disabled={busy}
                        onClick={() => decide(c.id, "cancel")}
                      >
                        暂不执行
                      </button>
                    </div>
                  ) : (
                    <small>
                      {c.status === "applied" ? "已保存" : "已取消"}
                    </small>
                  )}
                </div>
              ))}
              {m.reply?.caveat && (
                <small className="wj-caveat">{m.reply.caveat}</small>
              )}
              {!!m.reply?.citations.length && (
                <details className="wj-citations">
                  <summary>
                    <FileText size={14} />
                    查看回答依据 · {m.reply.citations.length} 条
                  </summary>
                  {m.reply.citations.map((c) => (
                    <a
                      key={c.id}
                      href={/^https?:\/\//.test(c.url) ? c.url : undefined}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {c.title}
                      {c.section ? " · " + c.section : ""}
                    </a>
                  ))}
                </details>
              )}
              {m.role === "assistant" &&
                m.id === latest?.id &&
                !m.reply?.steps.length &&
                /第[一二三四五六七八九十\d]+步|先.{0,20}(?:选中|单击|打开|按|找到|连接|插入)/.test(
                  m.text,
                ) && (
                  <div className="wj-generic-followup">
                    <button
                      className="wj-btn"
                      disabled={busy}
                      onClick={() =>
                        send("我已经完成你刚才说的这一步，接下来呢？")
                      }
                    >
                      我做完了，下一步
                      <ArrowRight size={17} />
                    </button>
                    <button
                      className="wj-btn secondary"
                      disabled={busy}
                      onClick={() =>
                        send(
                          "我没找到你刚才说的位置或按钮，请换个方式说明，先不要假定我已完成。",
                        )
                      }
                    >
                      我没找到
                    </button>
                  </div>
                )}
              {m.role === "assistant" && (
                <div className="wj-answer-tools">
                  <button
                    aria-label="朗读回答"
                    onClick={() => speak(m.text, notify)}
                  >
                    <Volume2 size={15} />
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard
                        .writeText(m.text)
                        .then(() => notify("回答已复制"))
                        .catch(() => notify("复制失败，请选中文字复制"));
                    }}
                  >
                    复制
                  </button>
                  {m.id === latest?.id && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => feedback("completed")}
                      >
                        解决了
                      </button>
                      <button onClick={() => onSupport(session)}>
                        还是不行
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </article>
        ))}
        {pending && busy && (
          <article className="wj-message user">
            <div className="wj-bubble">
              <p>{pending}</p>
            </div>
          </article>
        )}
        {busy && (
          <div className="wj-thinking" role="status">
            <Loader2 className="spin" size={17} />
            {seconds < 5
              ? "正在理解你的问题…"
              : seconds < 15
                ? "正在整理可用的资料与下一步…"
                : "还在等待模型返回，可以稍等一下。"}
            {seconds > 0 && <small>{seconds} 秒</small>}
          </div>
        )}
        {localDemo && (
          <div className="wj-local-demo">
            <small>备用演示回答</small>
            <p>{localDemo.answer}</p>
            {localDemo.steps.map((s, i) => (
              <p key={s.id}>
                {i + 1}. {s.text}
              </p>
            ))}
            <button
              className="wj-btn secondary"
              onClick={() => onVisual(localDemo.steps, pending, item?.id)}
            >
              看图跟着做
            </button>
          </div>
        )}
        {error && (
          <div className="wj-inline-error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button
              disabled={busy}
              onClick={() =>
                send(retry.current?.question || text, current.current, true)
              }
            >
              <RotateCcw size={15} />
              重试
            </button>
            <button aria-label="关闭错误提示" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form
        className="wj-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <button
          type="button"
          className="wj-icon-btn"
          onClick={onPhoto}
          aria-label="拍照或上传图片"
        >
          <Camera size={22} />
        </button>
        <textarea
          ref={input}
          value={text}
          maxLength={2000}
          disabled={busy}
          placeholder={elder ? "写下你想问的…" : "说说你想做的事…"}
          aria-label="输入问题"
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              send(text);
            }
          }}
        />
        <VoiceButton
          notify={notify}
          onText={(s) => {
            setText(s);
            if (elder) send(s);
          }}
          className="wj-icon-btn"
        />
        <button
          className="wj-send"
          disabled={busy || !text.trim()}
          aria-label="发送问题"
        >
          {busy ? <Loader2 size={21} className="spin" /> : <Send size={21} />}
        </button>
      </form>
      <small className="wj-composer-hint">
        {elder
          ? "可以说话，也可以打字；每一步都能听一遍。"
          : "Enter 发送 · Shift + Enter 换行 · 有依据的步骤，陪你接着做"}
      </small>
    </div>
  );
}
