import TeachingDiagram from "./TeachingDiagram";
import StepIllustration from "./StepIllustration";
import "../teaching-diagram.css";
import CameraGuidance from "./CameraGuidance";
import "../camera-guidance.css";
import { useEffect, useRef, useState } from "react";
import { App as AntApp } from "antd";
import { ArrowRight, Check, FileText, MessageCircle, Plus } from "lucide-react";
import {
  request,
  type Task,
  type TaskBoard as Board,
  type TaskEntry,
  type User,
  type Workspace,
  type Run,
} from "../api";
import { Companion, EmptyState, ObjectVisual } from "./shared";

export type BoardActions = {
  board: Board;
  workspace: Workspace;
  user: User;
  update: (board: Board) => void;
  refresh: () => Promise<unknown>;
  onItem: (id: string) => void;
  onCamera: () => void;
  onRun: (run: Run) => Promise<void>;
  running: boolean;
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

export function GuidanceTools({
  board,
  update,
  photos = [],
  initial = false,
  onRun,
  running = false,
  explain,
}: {
  board: Board;
  update: (board: Board) => void;
  photos?: string[];
  initial?: boolean;
  onRun: (run: Run) => Promise<void>;
  running?: boolean;
  explain: (text?: string) => Promise<void> | void;
}) {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState(false);
  const actionPending = useRef(false);
  const active = (
    board.task.plan.guidance as { active_step_id?: string } | undefined
  )?.active_step_id;
  const current =
    board.entries.find((entry) => entry.id === active && entry.state !== "ready") ||
    board.entries.find((entry) => entry.state !== "ready");
  const lesson = (
    board.task.plan.guidance as {
      lesson?: {
        phase: string;
        inputs: Record<string, unknown>;
        definition: { steps: { id: string; requires_input?: string }[] };
      };
    }
  )?.lesson;
  const inputKey = lesson?.definition.steps.find(
    (step) => step.id === current?.id,
  )?.requires_input;
  const waitingInput = !!inputKey && !lesson?.inputs[inputKey];
  const overview = (board.task.plan.guidance as {overview?: unknown})?.overview;
  const outline = Array.isArray(overview)
    ? overview.filter((value): value is string => typeof value === "string")
    : lesson ? board.entries.map((entry) => entry.title) : [];
  async function confirm() {
    if (!current || current.state === "ready" || busy || running || actionPending.current) return;
    actionPending.current = true;
    setBusy(true);
    try {
      const key = `${board.task.id}:${board.task.version}:${current.id}`;
      const saved = sessionStorage.getItem("lesson-receipt");
      const previous = saved ? JSON.parse(saved) : null;
      const receipt = previous?.key === key ? previous.id : crypto.randomUUID();
      sessionStorage.setItem(
        "lesson-receipt",
        JSON.stringify({ key, id: receipt }),
      );
      const next = await request<Run>(
        `/tasks/${board.task.id}/guidance-feedback`,
        "POST",
        {
          expected_version: board.task.version,
          step_id: current.id,
          outcome: "done",
          receipt_id: receipt,
        },
      );
      await onRun(next);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }
  async function discuss(text?: string) {
    if (busy || running || actionPending.current) return;
    actionPending.current = true;
    setBusy(true);
    try { await explain(text); }
    catch (error) { message.error((error as Error).message); }
    finally { actionPending.current = false; setBusy(false); }
  }
  if (board.task.status === "completed")
    return (
      <p className="muted">这次教学已按你的反馈完成。可以继续聊成品效果。</p>
    );
  if (board.task.status === "cancelled") return <p className="muted">这件事已结束，想继续可以在聊天里说明。</p>;
  const overviewContent = outline.length > 0 && (
    <details className="guidance-overview">
      <summary>这次怎么做 · 查看总览</summary>
      <ol>{outline.map((title, index) => <li key={index}>{title}</li>)}</ol>
    </details>
  );
  if (!current?.guidance)
    return (
      <section className="guidance-tools" aria-label="接着处理当前问题">
        {overviewContent}
        <p className="muted">{running || busy ? "正在接着处理你的反馈…" : board.entries.length && !current ? "前面的步骤已确认，可以补充看到的现象，接着处理原来的问题。" : "还没有可操作的当前步骤，可以接着聊聊要做什么。"}</p>
        <button className="soft-button" disabled={busy || running}
          onClick={() => void discuss(board.entries.length && !current ? "前面的步骤我已经做过了，请接着帮我处理原来的问题。" : "请帮我明确这件事接下来怎么做。")}>接着处理</button>
      </section>
    );
  const canConfirm = !waitingInput && !running && !busy && lesson?.phase !== "paused" && board.access === "owner";
  return (
    <section className="guidance-tools" aria-label="当前回答的辅助工具">
      {overviewContent}
      <p className="muted">
        {lesson
          ? `第 ${board.entries.findIndex((entry) => entry.id === current.id) + 1} / ${board.total_count} 步`
          : "当前"}{" "}
        · {current.title}
      </p>
      {initial && <p className="saved-step">{current.guidance.instruction}</p>}
      <StepIllustration
        key={board.task.id + current.id}
        board={board}
        entry={current}
        update={update}
        enabled={!running && !busy}
        photos={photos}
      />
      <div className="guidance-assists">
        <button
          className="primary-button"
          disabled={!canConfirm}
          onClick={() => void confirm()}
        >
          <Check size={17} />
          {waitingInput ? "先告诉阿圆材料条件" : "这步做好了"}
        </button>
        <button
          className="quiet-button"
          disabled={busy || running}
          onClick={() => void discuss()}
        >
          这一步怎么做？
        </button>
        <TeachingDiagram
          key={board.task.id + current.id}
          board={board}
          entry={current}
          update={update}
          photoIds={photos}
          onConfirm={canConfirm ? confirm : undefined}
        />
        <CameraGuidance
          key={"camera-" + board.task.id}
          board={board}
          entry={current}
          onConfirm={canConfirm ? confirm : undefined}
        />
      </div>
    </section>
  );
}

export function TaskCanvas({
  board,
  workspace,
  user,
  update,
  refresh,
  onItem,
  onCamera,
  onRun,
  running,
}: BoardActions) {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState(false);
  return (
    <div className="task-canvas">
      <div className="task-heading">
        <span className="eyebrow">
          {board.kind === "guidance"
            ? "一步一步，接着处理"
            : "同一件事，慢慢准备"}
        </span>
        <h2>{board.task.goal}</h2>
        <p>
          {board.access === "invited"
            ? "这是对方邀请你参与的必要摘要，接受后才能更新清单。"
            : board.kind === "guidance"
              ? "重点放在当前一步，反馈会保存在同一件事情里。"
              : "已有物品、尚未落实的需求与实际结果分别保留。"}
        </p>
      </div>
      {board.access === "invited" && (
        <button
          className="primary-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              update(
                await request<Board>(`/tasks/${board.task.id}/accept`, "POST"),
              );
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
      {board.kind !== "legacy" ? (
        <>
          <div className="plan-overview">
            {(["owned", "buy", "borrow", "confirm"] as const).map((group) => {
              const entries = board.entries.filter(
                (entry) => entry.group === group,
              );
              return (
                entries.length > 0 && (
                  <div className="plan-group" key={group}>
                    <span className="group-label">{labels[group]}</span>
                    <div className="plan-group-items">
                      {entries.map((entry) => (
                        <button
                          key={entry.id}
                          onClick={() =>
                            entry.item_id && onItem(entry.item_id!)
                          }
                          disabled={!entry.item_id}
                        >
                          {entry.item_id &&
                            workspace.items.find(
                              (item) => item.id === entry.item_id,
                            ) && (
                              <ObjectVisual
                                item={workspace.items.find(
                                  (item) => item.id === entry.item_id,
                                )!}
                              />
                            )}
                          <span>{entry.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              );
            })}
          </div>
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
          {!board.entries.length && (
            <EmptyState title="先说说目标，必要时再整理清单" />
          )}
          <p className="form-note">
            新增需求不会自动进入物品库存。清单进度即时保存，准备就绪也不等于活动已经完成。
          </p>
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
  async function mark(entry: TaskEntry, checked: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      update(
        await request<Board>(
          `/tasks/${board.task.id}/entries/${entry.id}`,
          "PATCH",
          {
            expected_version: board.task.version,
            state: checked ? "ready" : "pending",
            note: entry.note,
          },
        ),
      );
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function feedback() {
    if (busy || !resultText.trim()) return;
    setBusy(true);
    try {
      let next = await request<Task>(
        `/tasks/${board.task.id}/feedback`,
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
      update(await request<Board>(`/tasks/${board.task.id}/board`));
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
  return (
    <>
      <section className="rail-section">
        <h2>{board.kind === "guidance" ? "这件物品" : "准备清单"}</h2>
        {board.kind === "guidance" && item ? (
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
          <>
            <div className="checklist-progress">
              <strong>
                已准备 {board.completed_count} / {board.total_count}
              </strong>
              <progress
                max={Math.max(1, board.total_count)}
                value={board.completed_count}
              />
              <Companion small />
            </div>
            <div className="checklist-entries">
              {board.entries.map((entry) => (
                <div className="checklist-entry" key={entry.id}>
                  <input
                    type="checkbox"
                    aria-label={`准备${entry.title}`}
                    checked={entry.state === "ready"}
                    disabled={
                      busy ||
                      board.access === "invited" ||
                      (board.access !== "owner" &&
                        !!entry.assignee_id &&
                        entry.assignee_id !== user.id)
                    }
                    onChange={(event) => void mark(entry, event.target.checked)}
                  />
                  <button
                    disabled={!entry.item_id}
                    className="entry-detail"
                    onClick={() => entry.item_id && onItem(entry.item_id)}
                  >
                    {entry.item_id &&
                      workspace.items.find(
                        (item) => item.id === entry.item_id,
                      ) && (
                        <ObjectVisual
                          item={workspace.items.find(
                            (item) => item.id === entry.item_id,
                          )!}
                        />
                      )}
                    <div>
                      <strong>{entry.title}</strong>
                      <p>
                        {entry.state === "ready"
                          ? "已准备（用户报告）"
                          : labels[entry.group]}
                        {entry.updated_by
                          ? " · " +
                            (entry.updated_by === user.id
                              ? "我"
                              : workspace.friends.find(
                                  (friend) => friend.id === entry.updated_by,
                                )?.display_name || "参与者") +
                            "更新"
                          : ""}
                      </p>
                    </div>
                  </button>
                  {board.access === "owner" ? (
                    <select
                      className="entry-assignment"
                      aria-label={`分配${entry.title}`}
                      value={entry.assignee_id || ""}
                      disabled={busy}
                      onChange={async (event) => {
                        setBusy(true);
                        try {
                          update(
                            await request<Board>(
                              `/tasks/${board.task.id}/entries/${entry.id}/assignee`,
                              "PATCH",
                              {
                                expected_version: board.task.version,
                                assignee_id: event.target.value || null,
                              },
                            ),
                          );
                          await refresh();
                        } catch (error) {
                          message.error((error as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <option value="">待认领</option>
                      <option value={user.id}>我</option>
                      {board.participants
                        .filter((person) => person.status === "active")
                        .map((person) => (
                          <option
                            key={String(person.id)}
                            value={String(person.id)}
                          >
                            {String(person.display_name)}
                          </option>
                        ))}
                    </select>
                  ) : entry.assignee_id ? (
                    <small>
                      {entry.assignee_id === user.id ? "交给我" : "已有负责人"}
                    </small>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        )}
      </section>
      <section
        className="rail-section"
        hidden={board.kind === "guidance" && !board.sources.length}
      >
        <h2>{board.kind === "guidance" ? "可核对的资料" : "一起准备"}</h2>
        {board.kind === "guidance" ? (
          board.sources.length ? (
            board.sources.map((source) => (
              <article className="source-card" key={String(source.id)}>
                <FileText size={22} />
                <strong>{String(source.title)}</strong>
                <p>{String(source.quote || "")}</p>
                {typeof source.url === "string" &&
                  (source.url.startsWith("https://") ||
                    source.url.startsWith("/api/assets/")) && (
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
              <span className="person-avatar">我</span>
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
                  {String(person.display_name).slice(-1)}
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
                    setBusy(true);
                    try {
                      update(
                        await request<Board>(
                          `/tasks/${board.task.id}/shares`,
                          "POST",
                          { user_id: invite },
                        ),
                      );
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
      {board.access === "owner" && board.kind !== "guidance" && (
        <details className="rail-section actual-feedback">
          <summary>补充结果</summary>
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
        </details>
      )}
      <button className="soft-button full-width" onClick={onCamera}>
        <MessageCircle size={17} />
        拍给物伴看，接着聊
      </button>
    </>
  );
}
