"use client";
import { useState } from "react";
import { people, type State, type Person, type Item } from "@/lib/domain";
import { TaskComposer, TaskList, type Action } from "../FamilyTasks";
export function FamilyPanel({
  workspace,
  actor,
  items,
  act,
  onItem,
}: {
  workspace: State;
  actor: Person;
  items: Item[];
  act: Action;
  onItem: (id: string) => void;
}) {
  const [filter, setFilter] = useState("待处理");
  const done = workspace.tasks.filter((t) => t.status === "用户确认完成");
  const active = workspace.tasks.filter((t) => t.status !== "用户确认完成");
  const running = active.filter((t) => t.status === "进行中");
  const rows =
    filter === "进行中"
      ? running
      : filter === "我的事项"
        ? active.filter((t) => t.assignee === actor)
        : active;
  return (
    <section className="life-family">
      <div className="life-section-head">
        <div>
          <span className="life-eyebrow">CARE, SHARED</span>
          <h1>家里的事，一起接着做</h1>
          <p>
            共享物品和明确分工。当前成员为本机演示身份，回执不等于真人通知。
          </p>
        </div>
        <details className="family-create">
          <summary className="button">＋ 留一件事</summary>
          <div className="life-card">
            <TaskComposer items={items} actor={actor} act={act} />
          </div>
        </details>
      </div>
      <div className="family-overview">
        <div>
          <strong>{active.length}</strong>
          <span>待处理</span>
        </div>
        <div>
          <strong>{running.length}</strong>
          <span>进行中</span>
        </div>
        <div>
          <strong>{done.length}</strong>
          <span>已完成</span>
        </div>
        <div>
          <strong>{items.filter((i) => i.shared).length}</strong>
          <span>共享物品</span>
        </div>
      </div>
      <div className="family-filter">
        {["待处理", "我的事项", "进行中", "已完成"].map((s) => (
          <button
            key={s}
            className={filter === s ? "active" : ""}
            onClick={() => setFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>
      {filter === "已完成" ? (
        <div className="completed-tasks">
          {done.length ? (
            done.map((t) => (
              <article key={t.id}>
                <span>✓ 已完成 · {people[t.assignee]}</span>
                <strong>{t.title}</strong>
                <small>用户确认结果，非设备检测</small>
              </article>
            ))
          ) : (
            <p className="life-muted">还没有已完成的事项。</p>
          )}
        </div>
      ) : (
        <TaskList tasks={rows} actor={actor} act={act} />
      )}
      <div className="life-section-head">
        <h2>一起使用的物品</h2>
        <span>私人故事不会随物品共享</span>
      </div>
      <div className="family-shared-items">
        {items
          .filter((i) => i.shared)
          .map((i) => (
            <button key={i.id} onClick={() => onItem(i.id)}>
              <strong>{i.name}</strong>
              <span>
                {i.state} · {people[i.owner]} ↗
              </span>
            </button>
          ))}
      </div>
    </section>
  );
}
export function SocialPanel({
  workspace,
  actor,
  act,
  onCabinet,
}: {
  workspace: State;
  actor: Person;
  act: Action;
  onCabinet: () => void;
}) {
  return (
    <section className="life-social">
      <div className="life-section-head">
        <div>
          <span className="life-eyebrow">THINGS CONNECT PEOPLE</span>
          <h1>让物品，带着故事继续</h1>
          <p>
            送出一件物品，选择要传递的原话。原作者保留，私人的新经历不会回流。
          </p>
        </div>
        <button className="button" onClick={onCabinet}>
          选一件物品赠送 ↗
        </button>
      </div>
      <h2>礼物与故事传递</h2>
      <div className="social-gifts">
        {workspace.gifts.length ? (
          workspace.gifts.map((g) => (
            <article className="life-card" key={g.id}>
              <span className="life-pill">
                {g.revoked ? "已撤销" : g.claimedBy ? "已认领" : "等待认领"}
              </span>
              <h3>{g.itemName}</h3>
              <p>来自 {people[g.sender]} · 只携带明确选中的故事文字</p>
              <div className="life-actions">
                <a className="button secondary" href={`/gift/${g.token}`}>
                  查看故事与礼物
                </a>
                {g.sender === actor && !g.claimedBy && !g.revoked && (
                  <button onClick={() => act("revoke", { giftId: g.id })}>
                    撤销赠礼
                  </button>
                )}
              </div>
            </article>
          ))
        ) : (
          <div className="life-card">
            <h3>一件旧物，也可以是新的开始</h3>
            <p>
              到物品详情的“资料与管理”预览赠礼，选择本人希望传递的文字。没有选择的照片、记忆和聊天不会附带。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
