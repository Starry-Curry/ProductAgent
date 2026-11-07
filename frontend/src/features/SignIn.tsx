import { useState } from "react";
import { ArrowRight, Camera, Heart, MessageCircle } from "lucide-react";
import { request, type Health, type User } from "../api";
import { Companion } from "./shared";

export default function SignIn({
  health,
  onLogin,
}: {
  health?: Health;
  onLogin: (user: User) => void;
}) {
  const [registering, setRegistering] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function login(persona?: string) {
    setBusy(true);
    setError("");
    try {
      const user = await request<User>(
          persona
            ? `/auth/demo/${persona}`
            : registering
              ? "/auth/register"
              : "/auth/login",
          "POST",
          persona
            ? undefined
            : {
                username,
                password,
                ...(registering ? { display_name: name } : {}),
              },
        );
      if (persona) location.hash = "companion";
      onLogin(user);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="signin-page">
      <section className="signin-intro">
        <a className="brand" href="#companion">
          <strong>物间</strong>
          <span>和生活里的东西好好相处</span>
        </a>
        <Companion />
        <h1>
          身边的物，
          <br />
          也有新的可能。
        </h1>
        <p>
          用好熟悉的东西，留下共同的日子，
          <br />
          也把一份心意，交到另一个人手里。
        </p>
        <div className="signin-values">
          <span>
            <MessageCircle size={18} />
            问问用法
          </span>
          <span>
            <Camera size={18} />
            记下一刻
          </span>
          <span>
            <Heart size={18} />
            传递心意
          </span>
        </div>
      </section>
      <section className="signin-form">
        <span className="eyebrow">YOUR LITTLE WORLD</span>
        <h2>{registering ? "从这里，开始你的物间" : "欢迎回到物间"}</h2>
        <p>人与物的关系，会在日常里慢慢生长。</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void login();
          }}
        >
          {registering && (
            <label>
              怎么称呼你
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="nickname"
              />
            </label>
          )}
          <label>
            用户名
            <input
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              minLength={3}
              placeholder="你的用户名"
            />
          </label>
          <label>
            密码
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={registering ? "new-password" : "current-password"}
              placeholder="至少8位"
            />
          </label>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={busy}>
            {busy ? "正在进入…" : registering ? "建立我的物间" : "进入我的物间"}
            <ArrowRight size={18} />
          </button>
        </form>
        <button
          className="quiet-button"
          onClick={() => {
            setRegistering(!registering);
            setError("");
          }}
        >
          {registering ? "已有账号，返回登录" : "第一次来？建立自己的物间"}
        </button>
        {health?.demo_mode && (
          <div className="demo-entry">
            <span>先逛逛体验档案</span>
            <div>
              <button disabled={busy} onClick={() => void login("xiaolin")}>
                小林的物间
              </button>
              <button disabled={busy} onClick={() => void login("xiaoxia")}>
                小夏的物间
              </button>
              <button disabled={busy} onClick={() => void login("mom")}>
                妈妈的物间
              </button>
              <button disabled={busy} onClick={() => void login("grandpa")}>
                姥爷的大字版
              </button>
            </div>
            <small>体验档案含模拟人物与生活记录，也可使用自己的实物测试。</small>
          </div>
        )}
      </section>
    </main>
  );
}
