"use client";
import { createContext, useContext, useEffect, useState } from "react";
const Mode = createContext(false);
export const usePublicDemo = () => useContext(Mode);
export function DemoBoundary({
  publicMode,
  autoEnter = false,
  children,
}: {
  publicMode: boolean;
  autoEnter?: boolean;
  children: React.ReactNode;
}) {
  const [authorized, setAuthorized] = useState(!publicMode),
    [loading, setLoading] = useState(publicMode),
    [invitation, setInvitation] = useState(false),
    [code, setCode] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (!publicMode) return;
    fetch("/api/demo/session", { cache: "no-store" })
      .then((r) => r.json())
      .then(async (d) => {
        setInvitation(d.invitationRequired);
        if (!d.authorized && autoEnter && !d.invitationRequired) {
          const response = await fetch("/api/demo/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ consent: true }),
          });
          const result = await response.json();
          if (!response.ok) throw Error(result.error || "暂未连接，请再试一次");
          setAuthorized(true);
        } else setAuthorized(d.authorized);
      })
      .catch(() => setNotice("连接未完成，请刷新重试"))
      .finally(() => setLoading(false));
    const listener = () => {
      setAuthorized(false);
      setNotice("演示空间已到期，请重新进入");
    };
    window.addEventListener("demo-session-expired", listener);
    return () => window.removeEventListener("demo-session-expired", listener);
  }, [publicMode]);
  return (
    <Mode.Provider value={publicMode}>
      {authorized ? (
        <>
          <div hidden={!publicMode} className="cloud-demo-banner">
            独立演示空间 · 刷新后保留{" "}
            <button
              onClick={async () => {
                if (!confirm("退出并撤销这个临时空间的访问？")) return;
                await fetch("/api/demo/session", { method: "DELETE" });
                setAuthorized(false);
              }}
            >
              退出空间
            </button>
          </div>
          {children}
        </>
      ) : (
        <main className="cloud-demo-entry">
          <h1>
            {autoEnter && loading
              ? "正在打开你的物间…"
              : "物间 · 从身边的物品开始"}
          </h1>
          <p>
            问清怎么用，准备一场聚会，也记住一件小事。每位访客拥有自己的演示空间。
          </p>
          <p>刷新后可以接着用。照片识别会使用 AI，推测的名称和型号可以修改。</p>
          {invitation && (
            <label>
              评审邀请码
              <input
                type="password"
                value={code}
                maxLength={128}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          )}
          <button
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              try {
                const r = await fetch("/api/demo/session", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ consent: true, code }),
                });
                const d = await r.json();
                if (!r.ok) throw Error(d.error);
                setAuthorized(true);
              } catch (e) {
                setNotice((e as Error).message);
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? "正在连接…" : "开始我的演示"}
          </button>
          {notice && <p role="status">{notice}</p>}
        </main>
      )}
    </Mode.Provider>
  );
}
