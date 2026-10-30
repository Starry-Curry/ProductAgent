"use client";
import { useState } from "react";
import { people, type Item, type Person, type State } from "@/lib/domain";
import { TaskList, type Action } from "../FamilyTasks";
import { AssistantConversation } from "../AssistantConversation";
import { SellerSupport } from "../SellerSupport";
import { itemPhoto } from "@/lib/life/item-photos";

export function CareView({
  actor,
  workspace,
  items,
  view,
  act,
  refresh,
  onBusy,
}: {
  actor: Person;
  workspace: State;
  items: Item[];
  view: "home" | "family";
  act: Action;
  refresh: () => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const [selected, setSelected] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const item = items.find((i) => i.id === selected);
  const picture = item && itemPhoto(item, actor);
  const own = workspace.tasks.filter(
    (t) => t.assignee === actor && t.status !== "用户确认完成",
  );
  const notices = own.filter((t) => t.kind === "notice");
  return (
    <div className="care-view">
      {view === "family" ? (
        <section aria-labelledby="care-tasks-title">
          <h1 id="care-tasks-title">{people[actor] || "你"}，家人交代的事</h1>
          <p>这里只显示交给你的事项。收到提醒后，点“我知道了”。</p>
          <TaskList tasks={own} actor={actor} act={act} elder />
          <p className="care-note">
            “我知道了”只表示收到提醒，不代表物品已经修好。
          </p>
          <button
            className="button secondary"
            onClick={() => refresh().catch(() => {})}
          >
            刷新家人事项
          </button>
        </section>
      ) : (
        <>
          {notices.length > 0 && (
            <section
              className="care-important"
              aria-labelledby="care-notices-title"
            >
              <h2 id="care-notices-title">先看一眼家人的提醒</h2>
              <TaskList tasks={notices} actor={actor} act={act} elder />
            </section>
          )}
          <section className="care-question" aria-labelledby="care-help-title">
            <h1 id="care-help-title">不会用？在这里问。</h1>
            <p>选一件物品，写下遇到的问题。也可以直接问。</p>
            <label>
              想问哪件物品？（可不选）
              <select
                aria-label="想问哪件物品"
                value={selected}
                disabled={asking}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setQuestion("");
                }}
              >
                <option value="">直接问，不选物品</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                    {i.synthetic ? "（演示）" : ""}
                  </option>
                ))}
              </select>
            </label>
            {item && picture && (
              <figure className="care-item-photo">
                <img
                  src={picture.src}
                  alt={`${item.name} · ${picture.label}`}
                  width={112}
                  height={112}
                />
                <figcaption>
                  <strong>{item.name}</strong>
                  <span>{picture.label}</span>
                </figcaption>
              </figure>
            )}
            <AssistantConversation
              key={actor + ":care:" + (item?.id || "home")}
              actor={actor}
              item={item}
              mode="auto"
              elder
              memoryPolicy="off"
              uiContext={{ page: "assistant", interfaceMode: "care" }}
              onQuestion={setQuestion}
              onActivity={() => refresh().catch(() => {})}
              onHandoff={()=>refresh().catch(()=>{})}
              onBusy={(v) => {
                setAsking(v);
                onBusy(v);
              }}
            />
            <SellerSupport item={item} actor={actor} question={question} />
          </section>
          <section className="care-inbox" aria-labelledby="care-inbox-title">
            <h2 id="care-inbox-title">{people[actor] || "你"}，还有这些事</h2>
            <TaskList
              tasks={own.filter((t) => t.kind !== "notice")}
              actor={actor}
              act={act}
              elder
            />
          </section>
        </>
      )}
      <p className="care-note">
        {actor.startsWith("u_") ? "独立账号的家庭事项；当前为本机服务，未接入短信或手机通知。" : "本机演示身份。页面打开时会刷新家人事项，暂不支持跨设备同步或手机通知。"}
      </p>
    </div>
  );
}
