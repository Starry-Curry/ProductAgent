import { useEffect, useRef, useState } from "react";
import type { components } from "../generated/api";
import { request } from "../api";

type Session = components["schemas"]["CommunitySessionView"];
const waiting = new Set(["starting", "opening", "waiting_scan"]);

/** The account is used by this owner's temporary collector, never the model. */
export default function CommunityConnection() {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const changing = useRef(false);
  useEffect(() => {
    let active = true;
    const read = async () => {
      if (changing.current) return;
      const started = revision.current;
      try {
        const value = await request<Session>("/community/bilibili/session");
        if (active && started === revision.current) {
          setSession(value);
          setError("");
        }
      } catch (failure) {
        if (active && started === revision.current) setError((failure as Error).message);
      }
    };
    void read();
    const timer = window.setInterval(() => { void read(); }, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function change(method: "POST" | "DELETE") {
    changing.current = true;
    revision.current += 1;
    setBusy(true);
    setError("");
    try { setSession(await request<Session>("/community/bilibili/session", method)); }
    catch (failure) { setError((failure as Error).message); }
    finally { changing.current = false; setBusy(false); }
  }
  const connected = session?.connected;
  const scanning = Boolean(session && waiting.has(session.stage));
  return <section className="community-connection" aria-label="B站公开案例连接">
    <div className="form-divider">公开创意案例</div>
    <p className="form-note">需要时可临时连接 B 站，帮助物伴查找公开分享。会话最多保留 30 分钟，不保存登录凭据，随时可以断开。</p>
    {connected ? <p role="status">B 站已连接 · 本次还剩约 {Math.ceil(session.remaining_seconds / 60)} 分钟</p>
      : scanning ? <p role="status">{session?.stage === "waiting_scan" ? "请用 B 站 App 扫码并在手机确认登录" : "正在准备独立扫码会话…"}</p>
      : <p className="muted">{session?.stage === "expired" ? "临时连接已到期" : session?.stage === "login_failed" || session?.stage === "needs_login" ? "登录未完成或已失效，可重新连接" : "当前未连接"}</p>}
    {session?.qr_data_url && <img className="community-login-qr" src={session.qr_data_url} alt="本次B站临时登录二维码" />}
    {session?.failure_phase && <p className="form-note">{session.failure_phase === "navigation"
      ? "B 站页面暂未打开，可以重新连接。"
      : session.failure_phase === "waiting_scan" || session.failure_phase === "session_check"
        ? "扫码登录尚未确认，可以重新连接后再试。"
        : "临时扫码页面暂未准备完成，可以重新连接。"}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <button className="quiet-button" type="button" disabled={busy}
      onClick={() => { void change(connected || scanning ? "DELETE" : "POST"); }}>
      {busy ? "正在处理…" : connected || scanning ? "结束本次连接" : "临时连接 B 站"}
    </button>
  </section>;
}
