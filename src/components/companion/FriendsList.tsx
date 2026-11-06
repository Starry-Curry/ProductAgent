"use client";
import { useState } from "react";
import { UserPlus, Search, RefreshCw, Check, X, Copy } from "lucide-react";
import { socialProfiles, type Friendship } from "@/lib/companion/social-types";
import { names, initials, type API, type Person } from "./types";
export function FriendsList({
  actor,
  links,
  selected,
  onSelect,
  api,
  refresh,
  notify,
}: {
  actor: Person;
  links: Friendship[];
  selected: Person;
  onSelect: (p: Person) => void;
  api: API;
  refresh: () => Promise<unknown>;
  notify: (s: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [code, setCode] = useState(""),
    [candidate, setCandidate] = useState<
      (typeof socialProfiles)[number] | null
    >(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const own = socialProfiles.find((p) => p.id === actor)!;
  const friends = links
    .filter((r) => r.status === "accepted")
    .map((r) => (r.owner === actor ? r.recipient : r.owner));
  const pending = links.filter((r) => r.status === "pending");
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function decide(
    r: Friendship,
    decision: "accept" | "decline" | "remove",
  ) {
    await api("/api/companion", {
      action: "friendDecision",
      input: { id: r.id, revision: r.revision, decision },
    });
    await refresh();
    notify(
      decision === "accept"
        ? "已成为好友"
        : decision === "decline"
          ? "已婉拒申请"
          : "已取消申请",
    );
  }
  return (
    <div className="wj-friends-directory">
      <div className="wj-friends-directory-heading">
        <div>
          <h2>
            我的好友 <small>{friends.length} 位</small>
          </h2>
          <p>点进朋友的生活，看看最近喜欢什么。</p>
        </div>
        <div className="wj-actions">
          <button
            className="wj-icon-btn"
            aria-label="刷新好友列表"
            onClick={() =>
              run(async () => {
                await refresh();
              })
            }
          >
            <RefreshCw size={16} />
          </button>
          <button
            className="wj-btn compact"
            onClick={() => {
              setOpen(!open);
              setCandidate(null);
              setMessage("");
            }}
          >
            <UserPlus size={16} />
            加好友
          </button>
        </div>
      </div>
      <div className="wj-friends-strip" aria-label="好友列表">
        <button
          className={selected === actor ? "active" : ""}
          onClick={() => onSelect(actor)}
        >
          <span className={"wj-person " + actor}>{initials[actor]}</span>
          <span>我的主页</span>
        </button>
        {friends.map((p) => (
          <button
            key={p}
            className={selected === p ? "active" : ""}
            onClick={() => onSelect(p)}
          >
            <span className={"wj-person " + p}>{initials[p]}</span>
            <span>{names[p]}</span>
            <small>好友</small>
          </button>
        ))}
        {!friends.length && (
          <p className="wj-muted">还没有好友，输入朋友的编号认识一下。</p>
        )}
      </div>
      {open && (
        <div className="wj-add-friend">
          <div className="wj-row">
            <strong>用编号加好友</strong>
            <button
              className="wj-icon-btn"
              aria-label="关闭添加好友"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <p>
            我的好友编号：<b>{own.code}</b>{" "}
            <button
              className="wj-link"
              onClick={() =>
                run(async () => {
                  await navigator.clipboard.writeText(own.code);
                  notify("已复制好友编号");
                })
              }
            >
              <Copy size={12} />
              复制
            </button>
          </p>
          <form
            className="wj-friend-search"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const d = await api("/api/companion", {
                  action: "findFriend",
                  input: { code },
                });
                setCandidate(d.profile);
                setMessage(
                  d.relationship?.status === "accepted"
                    ? "你们已经是好友了"
                    : d.relationship?.status === "pending"
                      ? "你们之间已有待处理的申请"
                      : "",
                );
              });
            }}
          >
            <label>
              好友编号
              <input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setCandidate(null);
                }}
                placeholder="例如 WJ-DAD"
                maxLength={40}
                required
              />
            </label>
            <button className="wj-btn secondary" disabled={busy}>
              <Search size={16} />
              查找
            </button>
          </form>
          <small className="wj-muted">
            本机演示编号：WJ-LIN（小林）、WJ-YU（小雨）、WJ-DAD（爸爸）。
          </small>
          {candidate && (
            <div className="wj-friend-result">
              <span className={"wj-person " + candidate.id}>
                {initials[candidate.id]}
              </span>
              <div>
                <strong>{candidate.name}</strong>
                <small>{candidate.description}</small>
              </div>
              <button
                className="wj-btn compact"
                disabled={
                  busy ||
                  friends.includes(candidate.id) ||
                  pending.some(
                    (r) =>
                      r.owner === candidate.id || r.recipient === candidate.id,
                  )
                }
                onClick={() =>
                  run(async () => {
                    await api("/api/companion", {
                      action: "addFriend",
                      input: { code: candidate.code },
                    });
                    await refresh();
                    setMessage("申请已保存，等待对方通过。");
                    notify("好友申请已发出");
                  })
                }
              >
                发送好友申请
              </button>
            </div>
          )}
        </div>
      )}
      {!!pending.length && (
        <div className="wj-friend-requests">
          <h3>
            好友申请 <small>{pending.length}</small>
          </h3>
          {pending.map((r) => {
            const inbound = r.recipient === actor,
              p = inbound ? r.owner : r.recipient;
            return (
              <div key={r.id} className="wj-friend-result">
                <span className={"wj-person " + p}>{initials[p]}</span>
                <div>
                  <strong>{names[p]}</strong>
                  <small>
                    {inbound ? "想和你成为好友" : "已发出申请，等待通过"}
                  </small>
                </div>
                {inbound ? (
                  <>
                    <button
                      className="wj-btn compact"
                      disabled={busy}
                      onClick={() => run(() => decide(r, "accept"))}
                    >
                      <Check size={14} />
                      通过
                    </button>
                    <button
                      className="wj-link"
                      disabled={busy}
                      onClick={() => run(() => decide(r, "decline"))}
                    >
                      婉拒
                    </button>
                  </>
                ) : (
                  <button
                    className="wj-link"
                    disabled={busy}
                    onClick={() => run(() => decide(r, "remove"))}
                  >
                    取消申请
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {message && (
        <p className="wj-form-notice" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
