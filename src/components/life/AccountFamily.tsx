"use client";
import { useEffect, useState } from "react";
import type { Item, Person } from "@/lib/domain";
export function AccountFamily({
  actor,
  items,
  refresh,
  onItem,
  taskId,
}: {
  actor: Person;
  items: Item[];
  refresh: () => Promise<void>;
  onItem: (id: string) => void;
  taskId?: string;
}) {
  const [data, setData] = useState<any>(),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [invite, setInvite] = useState("");
  const load = async () => {
    const r = await fetch("/api/collaboration", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
  };
  useEffect(() => {
    load().catch((e) => setNotice(e.message));
  }, [actor]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) load().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [actor]);
  async function act(input: any) {
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch("/api/collaboration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, ...(input.action==="task"&&taskId?{sourceTaskId:taskId}:{}), requestId: crypto.randomUUID() }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (d.invite) setInvite(d.invite);
      setNotice(d.notice || "已记录");
      await load();
      await refresh();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const members = data?.members || [],
    tasks = data?.workspace?.tasks || [];
  return (
    <section className="life-family">
      <div className="life-section-head">
        <div>
          <span className="life-eyebrow">CARE, SHARED</span>
          <h1>家里的事，一起接着做</h1>
          <p>各自登录，共享具体物品。私人经历与聊天不会自动共享。</p>
        </div>
      </div>
      <div className="life-home-pair">
        <section className="life-card">
          <h2>邀请与加入</h2>
          <button
            disabled={busy}
            onClick={() => act({ action: "invite", confirmed: true })}
          >
            创建家庭邀请
          </button>
          {invite && (
            <p>
              邀请口令（24小时有效）：<code>{invite}</code>
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act({
                action: "join",
                token: new FormData(e.currentTarget).get("token"),
                confirmed: true,
              });
            }}
          >
            <label>
              家人分享的邀请口令
              <input name="token" maxLength={64} required />
            </label>
            <button disabled={busy}>确认加入这个家庭</button>
          </form>
          <p>
            成员：{members.map((m: any) => m.name).join("、") || "尚未建立家庭"}
          </p>
        </section>
        <section className="life-card">
          <h2>只共享愿意一起使用的物品</h2>
          {items
            .filter((i) => i.owner === actor)
            .map((i) => (
              <div key={i.id}>
                <button onClick={() => onItem(i.id)}>{i.name} ↗</button>
                {members
                  .filter((m: any) => m.id !== actor)
                  .map((m: any) => (
                    <label className="life-check" key={m.id}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={i.sharedWith?.includes(m.id) || false}
                        onChange={(e) =>
                          act({
                            action: "share",
                            itemId: i.id,
                            memberId: m.id,
                            enabled: e.target.checked,
                          })
                        }
                      />
                      与{m.name}共享档案
                    </label>
                  ))}
              </div>
            ))}
        </section>
      </div>
      <section className="life-card">
        <h2>核对后，留一件事给家人</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            act({
              action: "task",
              itemId: f.get("itemId"),
              memberId: f.get("memberId"),
              title: f.get("title"),
              summary: f.get("summary"),
              confirmed: true,
            });
          }}
        >
          <label>
            一起使用的物品
            <select name="itemId" required>
              {items
                .filter((i) => i.shared)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ·{" "}
                    {i.availability === "broken" ? "故障，先停用" : i.state}
                  </option>
                ))}
            </select>
          </label>
          <label>
            交给谁
            <select name="memberId" required>
              {members
                .filter((m: any) => m.id !== actor)
                .map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            需要帮忙的事情
            <input name="title" required maxLength={120} />
          </label>
          <label>
            家人会看到的摘要（不自动附带聊天）
            <textarea name="summary" required maxLength={1200} />
          </label>
          <button disabled={busy}>确认摘要，创建事项</button>
        </form>
      </section>
      <section className="life-card">
        <h2>把事情接着做</h2>
        {tasks.map((t: any) => (
          <article key={t.id}>
            <h3>{t.title}</h3>
            <p>{t.logs[0]?.text}</p>
            <p>
              {t.seenAt ? "对方已看到" : "尚未读取"} ·{" "}
              {t.acceptedAt ? "已确认接手" : "尚未接手"} ·{" "}
              {t.reportedAt ? "用户报告完成，非设备检测" : t.status}
            </p>
            {t.assignee === actor && (
              <div className="life-actions">
                <button
                  disabled={busy}
                  onClick={() => act({ action: "seen", taskId: t.id })}
                >
                  标记已看到
                </button>
                <button
                  disabled={busy}
                  onClick={() => act({ action: "accept", taskId: t.id })}
                >
                  我来接手
                </button>
                <button
                  disabled={busy || !t.acceptedAt}
                  onClick={() =>
                    act({
                      action: "report_done",
                      taskId: t.id,
                      confirmed: true,
                    })
                  }
                >
                  报告已完成
                </button>
                <button
                  disabled={busy || !t.acceptedAt}
                  onClick={() =>
                    act({ action: "unresolved", taskId: t.id, confirmed: true })
                  }
                >
                  仍未解决
                </button>
              </div>
            )}
          </article>
        ))}
        {!tasks.length && <p>暂无共享事项。</p>}
      </section>
      {notice && (
        <p role="status" className="life-notice">
          {notice}
        </p>
      )}
    </section>
  );
}
