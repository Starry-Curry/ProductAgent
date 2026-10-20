"use client";
import { useEffect, useState } from "react";
import type { Chapter, Understanding } from "@/lib/life/organization";
import type { Fragment } from "./Stories";
import type { LifeRequest } from "./Intake";

export function StoryOrganization({
  actor,
  fragments,
  request,
  onFilter,
}: {
  actor: string;
  fragments: Fragment[];
  request: LifeRequest;
  onFilter: (ids: string[] | null) => void;
}) {
  const [data, setData] = useState<{
    chapters: Chapter[];
    understanding: Understanding[];
  }>({ chapters: [], understanding: [] });
  const [editing, setEditing] = useState<Chapter | null>(null),
    [name, setName] = useState(""),
    [ids, setIds] = useState<string[]>([]),
    [open, setOpen] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("all"),
    [candidate, setCandidate] = useState<Understanding | null>(null),
    [text, setText] = useState(""),
    [scope, setScope] = useState(""),
    [cloud, setCloud] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/life", { headers: { "x-demo-actor": actor } })
      .then((r) => r.json())
      .then((d) => {
        if (live && d.storyOrganization) setData(d.storyOrganization);
      })
      .catch(() => {
        if (live) setNotice("章节暂未读取，可刷新重试");
      });
    return () => {
      live = false;
    };
  }, [actor, fragments]);
  async function act(input: unknown) {
    setBusy(true);
    setNotice("");
    try {
      const d = await request("storyOrganization", input);
      setData(d);
      const c = d.chapters.find((c: Chapter) => c.id === selected);
      onFilter(selected === "all" ? null : c?.fragmentIds || []);
      return true;
    } catch (e) {
      setNotice((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function edit(c?: Chapter) {
    setEditing(c || null);
    setName(c?.name || "");
    setIds(c?.fragmentIds || []);
    setOpen(true);
  }
  return (
    <div className="life-story-organization">
      <div className="life-actions">
        <label>
          章节
          <select
            aria-label="按章节浏览"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              onFilter(
                e.target.value === "all"
                  ? null
                  : data.chapters.find((c) => c.id === e.target.value)
                      ?.fragmentIds || [],
              );
            }}
          >
            <option value="all">全部章节</option>
            {data.chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.fragmentIds.length}段
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => edit()}>
          整理一个章节
        </button>
        {selected !== "all" && (
          <button
            type="button"
            onClick={() => edit(data.chapters.find((c) => c.id === selected))}
          >
            编辑当前章节
          </button>
        )}
      </div>
      {open && (
        <form
          className="life-card"
          onSubmit={(e) => {
            e.preventDefault();
            void act({
              command: "chapter",
              id: editing?.id,
              revision: editing?.revision,
              name,
              fragmentIds: ids,
            }).then((ok) => {
              if (ok) setOpen(false);
            });
          }}
        >
          <h3>{editing ? "编辑章节" : "把相关经历放在一起"}</h3>
          <label>
            章节名称
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p className="life-muted">
            章节只引用原事件，不复制故事。勾选移入，取消勾选移出；可把不同章节的经历选入同一章，原章可另行解除。
          </p>
          <div className="life-chapter-choices">
            {fragments.map((f) => (
              <label className="life-check" key={f.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(f.id)}
                  onChange={(e) =>
                    setIds(
                      e.target.checked
                        ? [...ids, f.id]
                        : ids.filter((id) => id !== f.id),
                    )
                  }
                />
                {f.text.slice(0, 65)}
              </label>
            ))}
          </div>
          <div className="life-actions">
            <button disabled={busy}>保存章节</button>
            <button type="button" onClick={() => setOpen(false)}>
              取消
            </button>
            {editing && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void act({
                    command: "deleteChapter",
                    id: editing.id,
                    revision: editing.revision,
                  }).then((ok) => {
                    if (ok) {
                      setOpen(false);
                      setSelected("all");
                      onFilter(null);
                    }
                  });
                }}
              >
                解除章节，保留故事
              </button>
            )}
          </div>
        </form>
      )}
      <details className="life-understanding">
        <summary>物间目前了解我的哪些事</summary>
        <p>
          只整理原话中的明确偏好与目标，供你核对；单次经历不推断人格。未确认候选不参与服务。
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void act({ command: "extract" })}
        >
          从获准故事整理候选（本机有限规则）
        </button>
        {data.understanding
          .filter((u) => u.status !== "withdrawn")
          .map((u) => (
            <article key={u.id}>
              <strong>{u.text}</strong>
              <small>
                {" "}
                ·{" "}
                {u.status === "candidate"
                  ? "待确认"
                  : u.status === "confirmed"
                    ? "已确认"
                    : "已拒绝"}{" "}
                · 明确原话
              </small>
              <p className="life-muted">
                证据：
                {u.evidence
                  .map(
                    (e) =>
                      fragments
                        .find((f) => f.id === e.id)
                        ?.text.slice(0, 100) || "原事件已不可用",
                  )
                  .join("；")}
              </p>
              {u.status !== "rejected" && (
                <div className="life-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setCandidate(u);
                      setText(u.text);
                      setScope(u.status === "confirmed" ? u.scope : "");
                      setCloud(false);
                    }}
                  >
                    确认或纠正
                  </button>
                  <button
                    type="button"
                    onClick={() => void act({ command: "reject", id: u.id })}
                  >
                    拒绝
                  </button>
                  <button
                    type="button"
                    onClick={() => void act({ command: "forget", id: u.id })}
                  >
                    遗忘
                  </button>
                </div>
              )}
            </article>
          ))}
        {candidate && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act({
                command: "confirm",
                id: candidate.id,
                text,
                scope,
                allowCloud: cloud,
              }).then((ok) => {
                if (ok) setCandidate(null);
              });
            }}
          >
            <label>
              我的原意
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                required
                maxLength={600}
              />
            </label>
            <label>
              仅适用于这些任务（用逗号分隔）
              <input
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                placeholder="旅行,摄影"
                required
                minLength={2}
                maxLength={80}
              />
            </label>
            <label className="life-check">
              <input
                type="checkbox"
                checked={cloud}
                onChange={(e) => setCloud(e.target.checked)}
              />
              允许在相关任务送入获准云端模型（原事件也须允许）
            </label>
            <button disabled={busy}>确认保存到个人记忆</button>
            <button type="button" onClick={() => setCandidate(null)}>
              取消
            </button>
          </form>
        )}
      </details>
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
