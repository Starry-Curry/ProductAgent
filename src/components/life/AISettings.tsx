"use client";
import { useEffect, useState } from "react";
import type { Person, Item } from "@/lib/domain";
import type { Persona } from "@/lib/agent/contracts";
export function AISettings({
  actor,
  item,
  onChat,
}: {
  actor: Person;
  item?: Item;
  onChat?: () => void;
}) {
  const [persona, setPersona] = useState<Persona>({
      enabled: false,
      nickname: "",
      style: "neutral",
      memoryUse: "explicit",
    }),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(
      "/api/memories" + (item ? "?itemId=" + encodeURIComponent(item.id) : ""),
      { headers: { "x-demo-actor": actor } },
    )
      .then((r) => r.json())
      .then((d) => {
        if (active && d.persona) {
          setPersona({
            ...d.persona,
            memoryUse: d.persona.memoryUse || "explicit",
          });
          setSaved(true);
        }
      })
      .catch(() => {
        if (active) setNotice("设置读取失败，请稍后重试");
      });
    return () => {
      active = false;
    };
  }, [actor, item?.id]);
  return (
    <details className="life-card life-ai-settings">
      <summary>
        {item ? "物品伙伴 · 由你决定是否开启" : "交流偏好 · 称呼、风格与记忆"}
      </summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setNotice("");
          try {
            const r = await fetch("/api/memories", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-demo-actor": actor,
              },
              body: JSON.stringify({
                action: "persona",
                input: { ...persona, itemId: item?.id },
              }),
            });
            const d = await r.json();
            if (!r.ok) throw Error(d.error);
            setSaved(true);
            window.dispatchEvent(
              new CustomEvent("memory-updated", { detail: { actor } }),
            );
            window.dispatchEvent(new Event("memory-captured"));
            setNotice(
              "交流设置已保存；聊天历史保留，新回复按当前设置。记忆上云仍需逐条授权。",
            );
          } catch (e) {
            setNotice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="life-muted">
          {item
            ? "物品伙伴不会感知实物、代替检测或编造共同经历。关闭后产品帮助、创意和故事仍正常使用。"
            : "默认自然交流；称呼指你给物间的名字，不是你的真实姓名。"}
        </p>
        <label className="life-check">
          <input
            type="checkbox"
            checked={persona.enabled}
            onChange={(e) => {
              setSaved(false);
              setPersona({ ...persona, enabled: e.target.checked });
            }}
          />
          {item ? "主动开启这件物品的伙伴语气" : "使用自定义称呼与交流风格"}
        </label>
        <label>
          {item ? "伙伴昵称" : "物间的称呼"}
          <input
            value={persona.nickname}
            maxLength={40}
            onChange={(e) => {
              setSaved(false);
              setPersona({ ...persona, nickname: e.target.value });
            }}
            placeholder={item ? item.name : "物间"}
          />
        </label>
        <label>
          交流风格
          <select
            aria-label="交流风格"
            value={persona.style}
            onChange={(e) => {
              setSaved(false);
              setPersona({
                ...persona,
                style: e.target.value as Persona["style"],
              });
            }}
          >
            <option value="neutral">简洁实用</option>
            <option value="warm">自然亲切</option>
            <option value="playful">有趣活泼</option>
          </select>
        </label>
        <label>
          个人记忆引用
          <select
            aria-label="个人记忆引用"
            value={persona.memoryUse || "explicit"}
            onChange={(e) => {
              setSaved(false);
              setPersona({
                ...persona,
                memoryUse: e.target.value as Persona["memoryUse"],
              });
            }}
          >
            <option value="off">不引用长期记忆</option>
            <option value="explicit">仅在我主动回忆时引用</option>
            <option value="relevant">按任务引用相关的已授权记忆</option>
          </select>
        </label>
        <div className="life-actions">
          <button disabled={busy}>{busy ? "保存中…" : "保存交流设置"}</button>
          {item && onChat && (
            <button
              type="button"
              disabled={!saved || !persona.enabled || busy}
              onClick={onChat}
            >
              与这件物品聊天
            </button>
          )}
        </div>
        <p role="status">
          {notice || (item && !saved ? "保存设置后可开始伙伴聊天。" : "")}
        </p>
      </form>
    </details>
  );
}
