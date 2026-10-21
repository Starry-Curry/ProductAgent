"use client";
import { createContext, useContext, useEffect, useState } from "react";
const Mode = createContext(false);
export const usePublicDemo = () => useContext(Mode);
export function DemoBoundary({
  publicMode,
  children,
}: {
  publicMode: boolean;
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
      .then((d) => {
        setAuthorized(d.authorized);
        setInvitation(d.invitationRequired);
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
            独立临时演示空间 · 有效期内刷新保留 · 请勿上传私人资料{" "}
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
          <h1>物间 · 从身边的物品开始</h1>
          <p>
            进入自己的临时演示空间，体验商品帮助、创意和生活故事。空间通过此浏览器的安全Cookie保留，其他访客无法访问。
          </p>
          <p>
            这是公开演示，请仅使用测试物品和合成图片，勿上传私人资料。空间到期后将按维护策略清理；清除Cookie会失去入口。AI有额度限制，离线时资料和故事仍可使用。
          </p>
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
