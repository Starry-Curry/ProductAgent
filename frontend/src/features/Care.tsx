import { useState } from "react";
import { App as AntApp } from "antd";
import { Check, ClipboardList, MessageCircle, Volume2 } from "lucide-react";
import { request, type Reminder, type User, type Workspace } from "../api";
import { ObjectVisual, presentation, speak } from "./shared";
import "./family-ui.css";

const labels: Record<string, string> = {
  pending: "未确认", read: "已知道", in_progress: "已接手", completed: "已报告完成",
};
function dueLabel(value: string) {
  // Existing datetimes without an offset denote Shanghai local time.
  const dated = value.length === 10 ? `${value}T00:00:00` : value.replace(" ", "T");
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(dated) ? dated : `${dated}+08:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}
export default function Care({ workspace, user, refresh, onItem, householdId, compact = false,
  large = false, onAsk,
}: {
  workspace: Workspace; user: User; refresh: () => Promise<unknown>;
  onItem: (item: string, householdId?: string) => void; householdId?: string; compact?: boolean; large?: boolean;
  onAsk?: (itemId?: string, reminder?: Reminder) => void;
}) {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const reminders = workspace.reminders.filter((reminder) =>
    (!householdId || reminder.household_id === householdId) &&
    (!large || (reminder.assignee_id === user.id && Boolean(reminder.household_id))),
  );
  function person(id: string) {
    if (id === user.id) return large ? "你" : "我";
    return workspace.households.flatMap((house) => house.members).find((member) => member.id === id)?.display_name ||
      workspace.friends.find((friend) => friend.id === id)?.display_name || "家人";
  }
  async function feedback(reminder: Reminder, action: string) {
    if (busy[reminder.id]) return;
    setBusy((value) => ({ ...value, [reminder.id]: true }));
    try {
      await request(`/reminders/${reminder.id}/feedback`, "POST", {
        expected_version: reminder.version, action, note: "",
      });
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy((value) => ({ ...value, [reminder.id]: false }));
    }
  }
  return (
    <div className={`care-list family-care ${compact && !large ? "compact" : ""} ${large ? "family-care-large" : ""}`}>
      {!reminders.length && <p className="empty-note">{large ? "暂时没有家人交代的提醒。有问题可以直接问我。" : "暂时没有需要留意的事。"}</p>}
      {reminders.map((reminder) => {
        const item = workspace.items.find((value) => value.id === reminder.item_id);
        const location = item && presentation(item).location;
        const from = reminder.creator_id === reminder.assignee_id
          ? `${person(reminder.creator_id)}给自己` : `${person(reminder.creator_id)}给${person(reminder.assignee_id)}`;
        const spoken = `${from}的提醒。${item ? `${item.name}。` : ""}${reminder.title}。${location ? `位置：${location}。` : ""}${dueLabel(reminder.due_at)}。`;
        const mine = reminder.assignee_id === user.id;
        return (
          <article className={`care-card ${reminder.completed ? "completed" : ""}`} key={reminder.id}>
            {item && (!compact || large) && <button className="care-photo" onClick={() => large ? onAsk?.(item.id, reminder) : onItem(item.id, reminder.household_id || undefined)}
              disabled={large && !onAsk} aria-label={large ? `问问${item.name}怎么用` : `查看${item.name}`}><ObjectVisual item={item} /></button>}
            <div className="care-copy">
              <small className="care-people">{from}的提醒</small>
              <div className="care-title"><ClipboardList size={18} /><strong>{reminder.title}</strong>
                <span className={`status-tag ${reminder.completed ? "normal" : "needs_check"}`}>{labels[reminder.status] || "待处理"}</span>
              </div>
              <p className="care-context">{item?.name || (reminder.item_id ? "关联物品暂不可查看" : "家庭事项")}{location ? ` · ${location}` : ""}</p>
              <p><time dateTime={reminder.due_at}>{dueLabel(reminder.due_at)}</time></p>
              {mine && <div className="care-actions">
                {(!compact || large) && <button className="quiet-button" onClick={() => {
                  if (!speak(spoken)) message.info("当前浏览器无法播放，可直接阅读文字");
                }}><Volume2 size={18} />听一遍</button>}
                {reminder.status === "pending" && <button className="soft-button" disabled={busy[reminder.id]}
                  onClick={() => void feedback(reminder, "read")}>我知道了</button>}
                {!large && ["pending", "read"].includes(reminder.status) && <button className="soft-button" disabled={busy[reminder.id]}
                  onClick={() => void feedback(reminder, "accept")}>我来处理</button>}
                {!reminder.completed && <button className="quiet-button" disabled={busy[reminder.id]}
                  onClick={() => void feedback(reminder, "complete")}><Check size={18} />{large ? "我已完成" : "报告处理完成"}</button>}
                {!large && reminder.completed && <button className="quiet-button" disabled={busy[reminder.id]}
                  onClick={() => void feedback(reminder, "reopen")}>重新处理</button>}
                {onAsk && <button className="soft-button" onClick={() => onAsk(item?.id, reminder)}><MessageCircle size={18} />{item ? "问问怎么用" : "问问这件事"}</button>}
              </div>}
              {!large && <small className="care-state-note">确认收到与报告完成分别记录，不会自动改变物品可用状态。</small>}
            </div>
          </article>
        );
      })}
    </div>
  );
}
