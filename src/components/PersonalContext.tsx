"use client";
import { useState } from "react";
import type { ContextFact, Person } from "@/lib/domain";
import type { Action } from "./FamilyTasks";
export function PersonalContext({
  actor,
  facts,
  act,
}: {
  actor: Person;
  facts: ContextFact[];
  act: Action;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <details className="panel">
      <summary>已有的帮助设置 · 查看与纠正</summary>
      <p>
        这里只显示你以前设置的固定帮助方式，可纠正或清除。新的背景和喜好通过物品对话逐步了解。默认不发送云端。
      </p>
      {(["instructionStyle", "skillLevel"] as const)
        .filter((key) =>
          facts.some(
            (c) =>
              c.owner === actor && c.key === key && c.status === "explicit",
          ),
        )
        .map((key) => {
          const fact = facts.find((c) => c.owner === actor && c.key === key);
          return (
            <form
              key={key + actor + (fact?.updatedAt || "")}
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                try {
                  await act(
                    "setContext",
                    {
                      key,
                      value: f.get("value") || null,
                      allowCloud: f.get("cloud") === "on",
                    },
                    "个人偏好已保存",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                {key === "instructionStyle" ? "指导方式" : "使用经验"}
                <select name="value" defaultValue={fact?.value || ""}>
                  <option value="">未知 / 清除偏好</option>
                  {key === "instructionStyle" ? (
                    <>
                      <option value="short">简短，先给关键事实</option>
                      <option value="detailed">完整展示资料依据</option>
                    </>
                  ) : (
                    <>
                      <option value="beginner">刚开始接触</option>
                      <option value="experienced">已有使用经验</option>
                    </>
                  )}
                </select>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  name="cloud"
                  defaultChecked={fact?.allowCloud || false}
                />
                我允许在本人提问时将此项偏好提供给已配置的模型
              </label>
              <small>
                {fact
                  ? `${fact.status === "explicit" ? "本人明确表达" : fact.status === "inferred" ? "系统推测，未确认" : "未知"} · ${fact.updatedAt}`
                  : "未知 · 尚未设置"}
              </small>
              <button className="button secondary" disabled={busy}>
                保存 / 纠正
              </button>
            </form>
          );
        })}
    </details>
  );
}
