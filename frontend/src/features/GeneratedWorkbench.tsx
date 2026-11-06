import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Code2, ExternalLink, Plus, RefreshCw, Sparkles, Wrench, X } from "lucide-react";
import type { components } from "../generated/api";
import { request, type Item } from "../api";
import "./generated-workbench.css";

type Workbench = components["schemas"]["WorkbenchView"];
type SourcePart = "html" | "css" | "javascript";
type Operation = "read_state" | "read_volume" | "set_noise_mode" | "set_volume";
type DeviceMessage = { request_id: string; op: Operation; args: Record<string, string | number>; source: Window; binding: string };
const noiseLabels = { off: "关闭降噪", light: "轻度降噪", balanced: "均衡降噪" };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function allowedArgs(op: Operation, args: unknown): args is Record<string, string | number> {
  if (!record(args)) return false;
  const keys = Object.keys(args);
  if (op === "read_state" || op === "read_volume") return keys.length === 0;
  if (op === "set_noise_mode") return keys.length === 1 && keys[0] === "mode" && typeof args.mode === "string" && ["off", "light", "balanced"].includes(args.mode);
  return op === "set_volume" && keys.length === 1 && keys[0] === "level" && typeof args.level === "number"
    && Number.isFinite(args.level) && args.level >= 0 && args.level <= 100;
}
function reply(source: Window, requestId: string, value: { ok: boolean; result?: unknown; error?: string }) {
  // An opaque sandbox has no serializable target origin. Its exact Window is
  // checked before handling each request, and receives only this task's reply.
  source.postMessage({ type: "wujian:bridge-result", version: 1, request_id: requestId, ...value }, "*");
}

