import { useEffect, useRef, useState } from "react";
import { Bluetooth, Headphones, RefreshCw, Waves } from "lucide-react";
import { request } from "../api";
import "./earbud-console.css";

type Mode = "off" | "light" | "balanced";
type Device = { name: string; address: string; paired: boolean };
type State = {
  status: string;
  identity?: { model: string; firmware: string };
  battery?: { left: number | null; right: number | null; case: number | null };
  noise_mode?: Mode | null;
  requested_mode?: Mode | null;
  write_verified?: boolean;
  message?: string;
};
type Result = {
  status: string;
  message?: string;
  target_id?: string | null;
  observed_at?: string | null;
  available?: boolean;
  devices?: Device[];
  state?: State | null;
};
const labels: Record<Mode, string> = { off: "关闭降噪", light: "轻度降噪", balanced: "均衡降噪" };

export default function EarbudConsole({ itemId, photoId, onClose }: { itemId: string; photoId?: string | null; onClose?: () => void }) {
  const [result, setResult] = useState<Result>();
  const [devices, setDevices] = useState<Device[]>([]);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const base = `/items/${encodeURIComponent(itemId)}/earbuds`;
  useEffect(() => {
    const current = ++revision.current;
    setResult(undefined); setDevices([]); setError(""); setAddress(""); setBusy(true);
    Promise.all([request<Result>(base), request<Result>("/earbuds/devices")])
      .then(([status, paired]) => {
        if (current !== revision.current) return;
        setResult(status); setDevices(paired.devices || []);
        if (paired.status !== "paired_devices") setError(paired.message || "无法读取电脑蓝牙");
      }).catch((e: Error) => { if (current === revision.current) setError(e.message); })
      .finally(() => { if (current === revision.current) setBusy(false); });
    return () => { revision.current += 1; };
  }, [itemId]);
  async function act(action: "console" | "read" | "noise-mode", mode?: Mode) {
    const current = revision.current;
    setBusy(true); setError("");
    try {
      const next = await request<Result>(`${base}/${action}`, "POST", action === "console" ? { address: address || null } : mode ? { mode } : undefined);
      if (current === revision.current) setResult(next);
    } catch (e) { if (current === revision.current) {
      setError((e as Error).message);
      setResult(previous => previous ? { ...previous, available: false } : previous);
    } }
    finally { if (current === revision.current) setBusy(false); }
  }
  const state = result?.state;
  const connected = result?.available && ["observed", "verified", "unverified"].includes(state?.status || "");
  return <section className="earbud-console" aria-label="耳机控制台">
    <header className="earbud-console-heading">
      <div><span className="earbud-eyebrow"><Bluetooth size={15} /> 我的耳机工作台</span><h2>听见，刚刚好的安静</h2><p>HUAWEI FreeBuds 4E · 连接这台电脑</p></div>
      {onClose && <button className="earbud-close" onClick={onClose} aria-label="关闭耳机工作台">×</button>}
    </header>
    <div className="earbud-device-portrait">{photoId ? <img src={`/api/assets/${encodeURIComponent(photoId)}`} alt="我的华为耳机" /> : <Headphones size={64} strokeWidth={1.2} />}<span>{connected ? "已读取耳机真实状态" : result?.target_id ? "已配置工作台" : "等待连接耳机"}</span></div>
    {!result?.target_id && <div className="earbud-connect">
      <p>先在 Windows 蓝牙设置中连接耳机，再把它接入物间。耳机请保持唤醒。</p>
      {devices.length > 1 && <label>选择已配对耳机<select value={address} onChange={e => setAddress(e.target.value)}><option value="">请选择对应的耳机</option>{devices.map(d => <option key={d.address} value={d.address}>{d.name} · {d.address.slice(-5)}</option>)}</select></label>}
      <button disabled={busy || (devices.length > 1 && !address)} onClick={() => void act("console")}>{busy ? "正在连接耳机…" : "创建我的耳机工作台"}</button>
    </div>}
    {result?.target_id && <>
      <div className="earbud-batteries">{([['left', '左耳'], ['right', '右耳'], ['case', '充电盒']] as const).map(([key, label]) => {
        const value = connected ? state?.battery?.[key] : null;
        return <div key={key}><span>{label}</span><strong>{value == null ? "—" : `${value}%`}</strong><div className="earbud-battery-bar"><i style={{ width: value == null ? 0 : `${value}%` }} /></div><small>{value == null ? "暂无可用读数" : "耳机实际回报"}</small></div>;
      })}</div>
      <div className="earbud-noise"><h3><Waves size={19} /> 留一点安静给自己</h3><div className="earbud-noise-options">{(Object.keys(labels) as Mode[]).map(mode => <button key={mode} disabled={busy || !connected} aria-pressed={connected && state?.noise_mode === mode} onClick={() => void act("noise-mode", mode)}>{labels[mode]}</button>)}</div><p>{connected && state?.noise_mode ? `当前：${labels[state.noise_mode]}` : "刷新状态后可调整降噪"}</p></div>
      <button className="earbud-refresh" disabled={busy} onClick={() => void act("read")}><RefreshCw size={16} className={busy ? "earbud-spinning" : ""} />{busy ? "正在和耳机通信…" : "刷新真实状态"}</button>
    </>}
    <div className="earbud-receipt" role="status">{error || result?.message || "工作台会读取真实电量，设置后再次向耳机确认。"}</div>
    {result?.observed_at && <small className="earbud-observed">上次读取 {new Date(result.observed_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}{state?.identity?.firmware ? ` · ${state.identity.firmware}` : ""}</small>}
  </section>;
}
