import { useEffect, useRef, useState } from "react";
import { App as AntApp } from "antd";
import { Bell, Check, Gift, X } from "lucide-react";
import type { components } from "../generated/api";
import { request } from "../api";
import "./butler-action.css";

type ActionView = components["schemas"]["ActionView"];
type Props = {
  taskId: string;
  refresh: () => Promise<unknown>;
  onUpdated?: () => void | Promise<void>;
};

export default function ButlerActionCard({ taskId, refresh, onUpdated }: Props) {
  const { message } = AntApp.useApp();
  const [action, setAction] = useState<ActionView>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const currentTask = useRef(taskId);
  currentTask.current = taskId;
  async function load() {
    const identity = taskId;
    setLoading(true);
    try {
      const result = await request<ActionView>(`/tasks/${identity}/action`);
      if (currentTask.current === identity) {
        setAction((previous) => previous?.task_id === result.task_id && previous.version > result.version ? previous : result);
        setError("");
      }
    } catch (failure) {
      if (currentTask.current === identity) setError((failure as Error).message);
    } finally { if (currentTask.current === identity) setLoading(false); }
  }
  useEffect(() => {
    currentTask.current = taskId;
    setAction(undefined);
    setError("");
    void load();
    return () => { currentTask.current = ""; };
  }, [taskId]);
  async function decide(cancel: boolean) {
    if (!action || busy || loading || error || action.status !== "pending") return;
    const identity = taskId;
    setBusy(true);
    setError("");
    try {
      const result = await request<ActionView>(`/tasks/${identity}/action/${cancel ? "cancel" : "confirm"}`, "POST", { expected_version: action.version });
      if (currentTask.current !== identity) return;
      setAction(result);
      try { await refresh(); await onUpdated?.(); }
      catch { message.warning("操作结果已保存，其他页面稍后刷新即可。"); }
    } catch (failure) {
      if (currentTask.current === identity) setError(`操作结果尚需核对：${(failure as Error).message}。请先重新核对内容，再决定下一步。`);
    } finally { setBusy(false); }
  }
  return <section className="butler-action-card" aria-label="管家操作确认">
    <div className="butler-action-label">{action?.kind === "gift" ? <Gift size={18} /> : <Bell size={18} />}<span>{!action ? "管家待办" : action.status === "confirmed" ? "已替你办好" : action.status === "cancelled" ? "这次先不做" : "管家整理好了，请核对"}</span></div>
    {action ? <>
      <h3>{action.title}</h3>
      <ul>{action.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>
      {action.status === "pending" ? <>
        <p className="butler-action-note">确认后才会{action.kind === "gift" ? "发出这份数字礼物；实物交付另行约定" : "加入接收人的提醒待办"}。</p>
        <div className="butler-action-buttons"><button className="primary-button" disabled={busy || loading || !!error} onClick={() => void decide(false)}><Check size={17} />{busy ? "处理中…" : action.kind === "gift" ? "确认送出" : "确认添加提醒"}</button><button className="soft-button" disabled={busy || loading || !!error} onClick={() => void decide(true)}><X size={16} />这次取消</button></div>
      </> : <p className="butler-action-result" role="status">{action.status === "confirmed" ? action.kind === "gift" ? "数字礼物已送出，可以在朋友页面查看；实物还需另行交付。" : "已加入接收人的提醒待办，不代表对方已经看到或完成。" : "本次操作已取消，不会执行这份草稿。"}</p>}
      {action.status === "confirmed" && action.result_id && <small className="butler-action-receipt">回执编号：{action.result_id}</small>}
    </> : !error && <p className="butler-action-note" role="status">正在读取待确认内容…</p>}
    {error && <div className="butler-action-error" role="alert"><p>{error}</p><button className="quiet-button" disabled={busy || loading} onClick={() => void load()}>{loading ? "核对中…" : "重新核对内容"}</button></div>}
  </section>;
}
