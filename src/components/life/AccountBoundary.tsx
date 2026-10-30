"use client";
import { useEffect, useState } from "react";
import WujianApp from "./WujianApp";
import type { Person } from "@/lib/domain";
export function AccountBoundary() {
  const [account, setAccount] = useState<{ id: Person; name: string } | null>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setAccount(d.account || null))
      .catch(() => setError("暂时无法连接账号服务"));
  }, []);
  if (account)
    return (
      <>
        <div className="life-topline">
          <span>独立账号 · {account.name} · 私人故事默认只属于你</span>
          <button
            onClick={async () => {
              await fetch("/api/account", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "logout" }),
              });
              location.reload();
            }}
          >
            退出账号
          </button>
        </div>
        <WujianApp authenticatedAccount={account} />
      </>
    );
  return (
    <main className="life-main">
      <section
        className="life-card"
        style={{ maxWidth: 540, margin: "10vh auto" }}
      >
        <span className="life-eyebrow">YOUR THINGS, YOUR LIFE</span>
        <h1>让物品，成为你的物品</h1>
        <p>
          进入自己的空间，邀请家人一起照顾日常。当前为本机独立账号测试服务，不是第三方身份认证。
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              const r = await fetch("/api/account", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: f.get("register") ? "register" : "login",
                  name: f.get("name"),
                  password: f.get("password"),
                }),
              });
              const d = await r.json();
              if (!r.ok) throw Error(d.error);
              setAccount(d.account);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            用户名
            <input
              name="name"
              autoComplete="username"
              required
              minLength={2}
              maxLength={32}
            />
          </label>
          <label>
            口令
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          <label className="life-check">
            <input type="checkbox" name="register" />
            第一次使用，创建独立账号
          </label>
          <button className="button" disabled={busy || account === undefined}>
            {busy ? "正在进入…" : "进入我的物间"}
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
      </section>
    </main>
  );
}
