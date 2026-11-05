import { App as AntApp } from "antd";
import { Check, ClipboardList, Volume2 } from "lucide-react";
import { request, type Reminder, type User, type Workspace } from "../api";
import { ObjectVisual, speak } from "./shared";
const labels: Record<string, string> = {
  pending: "待处理",
  read: "已读",
  in_progress: "处理中",
  completed: "报告完成",
};
export default function Care({
  workspace,
  user,
  refresh,
  onItem,
  householdId,
  compact = false,
}: {
  workspace: Workspace;
  user: User;
  refresh: () => Promise<unknown>;
  onItem: (item: string) => void;
  householdId?: string;
  compact?: boolean;
}) {
  const { message } = AntApp.useApp();
  const reminders = workspace.reminders.filter(
    (reminder) => !householdId || reminder.household_id === householdId,
  );
  async function feedback(reminder: Reminder, action: string) {
    try {
      await request(`/reminders/${reminder.id}/feedback`, "POST", {
        expected_version: reminder.version,
        action,
        note: "",
      });
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  return (
    <div className={`care-list ${compact ? "compact" : ""}`}>
      {!reminders.length && (
        <p className="empty-note">暂时没有需要留意的事。</p>
      )}
      {reminders.map((reminder) => {
        const item = workspace.items.find(
          (item) => item.id === reminder.item_id,
        );
        const person =
          reminder.assignee_id === user.id
            ? "我"
            : workspace.friends.find(
                (friend) => friend.id === reminder.assignee_id,
              )?.display_name || "接收者";
        return (
          <article
            className={`care-card ${reminder.completed ? "completed" : ""}`}
            key={reminder.id}
          >
            {item && !compact && (
              <button
                className="care-photo"
                onClick={() => onItem(item.id)}
                aria-label={`查看${item.name}`}
              >
                <ObjectVisual item={item} />
              </button>
            )}
            <div className="care-copy">
              <div className="care-title">
                <ClipboardList size={18} />
                <strong>{reminder.title}</strong>
                <span
                  className={`status-tag ${reminder.completed ? "normal" : "needs_check"}`}
                >
                  {labels[reminder.status] || "待处理"}
                </span>
              </div>
              <p>
                {person} · {reminder.due_at.replace("T", " ").slice(0, 16)}
              </p>
              {reminder.assignee_id === user.id && (
                <div className="care-actions">
                  {!compact && (
                    <button
                      className="quiet-button"
                      onClick={() => {
                        if (!speak(reminder.title))
                          message.info("当前浏览器无法播放，可直接阅读文字");
                      }}
                    >
                      <Volume2 size={16} />
                      听一遍
                    </button>
                  )}
                  {reminder.status === "pending" && (
                    <button
                      className="soft-button"
                      onClick={() => void feedback(reminder, "read")}
                    >
                      我知道了
                    </button>
                  )}
                  {["pending", "read"].includes(reminder.status) && (
                    <button
                      className="soft-button"
                      onClick={() => void feedback(reminder, "accept")}
                    >
                      我来处理
                    </button>
                  )}
                  {!reminder.completed && (
                    <button
                      className="quiet-button"
                      onClick={() => void feedback(reminder, "complete")}
                    >
                      <Check size={16} />
                      已经处理好
                    </button>
                  )}
                  {reminder.completed && (
                    <button
                      className="quiet-button"
                      onClick={() => void feedback(reminder, "reopen")}
                    >
                      重新处理
                    </button>
                  )}
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
