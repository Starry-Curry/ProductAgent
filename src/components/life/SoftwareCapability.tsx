"use client";
import { useState, useEffect } from "react";
import type { Item, Person } from "@/lib/domain";
export function SoftwareCapability({
  item,
  actor,
}: {
  item: Item;
  actor: Person;
}) {
  const [adapter, setAdapter] = useState<any>(),
    [level, setLevel] = useState(30),
    [result, setResult] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const call = async (action: string, input: any = {}) => {
    const r = await fetch("/api/device-lab", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-demo-actor": actor },
      body: JSON.stringify({ action, itemId: item.id, ...input }),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    return d;
  };
  useEffect(() => {
    call("status")
      .then((d) => setAdapter(d.adapter))
      .catch((e) => setError(e.message));
  }, [item.id]);
  async function run(action: string, input: any = {}) {
    setBusy(true);
    setError("");
    try {
      const d = await call(action, input);
      setResult(d);
      setAdapter((await call("status")).adapter);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="life-card">
      <span className="life-eyebrow">SOFTWARE CAPABILITY · 自有软件模拟</span>
      <h2>让这个物品，真正回应一次</h2>
      <p>
        只控制本机软件灯，不连接米家台灯或任何真实硬件。先用REA取得接口证据，再由你授权。
      </p>
      <button disabled={busy} onClick={() => run("analyze")}>
        {busy ? "正在处理…" : "让物间分析这个软件的能力"}
      </button>
      {adapter && (
        <>
          <p>
            已取得静态接口候选，REA {adapter.reaVersion}
            ；尚不能据此证明执行成功。
          </p>
          <details>
            <summary>分析依据与版本</summary>
            <p>{adapter.evidenceId}</p>
            <p>{adapter.candidates.map((c: any) => c.path).join("、")}</p>
          </details>
          <button
            disabled={busy}
            onClick={() =>
              run(adapter.granted ? "revoke" : "grant", { confirmed: true })
            }
          >
            {adapter.granted
              ? "撤销软件控制授权"
              : "只授权本机软件灯的调光与回读"}
          </button>
          <label>
            希望的亮度（0—100）
            <input
              type="number"
              min={0}
              max={100}
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
            />
          </label>
          <button
            disabled={busy || !adapter.granted}
            onClick={() =>
              run("execute", {
                requestId: crypto.randomUUID(),
                brightness: level,
                confirmed: true,
              })
            }
          >
            确认调整并核对实际状态
          </button>
          <button
            disabled={busy || !adapter.granted}
            onClick={() => run("read")}
          >
            重新读取状态
          </button>
        </>
      )}
      {result?.observed && (
        <p role="status">
          软件灯回读：亮度{result.observed.brightness}，
          {result.observed.power ? "已开启" : "已关闭"}；版本
          {result.observed.revision}。
          {result.status === "verified" ? "本次软件结果已核对" : "仅读取状态"}
          ，不是实物验证。
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
