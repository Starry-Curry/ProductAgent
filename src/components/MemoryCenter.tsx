"use client";
import { useEffect, useState } from "react";
import type { Item, Person } from "@/lib/domain";
import type { MemoryRecord, Persona } from "@/lib/agent/contracts";
import { AssistantConversation } from "./AssistantConversation";
const kinds = {
  preference: "偏好",
  interest: "兴趣与喜好",
  experience: "经历",
  story: "物品故事",
  method: "有用的方法",
  relationship: "人与物的关系",
  fiction: "想象创作（不当作真实记忆）",
  possession: "持有记录",
  purchase: "购买经历（未核验订单）",
  requirement: "本次或近期要求",
};
export function MemoryCenter({
  actor,
  items,
  focusItemId,
}: {
  actor: Person;
  items: Item[];
  focusItemId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [records, setRecords] = useState<MemoryRecord[]>([]),
    [editing, setEditing] = useState<MemoryRecord | null>(null),
    [busy, setBusy] = useState(false),
    [showDemo, setShowDemo] = useState(false),
    [introduction, setIntroduction] = useState({
      available: false,
      status: "not_started",
    }),
    [showAll, setShowAll] = useState(false),
    [capture, setCapture] = useState(true),
    [notice, setNotice] = useState(""),
    [scope, setScope] = useState(focusItemId || ""),
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
          setIntroduction(d.introduction);
          setCapture(d.capture.enabled);
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
  useEffect(() => {
    const refresh = () => setVersion((v) => v + 1);
    window.addEventListener("memory-captured", refresh);
    return () => window.removeEventListener("memory-captured", refresh);
  }, []);
  async function change(body: unknown, method = "POST", invalidates = true) {
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
      setEditing(null);
      const action = body as { id?: string; action?: string };
      const changed = records.find((m) => m.id === action.id);
      const demoScope = changed?.demo
        ? changed.itemId
        : action.action === "persona" && items.find((i) => i.id === scope)?.demo
          ? scope
          : undefined;
      if (invalidates)
        window.dispatchEvent(
          new CustomEvent("memory-updated", {
            detail: { actor, scope: demoScope },
          }),
        );
      if (invalidates)
        localStorage.setItem(
          "product-agent-memory-revision",
          JSON.stringify({ actor, scope: demoScope, at: Date.now() }),
        );
      setNotice(
        invalidates
          ? demoScope
            ? "演示记忆已更新，该案例的旧上下文已清除。"
            : "已更新，旧对话上下文已清除。备份文件需单独管理。"
          : "设置已保存。",
      );
      return true;
    } catch (e) {
      setNotice((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const demoCount = records.filter((m) => m.demo).length;
  useEffect(() => {
    if (records.some((m) => m.status === "candidate")) setExpanded(true);
  }, [records]);
  const shown = records.filter((m) =>
    focusItemId ? m.itemId === focusItemId : showDemo ? m.demo : !m.demo,
  );
  return (
    <details
      className="panel memory-center"
      open={expanded}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary>记忆与陪伴 · 看看它记下了什么</summary>
      <p>
        以物品详情的“故事与记录”为主要窗口：讲述人与物的经历时静默整理；普通聊天、记录物品和反馈使用结果作为补充来源。无需填写个人资料；购买和持有不等于喜欢。私人记忆默认不上云。
      </p>
      <div className="inline">
        <span>
          {capture ? "自动整理已开启" : "自动整理已暂停"} · {shown.length}{" "}
          条可查看记录
        </span>
        <button
          className="text-button"
          disabled={busy}
          onClick={() =>
            change({ action: "capture", enabled: !capture }, "POST", false)
          }
        >
          {capture ? "暂停自动整理" : "恢复自动整理"}
        </button>
      </div>
      <p className="memory-hint">
        记忆会影响后续相关帮助；本次要求优先于过去兴趣。你可以查看来源，随时纠正或忘记。临时提问不使用也不生成记忆。
      </p>
      {!focusItemId && introduction.available && (
        <details className="initial-introduction">
          <summary>第一次见面，可选地介绍一下自己</summary>
          <p>
            只在开始时留一点背景即可。之后的新经历，都可以在与物品对话时自然告诉它；也可以现在跳过。
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await change({
                action: "introduction",
                requestId: crypto.randomUUID(),
                text: f.get("introduction"),
              });
            }}
          >
            <label>
              想让我先了解的一点背景
              <textarea
                name="introduction"
                maxLength={1000}
                required
                placeholder="用自己的话说一点生活背景，或者直接跳过。"
              />
            </label>
            <div className="inline">
              <button className="button secondary" disabled={busy}>
                保存这次介绍
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  change(
                    {
                      action: "skipIntroduction",
                      requestId: crypto.randomUUID(),
                    },
                    "POST",
                    false,
                  )
                }
              >
                先跳过，以后通过物品聊天
              </button>
            </div>
          </form>
        </details>
      )}
      {!focusItemId && demoCount > 0 && (
        <button className="text-button" onClick={() => setShowDemo(!showDemo)}>
          {showDemo ? "只看我的记忆" : "查看演示记忆（" + demoCount + " 条）"}
        </button>
      )}
      {showDemo && !focusItemId && (
        <p>
          以下为合成案例记忆，不代表你的真实背景或喜好，仅在对应演示物品中使用。
        </p>
      )}
      {editing && (
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
                  expiresAt:
                    editing?.kind === "requirement"
                      ? editing.expiresAt
                      : undefined,
                },
              })
            ) {
              setEditing(null);
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
            纠正内容
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
            <select
              name="itemId"
              defaultValue={editing?.itemId || focusItemId || ""}
            >
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
              <option value="active">正常使用（可随时忘记）</option>
              <option value="candidate">先作候选，7 天后过期</option>
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              name="cloud"
              defaultChecked={editing?.allowCloud || false}
              disabled={!!editing?.demo}
            />
            允许在相关提问时把此条记忆提供给已配置的模型
          </label>
          <button className="button secondary" disabled={busy}>
            保存纠正
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
      )}
      <p>
        有新的经历，直接进入物品的“故事与记录”聊一聊。这里用于查看与纠正；候选和想象创作不当作真实记忆。
      </p>
      {notice && <p role="status">{notice}</p>}
      {!shown.length && (
        <p>
          还没有整理出记忆。正常使用即可；示例物品不会被当成你的真实持有记录。
        </p>
      )}
      {(showAll ? shown : shown.slice(0, 6)).map((m) => (
        <article className="source-card" key={m.id}>
          <strong>
            {kinds[m.kind]} ·{" "}
            {m.demo
              ? "演示记忆 · 非真实用户画像"
              : m.source === "automatic"
                ? m.provenance?.basis === "observation"
                  ? "行为观察"
                  : m.provenance?.basis === "app_record"
                    ? "系统登记"
                    : m.provenance?.basis === "user_feedback"
                      ? "本人反馈"
                      : "交流中提取"
                : "本人补充 / 纠正"}
          </strong>
          <p>{m.text}</p>
          {m.status === "candidate" && (
            <p className="life-notice">待你确认 · 还不会作为长期认识使用</p>
          )}
          {m.archived && (
            <p className="muted">
              关联物品已离手或不可访问。这份私人记录仍属于你，仅主动回忆时使用，不随物品转交。
            </p>
          )}
          {m.provenance && (
            <details>
              <summary>为什么记下这条？</summary>
              <p>
                来源：
                {m.demo
                  ? m.provenance.extractor === "household-demo-v1"
                    ? "案例库合成设定"
                    : "演示中的对话与记录"
                  : m.provenance.extractor === "introduction-v1"
                    ? "首次自我介绍"
                    : {
                        chat: "本人聊天",
                        item: "物品登记或备注",
                        story: "本人写下的物品故事",
                        operation: "本人操作记录",
                        task: "本人任务要求",
                        feedback: "本人使用反馈",
                      }[m.provenance.kind]}{" "}
                · {new Date(m.provenance.at).toLocaleString("zh-CN")}
              </p>
              <small>
                {m.demo
                  ? "这是案例中的合成内容或演示对话，不用于真实画像。"
                  : "这条依据你的原始记录整理，未经过实物检测。"}
                {m.expiresAt
                  ? "到期自动失效。"
                  : "持续保留，可随时纠正或忘记。"}
              </small>
            </details>
          )}
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
      {shown.length > 6 && (
        <button className="text-button" onClick={() => setShowAll(!showAll)}>
          {showAll ? "收起记录" : "查看全部记忆"}
        </button>
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
            key={actor + scope}
            actor={actor}
            item={items.find((i) => i.id === scope)}
            mode="companion"
          />
        )}
      </details>
    </details>
  );
}