export default function GeneratedWorkbench({ item, taskId, onSelect, onClose, onAsk, onContinue, installedAvailable = false, onInstalled }: {
  item: Item;
  taskId?: string;
  onSelect: (id?: string) => void;
  onClose: () => void;
  onAsk: (text: string) => void;
  onContinue: (id: string) => void;
  installedAvailable?: boolean;
  onInstalled?: () => void;
}) {
  const [works, setWorks] = useState<Workbench[]>([]), [active, setActive] = useState<Workbench>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [goal, setGoal] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false), [sourcePart, setSourcePart] = useState<SourcePart>("html");
  const [pending, setPending] = useState<DeviceMessage | null>(null), [writing, setWriting] = useState(false), [receipt, setReceipt] = useState("");
  const frame = useRef<HTMLIFrameElement>(null), revision = useRef(0), binding = useRef("");
  const pendingRef = useRef<DeviceMessage | null>(null), writingRef = useRef(false);
  const current = active?.task_id === taskId && active?.item_id === item.id ? active : undefined;
  const frameBinding = current?.published ? `${item.id}:${current.task_id}:${current.version}` : "";
  binding.current = frameBinding;

  async function load() {
    const generation = ++revision.current;
    setBusy(true); setError(""); setActive(undefined);
    try {
      const [list, selected] = await Promise.all([
        request<Workbench[]>(`/items/${encodeURIComponent(item.id)}/workbenches`),
        taskId ? request<Workbench>(`/workbenches/${encodeURIComponent(taskId)}`) : Promise.resolve(undefined),
      ]);
      if (generation !== revision.current) return;
      if (selected && selected.item_id !== item.id) throw new Error("这件作品不属于当前物品，请返回重新打开。");
      setWorks(list); setActive(selected);
    } catch (error) {
      if (generation === revision.current) { setWorks([]); setError((error as Error).message); }
    } finally { if (generation === revision.current) setBusy(false); }
  }
  useEffect(() => {
    setWorks([]); setGoal(""); setSourceOpen(false); setSourcePart("html");
    void load();
    return () => { revision.current += 1; };
  }, [item.id, taskId]);

  useEffect(() => {
    pendingRef.current = null; writingRef.current = false;
    setPending(null); setWriting(false); setReceipt("");
    if (!current?.published || !frameBinding) return;
    const seen = new Set<string>(), reading = new Set<string>();
    const captured = frameBinding;
    const operations = ["read_state", "read_volume", "set_noise_mode", "set_volume"];
    const serverOperations = current.bridge.operations;
    async function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.origin !== "null" || binding.current !== captured) return;
      const data = event.data;
      if (!record(data) || data.type !== "wujian:bridge-request" || data.version !== 1
        || typeof data.request_id !== "string" || !data.request_id || data.request_id.length > 100) return;
      const source = event.source as Window, requestId = data.request_id;
      if (seen.has(requestId)) return;
      if (seen.size >= 200) { reply(source, requestId, { ok: false, error: "这次操作较多，请重新打开工作台再试。" }); return; }
      seen.add(requestId);
      if (typeof data.op !== "string" || !operations.includes(data.op) || !Array.isArray(serverOperations)
        || !serverOperations.includes(data.op) || !allowedArgs(data.op as Operation, data.args)) {
        reply(source, requestId, { ok: false, error: "这项操作暂不支持，请让阿圆调整工作台。" }); return;
      }
      const op = data.op as Operation;
      const operation: DeviceMessage = { request_id: requestId, op, args: { ...data.args }, source, binding: captured };
      if (op === "set_noise_mode" || op === "set_volume") {
        if (pendingRef.current || writingRef.current) {
          reply(source, requestId, { ok: false, error: "先处理上一个操作，再继续调整。" }); return;
        }
        pendingRef.current = operation; setPending(operation); return;
      }
      if (reading.has(op)) { reply(source, requestId, { ok: false, error: "正在读取，请稍后再试。" }); return; }
      reading.add(op);
      try {
        const result = await request<Record<string, unknown>>(`/workbenches/${current!.task_id}/device`, "POST", {
          expected_version: current!.version, op, args: operation.args,
        });
        if (binding.current !== captured || frame.current?.contentWindow !== source) return;
        reply(source, requestId, { ok: true, result });
        if (typeof result.message === "string") setReceipt(result.message);
      } catch (error) {
        if (binding.current !== captured || frame.current?.contentWindow !== source) return;
        reply(source, requestId, { ok: false, error: (error as Error).message });
        setReceipt((error as Error).message);
      } finally { reading.delete(op); }
    }
    addEventListener("message", receive);
    return () => { removeEventListener("message", receive); };
  }, [frameBinding]);

  function deny() {
    const action = pendingRef.current;
    if (!action || writingRef.current) return;
    if (binding.current === action.binding && frame.current?.contentWindow === action.source)
      reply(action.source, action.request_id, { ok: false, error: "这次先不调整，设备没有改变。" });
    pendingRef.current = null; setPending(null);
  }
  async function confirm(event: React.MouseEvent<HTMLButtonElement>) {
    const action = pendingRef.current;
    if (!event.isTrusted || !action || !current || writingRef.current || action.binding !== binding.current
      || action.source !== frame.current?.contentWindow) return;
    writingRef.current = true; setWriting(true);
    try {
      const result = await request<Record<string, unknown>>(`/workbenches/${current.task_id}/device`, "POST", {
        expected_version: current.version, op: action.op, args: action.args,
      });
      if (binding.current !== action.binding || frame.current?.contentWindow !== action.source) return;
      reply(action.source, action.request_id, { ok: true, result });
      setReceipt(typeof result.message === "string" ? result.message : "操作已返回，请以工作台中的实际状态为准。");
    } catch (error) {
      if (binding.current !== action.binding || frame.current?.contentWindow !== action.source) return;
      reply(action.source, action.request_id, { ok: false, error: (error as Error).message });
      setReceipt((error as Error).message);
    } finally {
      if (binding.current === action.binding) {
        writingRef.current = false; pendingRef.current = null; setWriting(false); setPending(null);
      }
    }
  }
  const pendingLabel = pending?.op === "set_noise_mode"
    ? noiseLabels[pending.args.mode as keyof typeof noiseLabels]
    : pending ? `将电脑耳机输出音量调至 ${pending.args.level}%` : "";

  return <section className="generated-workbench page-content" aria-label={`${item.name}的工作台`}>
    <header className="workbench-heading">
      <div><button className="quiet-button" onClick={taskId ? () => onSelect() : onClose}><ArrowLeft size={17} />{taskId ? "我的工作台" : "物品名片"}</button>
        <span className="eyebrow">MADE FOR YOUR EVERYDAY</span><h1>{current ? `${item.name} · 工作台` : "我的工作台"}</h1><p>{current ? "更合你心意的用法" : `${item.name} · 更合你心意的用法`}</p></div>
      <button className="icon-button" title="刷新工作台" disabled={busy} onClick={() => void load()}><RefreshCw size={18} /></button>
    </header>
    {error && <div className="inline-error" role="alert">{error}<button className="quiet-button" onClick={() => void load()}>重新读取</button></div>}
    {busy && <p className="workbench-loading" role="status">打开工作台…</p>}
    {!taskId && !busy && <>
      {installedAvailable && onInstalled && <section className="workbench-group"><h2>已有工具</h2>
        <button className="workbench-installed" onClick={onInstalled}><span className="workbench-tool-icon"><Wrench size={25} /></span>
          <span><strong>耳机操控台</strong><small>查看电量、调整降噪和电脑输出音量</small><em>已有工具 · 已接入的耳机能力</em></span><ExternalLink size={18} />
        </button>
      </section>}
      <section className="workbench-group"><h2>阿圆为我做的</h2>
        {works.length ? <div className="workbench-projects">{works.map((work) => <button key={work.task_id} onClick={() => onSelect(work.task_id)}>
          <Code2 size={24} /><strong title={work.title}>{work.title}</strong><span className={work.published ? "ready" : ""}>{work.published ? "可以打开" : "还在制作"}</span><small>阿圆制作 · 第 {work.version} 版</small>
        </button>)}</div> : <p className="workbench-empty">想要一个合用的小工具，可以直接告诉阿圆。做好后就会留在这里。</p>}
      </section>
      <form className="workbench-new" onSubmit={(event) => { event.preventDefault(); if (goal.trim()) onAsk(goal.trim()); }}>
        <div><Sparkles size={21} /><h2>想让它多做点什么？</h2></div>
        <textarea value={goal} maxLength={2000} rows={2} onChange={(event) => setGoal(event.target.value)}
          aria-label="想给这件物品做什么工具" placeholder={`说说你想让${item.name}多做什么…`} />
        <button type="submit" className="primary-button" disabled={!goal.trim()}><Plus size={16} />和阿圆一起做</button>
      </form>
    </>}
    {current && !busy && <>
      <details className="workbench-brief"><summary>创作要求</summary><p>{current.title}</p></details>
      <div className="workbench-project-actions"><span className={`workbench-stage ${current.published ? "ready" : ""}`}><span />{current.published ? "界面已就绪" : "正在制作，还未打开"}</span>
        <button className="soft-button" onClick={() => onContinue(current.task_id)}><Sparkles size={16} />让阿圆继续改</button>
        <button className="quiet-button" onClick={() => setSourceOpen(!sourceOpen)} aria-expanded={sourceOpen}><Code2 size={16} />{sourceOpen ? "收起源码" : "看看怎么做的"}</button>
      </div>
      {pending && <div className="workbench-confirm" role="group" aria-label="确认设备调整">
        <div><strong>{pendingLabel}</strong><p>确认后会调整这件物品。未确认时，设备保持原样。</p></div>
        <button className="soft-button" disabled={writing} onClick={deny}><X size={15} />先不调整</button>
        <button className="primary-button" disabled={writing} onClick={(event) => void confirm(event)}><Check size={16} />{writing ? "正在调整…" : "确认调整"}</button>
      </div>}
      {current.published && current.document_html ? <iframe ref={frame} key={frameBinding}
        title={`${current.title} · 阿圆制作的工作台`} className="workbench-preview" sandbox="allow-scripts"
        referrerPolicy="no-referrer" srcDoc={current.document_html} />
        : <div className="workbench-not-ready"><Wrench size={30} /><h2>这个工具还在打磨</h2><p>可以让阿圆接着检查和修改，再回来打开。</p><button className="soft-button" onClick={() => onContinue(current.task_id)}>和阿圆继续做</button></div>}
      {receipt && <p className="workbench-device-receipt" role="status">{receipt}</p>}
      {sourceOpen && <section className="workbench-source"><div className="workbench-source-tabs" aria-label="源文件">{(["html", "css", "javascript"] as const).map((part) => <button key={part} className={sourcePart === part ? "active" : ""} onClick={() => setSourcePart(part)} aria-pressed={sourcePart === part}>{part === "javascript" ? "JavaScript" : part.toUpperCase()}</button>)}<small>第 {current.version} 版 · 阿圆制作</small></div><pre tabIndex={0}><code>{current.source[sourcePart] || "这个文件还没有内容。"}</code></pre></section>}
    </>}
  </section>;
}
