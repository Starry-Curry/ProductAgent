import { useEffect, useRef, useState } from "react";
import { App as AntApp, Modal } from "antd";
import {
  ArrowRight,
  Check,
  Clipboard,
  FileText,
  MessageCircle,
  Pencil,
  Plus,
  Sparkles,
  Volume2,
} from "lucide-react";
import {
  request,
  type Task,
  type TaskBoard as Board,
  type TaskEntry,
  type User,
  type Workspace,
} from "../api";
import { Companion, EmptyState, ObjectVisual, speak } from "./shared";
import "./outing-task.css";
import ButlerActionCard from "./ButlerActionCard";

export type BoardActions = {
  board: Board;
  workspace: Workspace;
  user: User;
  update: (board: Board) => void;
  refresh: () => Promise<unknown>;
  onItem: (id: string) => void;
  onCamera: () => void;
  onDiscuss?: (entry: TaskEntry, mode: "try" | "discuss") => void;
};
const labels: Record<string, string> = {
  owned: "家里已有",
  buy: "需要补充",
  borrow: "待确认借用",
  confirm: "需要核对",
  step: "处理步骤",
};
const states: Record<string, string> = {
  pending: "待处理",
  ready: "用户报告已准备",
  not_found: "没有找到",
  unchanged: "没有变化",
};
const stepStates: Record<string, string> = {
  pending: "尚未报告完成",
  ready: "用户报告完成步骤",
  not_found: "用户报告未找到",
  unchanged: "用户报告没有变化",
};

const availability: Record<TaskEntry["group"], string> = {
  owned: "有 · 已有物品",
  buy: "没有 · 需要补充",
  borrow: "待确认 · 想借用",
  confirm: "待确认 · 核对一下",
  step: "准备事项",
};
type EntryDraft = {
  id?: string;
  title: string;
  group: TaskEntry["group"];
  item_id: string;
  item_editable: boolean;
  note: string;
  assignee_id: string;
};

function useTaskIdentity(taskId: string) {
  const identity = useRef(taskId);
  identity.current = taskId;
  useEffect(() => {
    identity.current = taskId;
    return () => { identity.current = ""; };
  }, [taskId]);
  return identity;
}

