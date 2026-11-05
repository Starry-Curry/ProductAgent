import TeachingDiagram from "./TeachingDiagram";
import "../teaching-diagram.css";
import CameraGuidance from "./CameraGuidance";
import "../camera-guidance.css";
import { useEffect, useState } from "react";
import { App as AntApp, Modal } from "antd";
import {
  ArrowRight,
  Check,
  Clipboard,
  FileText,
  MessageCircle,
  Plus,
  Volume2,
} from "lucide-react";
import {
  request,
  type Task,
  type TaskBoard as Board,
  type TaskEntry,
  type User,
  type Workspace,
  type Run,
} from "../api";
import { Companion, EmptyState, ObjectVisual, speak } from "./shared";

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
  const [busy, setBusy] = useState(false),
    [focus, setFocus] = useState(0),
    [summary, setSummary] = useState<string>(),
    [observation, setObservation] = useState("");
  useEffect(() => {
    const progress = board.task.plan.guidance as
      { active_step_id?: string } | undefined;
    const active = board.entries.findIndex(
      (entry) => entry.id === progress?.active_step_id,
    );
    setFocus(
      Math.max(
        0,
        active >= 0
          ? active
          : board.entries.findIndex((entry) => entry.state !== "ready"),
      ),
    );
  }, [board.task.id, board.task.version]);
  async function report(outcome: string) {
    if (busy || running || !current) return;
    setBusy(true);
    try {
      const receiptKey = `${board.task.id}:${board.task.version}:${current.id}:${outcome}:${observation}`;
      const stored = sessionStorage.getItem("guidance-feedback");
      const previous = stored ? JSON.parse(stored) : null;
      const receipt =
        previous?.key === receiptKey ? previous.id : crypto.randomUUID();
      sessionStorage.setItem(
        "guidance-feedback",
        JSON.stringify({ key: receiptKey, id: receipt }),
      );
      const next = await request<Run>(
        `/tasks/${board.task.id}/guidance-feedback`,
        "POST",
        {
          expected_version: board.task.version,
          step_id: current.id,
          outcome,
          note: observation,
          receipt_id: receipt,
        },
      );
      update(await request<Board>(`/tasks/${board.task.id}/board`));
      setObservation("");
      await onRun(next);
    } catch (error) {
      message.error((error as Error).message);
      update(await request<Board>(`/tasks/${board.task.id}/board`));
    } finally {
      setBusy(false);
    }
  }
  const current = board.entries[focus];
  function afterSales() {
    const items = workspace.items.filter((item) =>
      board.task.item_ids.includes(item.id),
    );
    setSummary(
      [
        `问题：${board.task.goal}`,
        ...items.map(
          (item) =>
            `物品：${item.name}；型号：${item.product.model || "尚待确认"}`,
        ),
        "已做检查与实际报告：",
        ...board.entries.map(
          (entry) =>
            `- ${entry.title}：${states[entry.state]}${entry.note ? "；" + entry.note : ""}`,
        ),
        "补充症状、时间与错误代码：",
        "未执行的操作与仍待确认的信息：",
      ].join("\n"),
    );
  }
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
      {board.kind === "guidance" && current ? (
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
            {board.task.item_ids[0] &&
              workspace.items.find(
                (item) => item.id === board.task.item_ids[0],
              ) && (
                <div className="guidance-visual">
                  <ObjectVisual
                    item={workspace.items.find(
                      (item) => item.id === board.task.item_ids[0],
                    )!}
                  />
                  <small>请核对你手边的实际物品</small>
                </div>
              )}
            <p className="guidance-copy">
              {current.guidance?.instruction ||
                current.note ||
                "先核对这一项，再根据你的实际反馈继续。"}
            </p>
            {current.guidance && (
              <div className="step-details">
                {current.guidance.success_signal && (
                  <p>
                    <strong>留意这个信号</strong>
                    {current.guidance.success_signal}
                  </p>
                )}
                {current.guidance.caution && (
                  <p className="step-caution">{current.guidance.caution}</p>
                )}
                {current.guidance.observed_quote && (
                  <p className="step-observation">
                    你的实际报告：{current.guidance.observed_quote}
                  </p>
                )}
                {current.guidance.evidence?.map((evidence, index) => {
                  const source = board.sources.find(
                    (source) => source.id === evidence.source_id,
                  );
                  return (
                    <details key={index}>
                      <summary>
                        {String(source?.title || "步骤依据")}
                        {evidence.page ? ` · 第 ${evidence.page} 页` : ""}
                      </summary>
                      <blockquote>{evidence.quote}</blockquote>
                      {typeof source?.url === "string" &&
                        source.url.startsWith("https://") && (
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            核对原文
                          </a>
                        )}
                    </details>
                  );
                })}
                <textarea
                  aria-label="这一步的实际情况"
                  placeholder="可补充你看到的灯、声音或其他情况…"
                  value={observation}
                  onChange={(event) => setObservation(event.target.value)}
                  maxLength={1600}
                />
              </div>
            )}
            <TeachingDiagram board={board} entry={current} update={update} />
            <div className="guidance-buttons">
              <button
                className="primary-button"
                disabled={
                  busy ||
                  running ||
                  board.access !== "owner" ||
                  !current.guidance
                }
                onClick={async () => {
                  await report("done");
                }}
              >
                {running ? "阿圆正在接着看…" : "检查过了"}
                <Check size={18} />
              </button>
              <button
                className="soft-button"
                disabled={
                  busy ||
                  running ||
                  board.access !== "owner" ||
                  !current.guidance
                }
                onClick={() => void report("not_found")}
              >
                我没找到
              </button>
              <button
                className="soft-button"
                disabled={
                  busy ||
                  running ||
                  board.access !== "owner" ||
                  !current.guidance
                }
                onClick={() => void report("unchanged")}
              >
                没有变化
              </button>
            </div>
            <CameraGuidance board={board} entry={current} />
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
      <section className="rail-section">
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
