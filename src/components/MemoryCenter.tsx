"use client";
import { useEffect, useState } from "react";
import type { Item, Memory, Person } from "@/lib/domain";
import type { MemoryRecord, Persona } from "@/lib/agent/contracts";
import { AssistantConversation } from "./AssistantConversation";
const kinds = {
  preference: "偏好",
  interest: "兴趣与喜好",
  experience: "经历",
  story: "真实故事",
  method: "有用的方法",
  relationship: "人与物的关系",
  fiction: "想象创作（不当作真实记忆）",
};
export function MemoryCenter({
  actor,
  items,
  stories = [],
}: {
  actor: Person;
  items: Item[];
  stories?: Memory[];
}) {
  const [records, setRecords] = useState<MemoryRecord[]>([]),
    [editing, setEditing] = useState<MemoryRecord | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [scope, setScope] = useState(""),
    [persona, setPersona] = useState<Persona>({
      enabled: false,
      nickname: "",
      style: "warm",
    }),
    [version, setVersion] = useState(0);
  const headers = { "Content-Type": "application/json", "x-demo-actor": actor };
  async function load() {
    const r = await fetch(
      "/api/memories?" + new URLSearchParams(scope ? { itemId: scope } : {}),
      { headers },
    );
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    return d;
  }
  useEffect(() => {
    let cancelled = false;
    load()
      .then((d) => {
        if (!cancelled) {
          setRecords(d.memories);
          setPersona(d.persona);
        }
      })
      .catch((e) => {
        if (!cancelled) setNotice(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [actor, scope, version]);
  async function change(body: unknown, method = "POST") {
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch("/api/memories", {
        method,
        headers,
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setVersion((v) => v + 1);
      window.dispatchEvent(new Event("memory-updated"));
      localStorage.setItem(
        "product-agent-memory-revision",
        JSON.stringify({ actor, at: Date.now() }),
      );
      setNotice(
        "已更新。纠正、忘记或角色设置变化后，旧对话上下文会一并清除。备份文件需单独管理。",
      );
      return true;
    } catch (e) {
      setNotice((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="panel memory-center">
      <summary>关于我与记住的事 · 记忆、兴趣与可选陪伴</summary>
      <p>
        记住的是你愿意留下的经历、兴趣、人与物的关系。不会根据购买、送礼或年龄猜测你的喜好，也不会自动把旧故事交给模型。
      </p>
      <form
        key={editing?.id || "new"}
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          if (
            await change({
              requestId: crypto.randomUUID(),
              id: editing?.id,
              memory: {
                kind: f.get("kind"),
                text: f.get("text"),
                itemId: f.get("itemId") || undefined,
                allowCloud: f.get("cloud") === "on",
                status: f.get("status"),
              },
            })
          ) {
            setEditing(null);
            form.reset();
          }
        }}
      >
        <label>
          记忆类型
          <select name="kind" defaultValue={editing?.kind || "interest"}>
            {Object.entries(kinds).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          想留下什么
          <textarea
            name="text"
            required
            maxLength={1500}
            defaultValue={editing?.text || ""}
            placeholder="例如：我喜欢和爸爸一起做手工；这只杯子是毕业那天收到的"
          />
        </label>
        <label>
          相关物品（可选）
          <select name="itemId" defaultValue={editing?.itemId || ""}>
            <option value="">关于我，不绑定物品</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          保存方式
          <select name="status" defaultValue={editing?.status || "active"}>
            <option value="active">我明确确认，持续保留</option>
            <option value="candidate">先作候选，7 天后过期</option>
          </select>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            name="cloud"
            defaultChecked={editing?.allowCloud || false}
          />
          允许在相关提问时把此条记忆提供给已配置的模型
        </label>
        <button className="button secondary" disabled={busy}>
          {editing ? "保存纠正" : "明确记住"}
        </button>
        {editing && (
          <button
            className="text-button"
            type="button"
            onClick={() => setEditing(null)}
          >
            取消纠正
          </button>
        )}
      </form>
      <p>
        对话中也可以说“记住：我喜欢……”，默认仅用于本地。候选与想象创作不作为真实记忆召回。
      </p>
      {notice && <p role="status">{notice}</p>}
      {records.map((m) => (
        <article className="source-card" key={m.id}>
          <strong>
            {kinds[m.kind]} ·{" "}
            {m.status === "active" ? "本人确认" : "待确认候选"}
          </strong>
          <p>{m.text}</p>
          <small>
            {m.allowCloud ? "允许相关问题上云" : "仅本地使用"} · 版本{" "}
            {m.version}
          </small>
          <div className="inline">
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setEditing(m)}
            >
              纠正 / 调整授权
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => change({ id: m.id }, "DELETE")}
            >
              忘记
            </button>
            {m.status === "candidate" && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  change({
                    id: m.id,
                    requestId: crypto.randomUUID(),
                    memory: {
                      kind: m.kind,
                      text: m.text,
                      itemId: m.itemId,
                      allowCloud: m.allowCloud,
                      status: "active",
                    },
                  })
                }
              >
                确认保留
              </button>
            )}
          </div>
        </article>
      ))}
      {!!stories.filter((s) => s.author === actor && !s.origin).length && (
        <details>
          <summary>主动引用自己以前写下的物品故事</summary>
          {stories
            .filter((s) => s.author === actor && !s.origin)
            .map((s) => (
              <article key={s.id}>
                <p>{s.text}</p>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    change({ action: "importStory", storyId: s.id })
                  }
                >
                  作为本人的故事记忆（默认本地）
                </button>
              </article>
            ))}
        </details>
      )}
      <details>
        <summary>可选陪伴的交流方式</summary>
        <label>
          应用范围
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setPersona({ enabled: false, nickname: "", style: "warm" });
            }}
          >
            <option value="">普通陪伴</option>
            {items
              .filter((i) => i.owner === actor)
              .map((i) => (
                <option value={i.id} key={i.id}>
                  {i.name}
                </option>
              ))}
          </select>
        </label>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await change({
              action: "persona",
              input: { ...persona, itemId: scope || undefined },
            });
          }}
        >
          <label className="check-row">
            <input
              type="checkbox"
              checked={persona.enabled}
              onChange={(e) =>
                setPersona({ ...persona, enabled: e.target.checked })
              }
            />
            开启我选择的陪伴交流
          </label>
          <label>
            称呼
            <input
              value={persona.nickname}
              maxLength={40}
              onChange={(e) =>
                setPersona({ ...persona, nickname: e.target.value })
              }
            />
          </label>
          <label>
            语气
            <select
              value={persona.style}
              onChange={(e) =>
                setPersona({
                  ...persona,
                  style: e.target.value as Persona["style"],
                })
              }
            >
              <option value="neutral">自然直接</option>
              <option value="warm">温和陪伴</option>
              <option value="playful">轻松活泼</option>
            </select>
          </label>
          <p>
            开启后，称呼和语气用于交流。它是
            AI，不会感知实物，也没有真实共同经历；可随时关闭。
          </p>
          <button className="button secondary" disabled={busy}>
            保存交流方式
          </button>
        </form>
        {persona.enabled && (
          <AssistantConversation
            key={actor + scope + version}
            actor={actor}
            item={items.find((i) => i.id === scope)}
            mode="companion"
          />
        )}
      </details>
    </details>
  );
}
