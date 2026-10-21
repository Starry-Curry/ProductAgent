"use client";
import { useEffect, useRef, useState } from "react";
import {
  House,
  MessageCircle,
  Move,
  Sparkles,
  List,
  X,
  Plus,
} from "lucide-react";
import type { Item, Person, Task } from "@/lib/domain";
import { rooms, type Placement, type RoomId } from "@/lib/home/contracts";
import { ItemCharacter, type CharacterMood } from "./ItemCharacter";
import { AssistantConversation } from "./AssistantConversation";
function sceneName(item: Item) {
  if (!item.demo) return item.name;
  return (
    (
      {
        kettle: "小水壶",
        fryer: "空气炸锅",
        purifier: "空气净化器",
        vacuum: "吸尘器",
        table: "小边桌",
        trolley: "小推车",
        shelf: /BILLY/.test(item.name) ? "阅读书架" : "收纳架",
      } as Record<string, string>
    )[item.icon] || item.name
  );
}

export function HomeExperience({
  actor,
  items,
  tasks,
  elder,
  onChanged,
  onOpen,
  onNavigate,
}: {
  actor: Person;
  items: Item[];
  tasks: Task[];
  elder: boolean;
  onChanged: () => void;
  onOpen: (item: Item) => void;
  onNavigate: (view: "add" | "plan" | "family" | "items") => void;
}) {
  const [places, setPlaces] = useState<Placement[]>([]);
  const [room, setRoom] = useState<RoomId>("living");
  const [selected, setSelected] = useState("");
  const [list, setList] = useState(false);
  const [includeDemo, setIncludeDemo] = useState(true);
  const [arrange, setArrange] = useState(false);
  const [animated, setAnimated] = useState(true);
  const [mood, setMood] = useState<CharacterMood>("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    startX: number;
    startY: number;
  } | null>(null);
  const generation = useRef(0);
  const dialoguePanel = useRef<HTMLDivElement>(null);
  const itemsSignature = items
    .map((i) => `${i.id}:${i.location}:${i.owner}:${i.shared}:${i.model}`)
    .join("|");
  const item = items.find((i) => i.id === selected);
  async function refresh() {
    const version = ++generation.current;
    try {
      const r = await fetch("/api/home", {
        headers: { "x-demo-actor": actor },
        cache: "no-store",
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (version === generation.current) {
        setPlaces(d.placements);
        setError("");
      }
    } catch (e) {
      if (version === generation.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    refresh();
    return () => {
      ++generation.current;
    };
  }, [actor, itemsSignature]);
  useEffect(() => {
    setAnimated(localStorage.getItem("wujian-character-motion") !== "off");
  }, []);
  useEffect(() => {
    if (mood !== "replying") return;
    const timer = setTimeout(() => setMood("idle"), 1800);
    return () => clearTimeout(timer);
  }, [mood]);
  function choose(id: string) {
    setSelected(id);
    setMood("replying");
    setError("");
    if (id && !arrange && window.matchMedia("(max-width: 1200px)").matches)
      dialoguePanel.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }
  async function save(place: Placement) {
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/home", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-demo-actor": actor },
        body: JSON.stringify({
          action: "place",
          input: {
            requestId: crypto.randomUUID(),
            itemId: place.itemId,
            roomId: place.roomId,
            x: place.x,
            y: place.y,
            expectedRevision: place.revision,
            expectedLocation:
              items.find((i) => i.id === place.itemId)?.location || "",
          },
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setPlaces((rows) =>
        rows.map((row) => (row.itemId === place.itemId ? d.placement : row)),
      );
      setRoom(place.roomId);
      setNotice("位置已保存");
      onChanged();
    } catch (e) {
      await refresh();
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const visibleItems = items.filter((i) => includeDemo || !i.demo);
  const inRoom = visibleItems.filter((i) =>
    places.some((p) => p.itemId === i.id && p.roomId === room),
  );
  const currentPlace = places.find((p) => p.itemId === item?.id);
  const unfinished = tasks.filter(
    (t) => t.assignee === actor && t.status !== "用户确认完成",
  ).length;
  return (
    <section className="home-experience" aria-label="我的家与物品伙伴">
      <div className="home-heading">
        <div>
          <div className="eyebrow">WU JIAN · A HOME WITH STORIES</div>
          <h1>家里的每一件，都有话想说</h1>
          <p>点开熟悉的物品，问问怎么用，也聊聊你们的故事。</p>
        </div>
        <button
          className="home-add text-button"
          onClick={() => onNavigate("add")}
        >
          <Plus size={17} /> 添一件物品
        </button>
      </div>
      <div className="home-workspace">
        <div className="home-space-panel">
          <div className="home-room-tabs" role="tablist" aria-label="选择房间">
            {rooms.map((r) => (
              <button
                role="tab"
                aria-selected={room === r.id}
                key={r.id}
                onClick={() => setRoom(r.id)}
              >
                {r.name}
                <small>
                  {
                    visibleItems.filter((i) =>
                      places.some(
                        (p) => p.itemId === i.id && p.roomId === r.id,
                      ),
                    ).length
                  }
                </small>
              </button>
            ))}
          </div>
          <div className="home-scene-toolbar">
            <span>
              <span className="live-dot" />{" "}
              {rooms.find((r) => r.id === room)?.name} · {inRoom.length}{" "}
              位物品伙伴
            </span>
            <button
              className="text-button"
              aria-pressed={list}
              onClick={() => setList(!list)}
            >
              {list ? <House size={15} /> : <List size={15} />}{" "}
              {list ? "房间视图" : "列表"}
            </button>
          </div>
          {!list ? (
            <div
              className={`home-scene-board room-${room} ${arrange ? "is-arranging" : ""}`}
              aria-label="房间示意，位置由用户记录"
            >
              <div className="scene-window">
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="scene-rug" />
              <div className="scene-plant">
                <span />
                <i />
              </div>
              <div className="scene-wall-note">
                {rooms.find((r) => r.id === room)?.hint}
              </div>
              {inRoom.map((i) => {
                const p = places.find((p) => p.itemId === i.id)!;
                return (
                  <button
                    key={i.id}
                    className={`scene-item ${selected === i.id ? "selected" : ""}`}
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                    aria-label={`和${i.name}对话${i.demo ? "，演示物品" : ""}`}
                    aria-pressed={selected === i.id}
                    disabled={saving}
                    onClick={() => choose(i.id)}
                    onPointerDown={(e) => {
                      if (!arrange || i.owner !== actor) return;
                      const board =
                        e.currentTarget.parentElement!.getBoundingClientRect();
                      drag.current = {
                        id: i.id,
                        x: board.left,
                        y: board.top,
                        startX: e.clientX,
                        startY: e.clientY,
                      };
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      const d = drag.current;
                      if (!d || d.id !== i.id) return;
                      const board =
                        e.currentTarget.parentElement!.getBoundingClientRect();
                      setPlaces((rows) =>
                        rows.map((row) =>
                          row.itemId === i.id
                            ? {
                                ...row,
                                x: Math.max(
                                  0.08,
                                  Math.min(
                                    0.92,
                                    (e.clientX - d.x) / board.width,
                                  ),
                                ),
                                y: Math.max(
                                  0.16,
                                  Math.min(
                                    0.86,
                                    (e.clientY - d.y) / board.height,
                                  ),
                                ),
                              }
                            : row,
                        ),
                      );
                    }}
                    onPointerUp={(e) => {
                      const d = drag.current;
                      drag.current = null;
                      if (
                        d &&
                        Math.abs(e.clientX - d.startX) +
                          Math.abs(e.clientY - d.startY) >
                          8
                      ) {
                        const board =
                          e.currentTarget.parentElement!.getBoundingClientRect();
                        save({
                          ...p,
                          x: Math.max(
                            0.08,
                            Math.min(0.92, (e.clientX - d.x) / board.width),
                          ),
                          y: Math.max(
                            0.16,
                            Math.min(0.86, (e.clientY - d.y) / board.height),
                          ),
                        });
                      }
                    }}
                    onPointerCancel={() => {
                      drag.current = null;
                      refresh();
                    }}
                  >
                    <ItemCharacter
                      item={i}
                      mood={
                        selected === i.id
                          ? mood
                          : tasks.some(
                                (t) =>
                                  t.itemId === i.id &&
                                  t.assignee === actor &&
                                  t.status !== "用户确认完成",
                              )
                            ? "attention"
                            : "idle"
                      }
                      animated={animated}
                      size={elder ? 104 : 90}
                    />
                    <span className="scene-item-name">{sceneName(i)}</span>
                    {i.demo && <small className="scene-demo-label">演示</small>}
                  </button>
                );
              })}
              {!inRoom.length && (
                <div className="scene-empty">
                  <ItemCharacter animated={animated} size={80} />
                  <p>这里还没有摆放物品</p>
                  <button
                    className="text-button"
                    onClick={() => onNavigate("items")}
                  >
                    从我的物品开始
                  </button>
                </div>
              )}
              <span className="scene-caption">房间示意 · 非实时定位</span>
            </div>
          ) : (
            <div className="home-item-list">
              {inRoom.length ? (
                inRoom.map((i) => (
                  <button key={i.id} onClick={() => choose(i.id)}>
                    <ItemCharacter item={i} animated={animated} size={62} />
                    <span>
                      {i.name}
                      <small>{i.demo ? "合成案例" : i.location}</small>
                    </span>
                    <MessageCircle size={17} />
                  </button>
                ))
              ) : (
                <p>这个房间暂时没有物品。</p>
              )}
            </div>
          )}
          <div className="home-scene-footer">
            <label>
              <input
                type="checkbox"
                checked={includeDemo}
                onChange={(e) => {
                  setIncludeDemo(e.target.checked);
                  if (!e.target.checked && item?.demo) choose("");
                }}
              />{" "}
              显示演示物品
            </label>
            <button
              className="text-button"
              aria-pressed={arrange}
              onClick={() => setArrange(!arrange)}
            >
              <Move size={14} /> {arrange ? "完成摆放" : "调整摆放"}
            </button>
          </div>
          {arrange && (
            <div className="scene-edit">
              <p>
                选择自己的物品后，可拖动调整位置，也可用下方控件摆放。实体位置需要你实际确认。
              </p>
              {item && currentPlace && item.owner === actor ? (
                <div className="scene-position-controls">
                  <label>
                    所在房间
                    <select
                      aria-label="物品所在房间"
                      value={currentPlace.roomId}
                      disabled={saving}
                      onChange={(e) =>
                        save({
                          ...currentPlace,
                          roomId: e.target.value as RoomId,
                        })
                      }
                    >
                      {rooms.map((r) => (
                        <option value={r.id} key={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    左右位置
                    <input
                      aria-label="左右位置"
                      type="range"
                      min="8"
                      max="92"
                      value={Math.round(currentPlace.x * 100)}
                      onChange={(e) =>
                        setPlaces((rows) =>
                          rows.map((p) =>
                            p.itemId === item.id
                              ? { ...p, x: Number(e.target.value) / 100 }
                              : p,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    前后位置
                    <input
                      aria-label="前后位置"
                      type="range"
                      min="16"
                      max="86"
                      value={Math.round(currentPlace.y * 100)}
                      onChange={(e) =>
                        setPlaces((rows) =>
                          rows.map((p) =>
                            p.itemId === item.id
                              ? { ...p, y: Number(e.target.value) / 100 }
                              : p,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    className="button secondary"
                    disabled={saving}
                    onClick={() => save(currentPlace)}
                  >
                    保存摆放
                  </button>
                </div>
              ) : (
                <small>先选择你拥有的物品；共享物品的位置由所有者调整。</small>
              )}
            </div>
          )}
          {error && (
            <div role="alert">
              {error}{" "}
              <button className="text-button" onClick={refresh}>
                重新读取摆放
              </button>
            </div>
          )}
          {notice && <small role="status">{notice}</small>}
          <div className="home-next">
            <button onClick={() => onNavigate("family")}>
              <span>家人的事</span>
              <strong>
                {unfinished ? `${unfinished} 件等着接力` : "一起照顾这个家"}
              </strong>
            </button>
            <button onClick={() => onNavigate("plan")}>
              <span>准备一个好日常</span>
              <strong>看看已有物品能做什么</strong>
            </button>
          </div>
        </div>
        <div className="home-dialogue-panel" ref={dialoguePanel}>
          <header className="home-dialogue-heading">
            <ItemCharacter
              item={item}
              mood={mood}
              animated={animated}
              size={88}
            />
            <div>
              <small>
                {item
                  ? item.demo
                    ? "演示物品 · 合成故事"
                    : "你的物品伙伴"
                  : "全屋 Agent"}
              </small>
              <h2>
                {item?.name.replace(/^\[示例\]\s*/, "") || "物间，和整个家聊聊"}
              </h2>
              <p>
                {item
                  ? "使用、故事、陪伴，都可以从一句话开始"
                  : "找物品、准备活动，也让家人接着处理"}
              </p>
            </div>
            {item && (
              <button
                className="text-button"
                aria-label="返回全屋对话"
                onClick={() => choose("")}
              >
                <X size={17} />
              </button>
            )}
          </header>
          {item ? (
            <div className="home-dialogue-links">
              <button className="text-button" onClick={() => choose("")}>
                <House size={14} /> 全屋对话
              </button>
              <button className="text-button" onClick={() => onOpen(item)}>
                物品资料与故事记录 ↗
              </button>
            </div>
          ) : (
            <div className="home-dialogue-intro">
              <Sparkles size={15} />
              <span>不知道找哪件？直接说你想做的事。</span>
            </div>
          )}
          <AssistantConversation
            key={`${actor}:${item?.id || "home"}`}
            actor={actor}
            item={item}
            mode="auto"
            elder={elder}
            onActivity={() => {
              refresh();
              onChanged();
              setMood("replying");
            }}
            onBusy={(busy) => setMood(busy ? "thinking" : "replying")}
            onSelectItem={(id) => {
              const p = places.find((p) => p.itemId === id);
              if (p) setRoom(p.roomId);
              choose(id);
            }}
            onHandoff={onChanged}
          />
          <details className="home-character-options">
            <summary>角色与动画</summary>
            <label>
              <input
                type="checkbox"
                checked={animated}
                onChange={(e) => {
                  setAnimated(e.target.checked);
                  localStorage.setItem(
                    "wujian-character-motion",
                    e.target.checked ? "on" : "off",
                  );
                }}
              />{" "}
              开启轻柔动画（跟随系统减少动态效果）
            </label>
            <p>
              角色动作表示正在等待或回应；没有感知家具的实时状态。称呼、语气和记忆授权可在下方“记忆与陪伴”管理。
            </p>
          </details>
        </div>
      </div>
    </section>
  );
}