// Preparation, availability and responsibility belong to the same task entry.
// Nothing entered here creates an inventory item or claims the trip happened.
function PreparationList({ board, workspace, user, update, refresh, onItem }: BoardActions) {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<EntryDraft>();
  const [formError, setFormError] = useState("");
  const currentTask = useTaskIdentity(board.task.id);
  useEffect(() => { setDraft(undefined); setFormError(""); }, [board.task.id]);
  const canEdit = (entry: TaskEntry) => board.access === "owner" ||
    (board.access === "active" && entry.assignee_id === user.id);
  const people = board.participants.filter((person) => person.status === "active" && person.id !== user.id);
  const nameOf = (id?: string | null) => !id ? "待认领" : id === user.id ? "我" :
    String(board.participants.find((person) => person.id === id)?.display_name || workspace.friends.find((friend) => friend.id === id)?.display_name || "参与者");
  async function mutate(path: string, method: string, body: Record<string, unknown>) {
    if (busy) return false;
    const taskId = board.task.id;
    setBusy(true);
    try {
      const next = await request<Board>(`/tasks/${taskId}${path}`, method, { expected_version: board.task.version, ...body });
      if (currentTask.current !== taskId) return false;
      update(next);
      // A refresh failure must not make a successful canonical write look undone.
      try { await refresh(); } catch { message.warning("清单已保存，其他页面稍后刷新即可。"); }
      return currentTask.current === taskId;
    } catch (error) {
      const text = (error as Error).message;
      if (currentTask.current !== taskId) return false;
      message.error(text);
      setFormError(text);
      // A concurrent edit can change the task version. Keep the unsaved form,
      // but reload the actual board so the next explicit retry uses its version.
      try {
        const latest = await request<Board>(`/tasks/${taskId}/board`);
        if (currentTask.current === taskId) update(latest);
      } catch { /* Original error remains visible. */ }
      return false;
    } finally { setBusy(false); }
  }
  async function save() {
    if (!draft || !draft.title.trim()) { setFormError("先写下要准备什么。"); return; }
    const body = {
      title: draft.title.trim(), group: draft.group,
      ...(draft.item_editable ? { item_id: draft.item_id || null } : {}),
      note: draft.note.trim(),
      ...(!draft.id ? { assignee_id: board.access === "owner" ? draft.assignee_id || null : user.id } : {}),
    };
    if (await mutate(draft.id ? `/entries/${draft.id}/details` : "/entries", draft.id ? "PATCH" : "POST", body)) setDraft(undefined);
  }
  return <section className="outing-preparation" aria-label="物品准备清单">
    <div className="outing-list-heading">
      <div><h3>要带的东西</h3><p>有了什么，和实际备好了什么，分开记。</p></div>
      {board.access !== "invited" && <button className="soft-button" disabled={busy} onClick={() => { setFormError(""); setDraft({ title: "", group: "confirm", item_id: "", item_editable: true, note: "", assignee_id: user.id }); }}><Plus size={16} />补充一项</button>}
    </div>
    <div className="outing-progress" aria-live="polite"><strong>已准备 {board.completed_count} / {board.total_count}</strong><progress max={Math.max(1, board.total_count)} value={board.completed_count} /></div>
    <div className="outing-entries">
      {board.entries.map((entry) => {
        const item = workspace.items.find((value) => value.id === entry.item_id);
        return <article className={`outing-entry ${entry.state === "ready" ? "is-ready" : ""}`} key={entry.id}>
          <input type="checkbox" aria-label={`已准备：${entry.title}`} checked={entry.state === "ready"} disabled={busy || !canEdit(entry)} onChange={(event) => void mutate(`/entries/${entry.id}`, "PATCH", { state: event.target.checked ? "ready" : "pending", note: entry.note })} />
          <div className="outing-entry-content">
            <div className="outing-entry-title">{item && <button className="outing-item-image" aria-label={`查看${item.name}`} onClick={() => onItem(item.id)}><ObjectVisual item={item} /></button>}<div><strong>{entry.title}</strong><div className="outing-entry-badges"><span className={`outing-availability ${entry.group}`}>{availability[entry.group]}</span><span>{entry.state === "ready" ? "已准备（用户报告）" : entry.state === "not_found" ? "还没找到" : "尚未准备好"}</span></div></div></div>
            {entry.note && <p className="outing-entry-note">{entry.note}</p>}
            <div className="outing-entry-actions">
              {board.access === "owner" ? <label className="outing-assignment">谁来准备<select aria-label={`由谁准备${entry.title}`} disabled={busy} value={entry.assignee_id || ""} onChange={(event) => void mutate(`/entries/${entry.id}/assignee`, "PATCH", { assignee_id: event.target.value || null })}><option value="">待认领</option><option value={user.id}>我</option>{people.map((person) => <option key={String(person.id)} value={String(person.id)}>{String(person.display_name)}</option>)}</select></label> : <span className="outing-person">{entry.assignee_id ? `${nameOf(entry.assignee_id)}负责` : "还没人认领"}</span>}
              {canEdit(entry) && <button className="quiet-button" disabled={busy} onClick={() => { setFormError(""); setDraft({ id: entry.id, title: entry.title, group: entry.group, item_id: entry.item_id || "", item_editable: board.access === "owner" || !!entry.item_id, note: entry.note, assignee_id: entry.assignee_id || "" }); }}><Pencil size={14} />修改</button>}
            </div>
          </div>
        </article>;
      })}
      {!board.entries.length && <EmptyState title="还没有清单项目">告诉阿圆这次想做什么，也可以自己补充。</EmptyState>}
    </div>
    {board.access === "owner" && <button className="quiet-button outing-invite-link" onClick={() => document.getElementById(`task-people-${board.task.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>想交给朋友？先邀请一起准备 <ArrowRight size={15} /></button>}
    <p className="form-note">勾选仅表示用户报告已备妥。新增项目不会自动变成已拥有的物品，也不会把活动标成完成。</p>
    <Modal open={!!draft} title={draft?.id ? "修改准备项目" : "还要准备什么"} onCancel={() => { if (!busy) setDraft(undefined); }} maskClosable={!busy} closable={!busy} destroyOnHidden footer={<><button className="soft-button" disabled={busy} onClick={() => setDraft(undefined)}>取消</button><button className="primary-button" disabled={busy || !draft?.title.trim()} onClick={() => void save()}>{busy ? "保存中…" : "保存到清单"}</button></>}>
      {draft && <form className="outing-entry-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>准备什么<input autoFocus maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="比如冰袋、充电宝，或再装一壶水" /></label>
        <label>现在有吗<select value={draft.group} onChange={(event) => setDraft({ ...draft, group: event.target.value as TaskEntry["group"] })}>{Object.entries(availability).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        {draft.item_editable && <label>关联已录入物品（可不选）<select value={draft.item_id} onChange={(event) => setDraft({ ...draft, item_id: event.target.value })}><option value="">不关联物品</option>{workspace.items.map((item) => <option key={item.id} value={item.id}>{item.name}{item.product.model ? ` · ${item.product.model}` : ""}</option>)}</select></label>}
        {board.access === "active" && <p className="form-note">不必分享私人库存。选“有”并填好说明就能一起准备；关联物品仅支持双方都能查看的物品。</p>}
        {!draft.id && board.access === "owner" && <label>谁来准备<select value={draft.assignee_id} onChange={(event) => setDraft({ ...draft, assignee_id: event.target.value })}><option value="">待认领</option><option value={user.id}>我</option>{people.map((person) => <option key={String(person.id)} value={String(person.id)}>{String(person.display_name)}</option>)}</select></label>}
        <label>补充说明<textarea rows={3} maxLength={2000} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="数量、放在哪里，或还需要确认的事情" /></label>
        {draft.id && <p className="form-note">修改名称、有无或关联物品后，会重新等待准备确认；只改说明会保留进度。</p>}
        {formError && <p className="outing-form-error" role="alert">{formError}</p>}
      </form>}
    </Modal>
  </section>;
}

function LegacyPlan({ value }: { value: unknown }) {
  if (typeof value === "string" || typeof value === "number")
    return <p>{String(value)}</p>;
  if (Array.isArray(value))
    return (
      <div>
        {value.map((entry, index) => (
          <LegacyPlan key={index} value={entry} />
        ))}
      </div>
    );
  if (value && typeof value === "object")
    return (
      <div>
        {Object.entries(value)
          .filter(
            ([key]) =>
              !["schema", "kind", "entries", "id"].includes(key) &&
              !key.endsWith("_id") &&
              !key.endsWith("_ids"),
          )
          .map(([key, entry]) => (
            <LegacyPlan key={key} value={entry} />
          ))}
      </div>
    );
  return null;
}

export function TaskCanvas({
  board,
  workspace,
  user,
  update,
  refresh,
  onItem,
  onCamera,
  onDiscuss,
}: BoardActions) {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState(false),
    [focus, setFocus] = useState(0),
    [summary, setSummary] = useState<string>();
  const currentTask = useTaskIdentity(board.task.id);
  useEffect(() => {
    setSummary(undefined);
    setFocus(
      Math.max(
        0,
        board.entries.findIndex((entry) => entry.state !== "ready"),
      ),
    );
  }, [board.task.id]);
  async function mark(entry: TaskEntry, state: string) {
    if (busy) return false;
    const taskId = board.task.id;
    setBusy(true);
    try {
      const next = await request<Board>(
          `/tasks/${taskId}/entries/${entry.id}`,
          "PATCH",
          { expected_version: board.task.version, state, note: entry.note },
        );
      if (currentTask.current !== taskId) return false;
      update(next);
      await refresh();
      return currentTask.current === taskId;
    } catch (error) {
      message.error((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const current = board.entries[focus];
  const currentItem = workspace.items.find((item) => item.id === current?.item_id);
  function afterSales() {
    const items = workspace.items.filter((item) =>
      board.task.item_ids.includes(item.id),
    );
    const completed = board.entries.filter((entry) => entry.state === "ready");
    const remaining = board.entries.filter((entry) => entry.state !== "ready");
    const entrySummary = (entry: TaskEntry) =>
      `- ${entry.title}：${(entry.group === "step" ? stepStates : states)[entry.state]}`;
    const reports = board.task.feedback.flatMap((feedback) => {
      const quote = typeof feedback.source_quote === "string" ? feedback.source_quote : "";
      const text = typeof feedback.text === "string" ? feedback.text : "";
      if (quote.trim()) return [`- 用户原话：${quote}`];
      return text.trim() ? [`- 反馈记录（未保留原话）：${text}`] : [];
    });
    setSummary(
      [
        `问题：${board.task.goal}`,
        ...items.map(
          (item) =>
            `物品：${item.name}${item.kind === "standard_product" ? `；型号：${item.product.model || "尚待确认"}` : ""}`,
        ),
        "已标记完成或备妥的项目（不代表故障已解决）：",
        ...(completed.length ? completed.map(entrySummary) : ["尚无已标记完成或备妥的项目。"]),
        "尚待处理的项目：",
        ...(remaining.length ? remaining.map(entrySummary) : ["暂无尚待处理的项目。"]),
        "用户反馈（保留历史记录，不代表当前故障已排除）：",
        ...(reports.length ? reports : ["尚无单独记录的用户反馈。"]),
        "仍待补充或核实：症状出现时间、错误代码、目前是否仍有故障，以及尚未完成检查的原因。",
      ].join("\n"),
    );
  }
  if (board.task.plan?.pending_action) return <div className="task-canvas"><ButlerActionCard taskId={board.task.id} refresh={refresh} onUpdated={async () => {
    const identity = board.task.id;
    const latest = await request<Board>(`/tasks/${identity}/board`);
    if (currentTask.current === identity) update(latest);
  }} /></div>;
  return (
    <div className="task-canvas">
      <div className="task-heading">
        <span className="eyebrow">
          {board.kind === "guidance"
            ? "一步一步，接着处理"
            : board.kind === "idea" ? "找个想试的玩法" : "同一件事，慢慢准备"}
        </span>
        <h2>{board.task.goal}</h2>
        <p>
          {board.access === "invited"
            ? "这是对方邀请你参与的必要摘要，接受后才能更新清单。"
            : board.kind === "guidance"
              ? "重点放在当前一步，反馈会保存在同一件事情里。"
              : board.kind === "idea" ? "先看看做法与条件，选中后和阿圆接着聊，试过再留下实际结果。" : "已有物品、尚未落实的需求与实际结果分别保留。"}
        </p>
      </div>
      {board.access === "invited" && (
        <button
          className="primary-button"
          disabled={busy}
          onClick={async () => {
            const taskId = board.task.id;
            setBusy(true);
            try {
              const next = await request<Board>(`/tasks/${taskId}/accept`, "POST");
              if (currentTask.current !== taskId) return;
              update(next);
              await refresh();
            } catch (error) {
              message.error((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          接受并一起准备
        </button>
      )}
      {board.kind === "idea" ? (
        <section className="idea-options" aria-label="这次的创意玩法">
          {board.entries.map((entry, index) => (
            <article className="idea-option" key={entry.id}>
              <span className="idea-option-label"><Sparkles size={16} />{entry.group === "step" ? `玩法与步骤 ${index + 1}` : labels[entry.group] || "一起探索"}</span>
              <h3>{entry.title}</h3>
              {entry.note && <p className="idea-option-note">{entry.note}</p>}
              {entry.item_id && workspace.items.some((item) => item.id === entry.item_id) && <button className="quiet-button" onClick={() => onItem(entry.item_id!)}>看看相关物品 <ArrowRight size={15} /></button>}
              {onDiscuss && <div className="idea-option-actions">
                {entry.group === "step" && <button className="primary-button" onClick={() => onDiscuss(entry, "try")}>就试这个</button>}
                <button className="soft-button" onClick={() => onDiscuss(entry, "discuss")}>继续聊这个</button>
              </div>}
            </article>
          ))}
          {!board.entries.length && <EmptyState title="这份方案还没有具体玩法">可以继续告诉阿圆想做什么，或补充手边物品的情况。</EmptyState>}
          {!!board.sources.length && (
            <section className="idea-sources" aria-label="这次参考的资料">
              <h3>参考与灵感出处</h3>
              {board.sources.map((source, index) => (
                <article key={String(source.id || index)}>
                  <strong>{String(source.title || "相关资料")}</strong>
                  {Boolean(source.quote) && <p>{String(source.quote)}</p>}
                  {typeof source.url === "string" && /^https?:\/\//i.test(source.url) && (
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      看看原分享 <ArrowRight size={14} />
                    </a>
                  )}
                </article>
              ))}
            </section>
          )}
        </section>
      ) : board.kind === "guidance" && current ? (
        <>
          <div className="step-track">
            {board.entries.map((entry, index) => (
              <button
                className={`${index === focus ? "active" : ""} ${entry.state === "ready" ? "done" : ""}`}
                key={entry.id}
                onClick={() => setFocus(index)}
              >
                <span>
                  {entry.state === "ready" ? <Check size={14} /> : index + 1}
                </span>
                {entry.title}
              </button>
            ))}
          </div>
          <article className="guidance-card">
            <h3>
              第 {focus + 1} 步 · {current.title}
            </h3>
            {currentItem && (
                <div className="guidance-visual">
                  <ObjectVisual item={currentItem} />
                  <small>请核对你手边的实际物品</small>
                </div>
              )}
            <p className="guidance-copy">
              {current.note || "先核对这一项，再根据你的实际反馈继续。"}
            </p>
            {current.state === "ready" && <p className="form-note">{current.group === "step" ? "用户报告完成步骤；是否解决问题，仍以实际反馈为准。" : "用户报告资源已备妥；这不代表检查已完成或故障已解决。"}</p>}
            <div className="guidance-buttons">
              <button
                className="primary-button"
                disabled={busy || board.access === "invited"}
                onClick={async () => {
                  if (await mark(current, "ready"))
                    setFocus(Math.min(focus + 1, board.entries.length - 1));
                }}
              >
                做到了
                <Check size={18} />
              </button>
              <button
                className="soft-button"
                disabled={busy || board.access === "invited"}
                onClick={() => void mark(current, "not_found")}
              >
                我没找到
              </button>
              <button
                className="soft-button"
                disabled={busy || board.access === "invited"}
                onClick={() => void mark(current, "unchanged")}
              >
                没有变化
              </button>
            </div>
            <div className="guidance-helper">
              <Companion small />
              <button className="quiet-button" onClick={onCamera}>
                不确定？拍张照片，再继续聊。
              </button>
              <button
                className="icon-button"
                title="听一遍当前步骤"
                onClick={() => {
                  if (!speak(current.title + "。" + current.note))
                    message.info("当前浏览器无法朗读，请直接阅读文字。");
                }}
              >
                <Volume2 size={19} />
              </button>
            </div>
            <p className="form-note">
              这是当前事项中整理的步骤；具体操作仍需与适用资料核对。
            </p>
          </article>
          <button className="soft-button" onClick={afterSales}>
            <Clipboard size={17} />
            整理售后问题说明
          </button>
        </>
      ) : board.kind !== "legacy" ? (
        <>
          <PreparationList {...{ board, workspace, user, update, refresh, onItem, onCamera }} />
          {workspace.items
            .filter(
              (item) =>
                board.task.constraints?.excluded_item_ids &&
                Array.isArray(board.task.constraints.excluded_item_ids) &&
                board.task.constraints.excluded_item_ids.includes(item.id),
            )
            .map((item) => (
              <div className="excluded-resource" key={item.id}>
                <ObjectVisual item={item} />
                <p>{item.name}目前不适合使用，这次先不带。</p>
              </div>
            ))}
        </>
      ) : (
        <section className="legacy-plan">
          <FileText size={26} />
          <h3>已有方案与实际反馈</h3>
          <LegacyPlan value={board.task.plan} />
          {board.task.feedback.map((feedback, index) => (
            <p key={index}>{String(feedback.text || "")}</p>
          ))}
          <p className="form-note">
            这份原方案继续保留，可以在原话题中说明新条件和实际结果。
          </p>
        </section>
      )}
      <Modal
        open={summary !== undefined}
        title="给售后的一份问题说明"
        onCancel={() => setSummary(undefined)}
        footer={
          <button
            className="primary-button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(summary || "");
                message.success("已复制，请自行选择发送给谁。");
              } catch {
                message.info("可以在上方选中文字后复制。");
              }
            }}
          >
            <Clipboard size={17} />
            复制说明
          </button>
        }
      >
        <p className="form-note">
          只包含已知物品和实际记录，请补充或纠正后再自行发送。
        </p>
        <textarea
          className="after-sales-text"
          aria-label="售后问题说明"
          value={summary || ""}
          onChange={(event) => setSummary(event.target.value)}
        />
      </Modal>
    </div>
  );
}

export function TaskRail({
  board,
  workspace,
  user,
  update,
  refresh,
  onItem,
  onCamera,
}: BoardActions) {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState(false),
    [invite, setInvite] = useState(""),
    [resultText, setResultText] = useState(""),
    [outcome, setOutcome] = useState("partial");
  const currentTask = useTaskIdentity(board.task.id);
  useEffect(() => { setInvite(""); setResultText(""); setOutcome("partial"); }, [board.task.id]);
  async function feedback() {
    if (busy || !resultText.trim()) return;
    const taskId = board.task.id;
    setBusy(true);
    try {
      let next = await request<Task>(
        `/tasks/${taskId}/feedback`,
        "POST",
        { text: resultText, outcome, expected_version: board.task.version },
      );
      if (outcome === "success")
        next = await request<Task>("/tasks", "POST", {
          goal: next.goal,
          item_ids: next.item_ids,
          constraints: next.constraints,
          plan: next.plan,
          task_id: next.id,
          expected_version: next.version,
          status: "completed",
        });
      const latest = await request<Board>(`/tasks/${taskId}/board`);
      if (currentTask.current !== taskId) return;
      update(latest);
      setResultText("");
      await refresh();
      message.success("实际反馈已保留在同一件事情里。");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const item = workspace.items.find((item) =>
    board.task.item_ids.includes(item.id),
  );
  if (board.task.plan?.pending_action) return <section className="rail-section"><h2>管家待办</h2><p className="empty-note">先核对操作卡片中的接收人和内容。确认结果和回执会保留在同一件事情里。</p></section>;
  return (
    <>
      {board.kind !== "checklist" && <section className="rail-section">
        <h2>{board.kind === "guidance" ? "这件物品" : board.kind === "idea" ? "围绕这些物品" : "准备清单"}</h2>
        {board.kind === "idea" ? (
          <div className="idea-related-items">
            {workspace.items.filter((value) => board.task.item_ids.includes(value.id)).map((value) => (
              <button className="context-item" key={value.id} onClick={() => onItem(value.id)}>
                <ObjectVisual item={value} />
                <strong>{value.name}</strong>
                <ArrowRight size={16} />
              </button>
            ))}
            {!item && <p className="empty-note">还没有关联具体物品，可以在对话中一起核对。</p>}
          </div>
        ) : board.kind === "guidance" && item ? (
          <button className="context-item" onClick={() => onItem(item.id)}>
            <ObjectVisual item={item} />
            <div>
              <strong>{item.name}</strong>
              <p>
                {item.product.model
                  ? "已记录型号 · " + item.product.model
                  : "型号尚待确认"}
              </p>
            </div>
            <ArrowRight size={17} />
          </button>
        ) : (
          <p className="empty-note">步骤和原方案已保留在当前事项中，可以接着和阿圆核对。</p>
        )}
      </section>}
      <section className="rail-section" id={`task-people-${board.task.id}`}>
        <h2>{board.kind === "guidance" ? "可核对的资料" : "一起准备"}</h2>
        {board.kind === "guidance" ? (
          board.sources.length ? (
            board.sources.map((source) => (
              <article className="source-card" key={String(source.id)}>
                <FileText size={22} />
                <strong>{String(source.title)}</strong>
                <p>{String(source.quote || "")}</p>
                {typeof source.url === "string" &&
                  source.url.startsWith("https://") && (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      打开相关资料
                      <ArrowRight size={16} />
                    </a>
                  )}
              </article>
            ))
          ) : (
            <p className="empty-note">
              还没有取得适用资料。未知条件会继续保留，不用演示步骤冒充说明书。
            </p>
          )
        ) : (
          <>
            <div className="member-avatars">
              <span className="person-avatar" title={board.access === "owner" ? "我 · 发起人" : "发起人"}>{board.access === "owner" ? "我" : "主"}</span>
              {board.participants.map((person) => (
                <span
                  key={String(person.id)}
                  title={
                    String(person.display_name) +
                    " · " +
                    (person.status === "active" ? "已接手" : "待接手")
                  }
                  className={`person-avatar ${person.status === "active" ? "" : "pending"}`}
                >
                  {person.id === user.id ? "我" : String(person.display_name).slice(0, 1)}
                </span>
              ))}
            </div>
            {board.access === "owner" && (
              <div className="inline-form">
                <select
                  aria-label="邀请一起准备"
                  value={invite}
                  onChange={(event) => setInvite(event.target.value)}
                >
                  <option value="">选择一位同行的人</option>
                  {workspace.friends
                    .filter(
                      (friend) =>
                        friend.accepted &&
                        !board.participants.some(
                          (person) => person.id === friend.id,
                        ),
                    )
                    .map((friend) => (
                      <option key={friend.id} value={friend.id}>
                        {friend.display_name}
                      </option>
                    ))}
                </select>
                <button
                  className="soft-button"
                  disabled={!invite || busy}
                  onClick={async () => {
                    const taskId = board.task.id;
                    setBusy(true);
                    try {
                      const next = await request<Board>(
                          `/tasks/${taskId}/shares`,
                          "POST",
                          { user_id: invite },
                        );
                      if (currentTask.current !== taskId) return;
                      update(next);
                      setInvite("");
                      await refresh();
                    } catch (error) {
                      message.error((error as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  邀请
                </button>
              </div>
            )}
            <small className="muted">
              只分享目标、清单和已获准物品，不转发私人对话；对方接受后再一起更新。
            </small>
          </>
        )}
      </section>
      {board.access === "owner" && (
        <section className="rail-section actual-feedback">
          <h2>实际尝试后</h2>
          <label>
            结果怎样
            <select
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
            >
              <option value="partial">部分有用，还要调整</option>
              <option value="failure">没有达到目标</option>
              <option value="success">目标已实际完成</option>
              <option value="preference">我的想法变了</option>
            </select>
          </label>
          <textarea
            aria-label="实际结果反馈"
            rows={3}
            value={resultText}
            onChange={(event) => setResultText(event.target.value)}
            placeholder="写下实际发生的结果，而不只是计划"
          />
          <button
            className="primary-button full-width"
            disabled={busy || !resultText.trim()}
            onClick={() => void feedback()}
          >
            留下实际反馈
          </button>
        </section>
      )}
      <button className="soft-button full-width" onClick={onCamera}>
        <MessageCircle size={17} />
        拍给物伴看，接着聊
      </button>
    </>
  );
}
