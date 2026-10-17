"use client";
import { useState } from "react";
import type { Item, Person, Plan } from "@/lib/domain";
import { prepareActivity } from "@/lib/planning";
export function ActivityPlanner({
  items,
  actor,
  plans,
  save,
}: {
  items: Item[];
  actor: Person;
  plans: Plan[];
  save: (
    action: string,
    p: Record<string, unknown>,
    message?: string,
  ) => Promise<boolean>;
}) {
  const [goal, setGoal] = useState("");
  const [ready, setReady] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const rows = prepareActivity(goal, items, actor);
  return (
    <div className="simple-page">
      <h1>这次出门，要带些什么？</h1>
      <p>说说安排，帮你看看家里有什么、还要准备什么。</p>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          setReady(true);
        }}
      >
        <label>
          活动安排
          <input
            required
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value);
              setReady(false);
              setChoices({});
            }}
            placeholder="例如：周末四个人去野餐"
          />
        </label>
        <div className="chips">
          {["周末四个人去野餐", "准备出门旅行"].map((g) => (
            <button
              type="button"
              key={g}
              onClick={() => {
                setGoal(g);
                setReady(true);
                setChoices({});
              }}
            >
              {g}
            </button>
          ))}
        </div>
        <button className="button">帮我看看要带什么</button>
      </form>
      {ready && (
        <section className="panel">
          <h2>{goal}</h2>
          {!rows ? (
            <p>
              目前能整理野餐、郊游和出门旅行的基础清单。这个活动还没有对应清单，暂时不能准确判断缺少什么。
            </p>
          ) : (
            <>
              <p className="muted">
                根据已有物品记录整理，未确认实时库存。可以直接修改每项结果。
              </p>
              {rows.map((row) => (
                <article className="preparation-row" key={row.label}>
                  <div>
                    <h3>{row.label}</h3>
                    <p>
                      {row.items.length
                        ? `有记录：${row.items.map((i) => i.name).join("、")}`
                        : "还没有找到记录，不代表家里没有。"}
                    </p>
                    <small>{row.reason}</small>
                  </div>
                  <label>
                    <span className="sr-only">{row.label}准备状态</span>
                    <select
                      aria-label={`${row.label}准备状态`}
                      value={
                        choices[row.label] ||
                        (row.items.length ? "有记录，待核实" : "没记录，待确认")
                      }
                      onChange={(e) =>
                        setChoices({ ...choices, [row.label]: e.target.value })
                      }
                    >
                      <option>有记录，待核实</option>
                      <option>没记录，待确认</option>
                      <option>家里有，已准备</option>
                      <option>需要准备</option>
                      <option>这次不用带</option>
                    </select>
                  </label>
                </article>
              ))}
              <button
                className="button"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await save(
                      "savePlan",
                      {
                        goal,
                        itemIds: [
                          ...new Set(
                            rows
                              .filter((r) => choices[r.label] !== "这次不用带")
                              .flatMap((r) => r.items.map((i) => i.id)),
                          ),
                        ],
                        checklist: rows.map((r) => ({
                          label: r.label,
                          status:
                            choices[r.label] ||
                            (r.items.length
                              ? "有记录，待核实"
                              : "没记录，待确认"),
                        })),
                      },
                      "活动清单已保存",
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                保存这份清单
              </button>
            </>
          )}
        </section>
      )}
      {!!plans.length && (
        <details className="panel">
          <summary>之前的活动清单（{plans.length}）</summary>
          {plans
            .slice()
            .reverse()
            .map((p) => (
              <article key={p.id} className="source-card">
                <h3>{p.goal}</h3>
                {p.checklist?.map((r) => (
                  <p key={r.label}>
                    {r.label} · {r.status}
                  </p>
                ))}
                {!p.checklist && <p>已保存 {p.itemIds.length} 件物品</p>}
              </article>
            ))}
        </details>
      )}
    </div>
  );
}
