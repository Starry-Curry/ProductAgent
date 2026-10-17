"use client";
import { useEffect, useState, use } from "react";
import { people, type Person } from "@/lib/domain";
import { Gift, Heart, Package, ShieldCheck, ArrowLeft } from "lucide-react";
export default function GiftPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [gift, setGift] = useState<any>(null);
  const [error, setError] = useState("");
  const [received, setReceived] = useState(false);
  const [actor, setActor] = useState("friend");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/gift/${token}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setGift(d);
      })
      .catch((e) => setError(e.message));
  }, [token]);
  async function claim() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-demo-actor": actor },
        body: JSON.stringify({ action: "claim", token, received }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setGift({ ...gift, claimed: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="gift-page">
      <a className="back" href="/">
        <ArrowLeft size={16} /> 返回物间
      </a>
      <div className="gift-envelope">
        <span className="gift-symbol">
          <Gift size={38} strokeWidth={1} />
        </span>
        <div className="eyebrow">SOMETHING SPECIAL, FOR YOU</div>
        <h1>有一份心意，想交到你手里。</h1>
        <p>无需注册即可阅读 · 本地接收预览</p>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {gift && (
        <section className="panel">
          <div className="inline">
            <Package size={24} />
            <h2>{gift.itemName}</h2>
          </div>
          <blockquote>{gift.message}</blockquote>
          {gift.nickname && (
            <p>赠送者设置的昵称：{gift.nickname}（角色对话未启用）</p>
          )}
          {gift.stories.map((story: string, i: number) => (
            <article className="timeline" key={i}>
              <Heart size={16} />
              <p>{story}</p>
              <small>
                原作者：
                {gift.storyAuthors?.[i]
                  ? people[gift.storyAuthors[i] as Person]
                  : "未知（旧记录未保留来源）"}
              </small>
            </article>
          ))}
          {gift.includeKnowledge && (
            <div className="notice">
              通用提示：使用前核对型号和实际状态，按对应官方说明操作；当前未附型号级官方知识。
            </div>
          )}
          <hr />
          {gift.claimed ? (
            <div className="notice">
              礼物已认领。后续私人记忆由接收者管理，不会自动向赠送者开放。
            </div>
          ) : (
            <>
              <h3>愿意让故事继续吗？</h3>
              <p>阅读不会改变归属。请在实际取得物品后认领。</p>
              <label>
                演示接收身份（非真实账号）
                <select
                  value={actor}
                  onChange={(e) => setActor(e.target.value)}
                >
                  <option value="friend">小夏</option>
                  <option value="dad">爸爸</option>
                  <option value="lin">小林</option>
                </select>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={received}
                  onChange={(e) => setReceived(e.target.checked)}
                />
                我确认已实际取得这件物品
              </label>
              <button
                className="button"
                disabled={!received || busy}
                onClick={claim}
              >
                {busy ? "正在认领…" : "认领并延续记忆"}
              </button>
            </>
          )}
          <p className="privacy">
            <ShieldCheck size={15} />{" "}
            仅展示主动选择的心意，不包含私人订单和未授权记录。
          </p>
        </section>
      )}
    </main>
  );
}
