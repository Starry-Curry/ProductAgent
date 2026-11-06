"use client";
import { useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import type { Task, Person } from "@/lib/domain";
import type { API } from "./types";
import { calendarToday, dueDateLabel } from "@/lib/companion/task-dates";
export function TaskDate({
  task,
  actor,
  api,
  refresh,
  notify,
  readOnly = false,
}: {
  task: Task;
  actor: Person;
  api: API;
  refresh: () => Promise<unknown>;
  notify: (s: string) => void;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState(task.dueDate || calendarToday()),
    [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const label = dueDateLabel(task.dueDate, task.status === "用户确认完成");
  const canEdit =
    !readOnly &&
    actor !== "friend" &&
    (task.assignee === actor ||
      task.createdBy === actor ||
      (!task.createdBy && task.logs[0]?.by === actor));
  async function save() {
    const selectedDate = input.current ? input.current.value : value;
    setBusy(true);
    try {
      await api("/api/workspace", {
        action: "taskDate",
        taskId: task.id,
        dueDate: selectedDate,
      });
      await refresh();
      setEditing(false);
      notify("待办日期已保存");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={"wj-task-date " + label.tone}>
      {editing ? (
        <div className="wj-task-date-editor">
          <label>
            待办日期
            <input
              type="date"
              ref={input}
              aria-label="修改待办日期"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onInput={(e) => setValue(e.currentTarget.value)}
            />
          </label>
          <button className="wj-btn compact" disabled={busy} onClick={save}>
            保存日期
          </button>
          <button
            className="wj-link"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            取消
          </button>
        </div>
      ) : (
        <>
          <CalendarDays size={15} />
          <span>{label.text}</span>
          {canEdit && (
            <button
              className="wj-link"
              onClick={() => {
                setValue(task.dueDate || calendarToday());
                setEditing(true);
              }}
            >
              {task.dueDate ? "改日期" : "设置日期"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
