"use client";
import { useState } from "react";
import { people, type Item, type Person, type Task } from "@/lib/domain";
export type Action = (
  action: string,
  p: Record<string, unknown>,
  message?: string,
) => Promise<boolean>;
export function TaskComposer({
  items,
  actor,
  act,
  initialItem = "",
  initialTitle = "",
}: {
  items: Item[];
  actor: Person;
  act: Action;
  initialItem?: string;
  initialTitle?: string;
}) {
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  if (actor === "friend") return <p>当前演示角色尚未加入家庭。</p>;
  return (
    <form
      className="task-composer"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        setBusy(true);
        try {
          if (
            await act(
              "quickTask",
              {
                requestId,
                title: f.get("title"),
                kind: f.get("kind"),
                assignee: f.get("assignee"),
                itemId: f.get("itemId"),
              },
              "事项已保存，对方打开家庭事项即可看到",
            )
          ) {
            setRequestId(crypto.randomUUID());
            form.reset();
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        要做的事或提醒
        <textarea
          name="title"
          required
          maxLength={120}
          defaultValue={initialTitle}
          placeholder="例如：保温壶还没修好，今天先不要用"
        />
      </label>
      <div className="form-grid">
        <label>
          类型
          <select name="kind" aria-label="类型">
            <option value="repair">维修</option>
            <option value="clean">清洗</option>
            <option value="purchase">购买 / 更换</option>
            <option value="notice">重要提醒</option>
          </select>
        </label>
        <label>
          交给谁
          <select aria-label="交给谁" name="assignee" defaultValue={actor}>
            <option value="lin">小林</option>
            <option value="dad">爸爸</option>
          </select>
        </label>
      </div>
      <details>
        <summary>关联一件物品（可选）</summary>
        <label>
          关联物品
          <select name="itemId" defaultValue={initialItem}>
            <option value="">不关联物品</option>
            {items
              .filter((i) => i.shared)
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
          </select>
        </label>
      </details>
      <button className="button" disabled={busy}>
        记下来 / 交给家人
      </button>
    </form>
  );
}
export function TaskList({
  tasks,
  actor,
  act,
  elder = false,
}: {
  tasks: Task[];
  actor: Person;
  act: Action;
  elder?: boolean;
}) {
  const [busy, setBusy] = useState("");
  const visible = tasks
    .filter(
      (t) => t.status !== "用户确认完成" && (!elder || t.assignee === actor),
    )
    .sort((a, b) => Number(b.kind === "notice") - Number(a.kind === "notice"));
  async function update(t: Task, action: string, p: Record<string, unknown>) {
    setBusy(t.id);
    try {
      await act(action, p);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="task-list">
      {!visible.length && <p className="empty-tasks">暂时没有需要处理的事。</p>}
      {visible.map((t) => (
        <article
          className={`simple-task ${t.kind === "notice" ? "important-task" : ""}`}
          key={t.id}
        >
          <small>
            {t.kind === "notice" ? "重要提醒" : "待办"} · {people[t.assignee]}
            {t.createdBy ? ` · ${people[t.createdBy]}留下的` : ""}
          </small>
          <h3>{t.title}</h3>
          {t.assignee === actor &&
            (t.kind === "notice" ? (
              <>
                <p>
                  {t.acknowledged
                    ? "已收到，提醒仍然有效。"
                    : "请确认你已看到这条提醒。"}
                </p>
                <button
                  className="button"
                  disabled={!!busy || t.acknowledged}
                  onClick={() => update(t, "ackTask", { taskId: t.id })}
                >
                  {t.acknowledged ? "我已知晓" : "我知道了"}
                </button>
              </>
            ) : (
              <div className="inline">
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() =>
                    update(t, "task", {
                      taskId: t.id,
                      status: "用户确认完成",
                      text: "用户确认已完成",
                    })
                  }
                >
                  我已完成
                </button>
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() =>
                    update(t, "task", {
                      taskId: t.id,
                      status: "未解决",
                      text: "需要家人继续协助",
                    })
                  }
                >
                  还需要帮忙
                </button>
              </div>
            ))}
          {t.status === "未解决" && <p>仍需协助</p>}
          {!elder && (
            <details>
              <summary>查看记录 / 交接</summary>
              {t.logs.map((l, n) => (
                <p key={n}>
                  {people[l.by]}：{l.text}
                </p>
              ))}
              {t.assignee === actor && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    update(t, "task", {
                      taskId: t.id,
                      status: f.get("status"),
                      assignee: f.get("assignee"),
                      text: f.get("text"),
                    });
                  }}
                >
                  <label>
                    补充说明
                    <input name="text" />
                  </label>
                  <label>
                    交给谁
                    <select
                      aria-label="交给谁"
                      name="assignee"
                      defaultValue={t.assignee}
                    >
                      <option value="lin">小林</option>
                      <option value="dad">爸爸</option>
                    </select>
                  </label>
                  <label>
                    处理状态
                    <select name="status" defaultValue={t.status}>
                      <option>待处理</option>
                      <option>进行中</option>
                      <option>未解决</option>
                      <option>用户确认完成</option>
                    </select>
                  </label>
                  {t.kind === "notice" && (
                    <p>
                      只有确认提醒已不再适用时，才标记完成；知晓提醒不代表设备已修好。
                    </p>
                  )}
                  <button className="button secondary" disabled={!!busy}>
                    更新记录
                  </button>
                </form>
              )}
            </details>
          )}
        </article>
      ))}
    </div>
  );
}
