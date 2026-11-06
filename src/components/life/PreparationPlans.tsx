"use client";
import { useRef, useState } from "react";
import type { Plan } from "@/lib/domain";
import type { PreparationStep } from "@/lib/life/task-types";

export function PreparationPlans({
  plans,
  act,
  onContinue,
}: {
  plans: Plan[];
  act: (
    action: string,
    input: Record<string, unknown>,
    message?: string,
  ) => Promise<boolean>;
  onContinue: (plan: Plan, question: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef<{
    key: string;
    input: Record<string, unknown>;
  } | null>(null);
  const saved = plans
    .filter((p) => p.preparation)
    .slice()
    .reverse();
  if (!saved.length) return null;
  async function update(
    plan: Plan,
    step: PreparationStep,
    status: PreparationStep["status"],
  ) {
    if (busy) return;
    const key = `${plan.id}:${plan.preparation!.revision}:${step.id}:${status}`;
    if (pending.current?.key !== key)
      pending.current = {
        key,
        input: {
          planId: plan.id,
          stepId: step.id,
          status,
          expectedRevision: plan.preparation!.revision,
          requestId: crypto.randomUUID(),
        },
      };
    setBusy(true);
    try {
      if (
        await act(
          "setPreparationStep",
          pending.current.input,
          "已保存你的准备进度",
        )
      )
        pending.current = null;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="preparation-plans" aria-label="我的准备清单">
      <h2>我的准备清单</h2>
      {saved.map((plan, index) => {
        const p = plan.preparation!;
        const required = p.steps.filter((s) => s.required);
        const completed = required.filter(
          (s) => s.status === "done" && !s.reviewReason,
        ).length;
        return (
          <details
            className="life-card preparation-plan"
            key={plan.id}
            open={index === 0}
          >
            <summary>
              {plan.goal} · {completed}/{required.length} 项必要准备
            </summary>
            <p role="status">
              {p.status === "ready"
                ? "必要准备已由你确认，可以按计划出发。"
                : p.status === "blocked"
                  ? "有条件需要处理或再次核对。"
                  : "按实际准备情况逐项确认。"}
            </p>
            <p className="life-muted">
              {p.constraints.departureText &&
                `出发：${p.constraints.departureText}。`}
              {p.constraints.preparationMinutes &&
                `准备时间：${p.constraints.preparationMinutes} 分钟。`}
              这是有限的本地准备清单，不代表设备检测或出游已完成。
            </p>
            <ol className="preparation-steps">
              {p.steps.map((step) => {
                const unmet = step.dependencies
                  .map((id) => p.steps.find((s) => s.id === id))
                  .filter((s) => !s || s.status !== "done" || s.reviewReason);
                return (
                  <li key={step.id} data-step-id={step.id}>
                    <div className="preparation-step-title">
                      <strong>{step.action}</strong>
                      <span>
                        {step.required ? "必要" : "可选"} ·{" "}
                        {step.status === "done"
                          ? step.reviewReason
                            ? "需再次确认"
                            : "已确认"
                          : step.status === "blocked"
                            ? "受阻"
                            : step.status === "skipped"
                              ? "已省略"
                              : "待准备"}
                      </span>
                    </div>
                    {(step.blockedReason || step.reviewReason) && (
                      <p className="preparation-warning">
                        {step.blockedReason || step.reviewReason}
                      </p>
                    )}
                    <details>
                      <summary>查看物品与确认条件</summary>
                      {step.bindings.map((b) => (
                        <p key={b.itemId}>
                          {b.name} · {b.basis}
                        </p>
                      ))}
                      <ul>
                        {step.conditions.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                      {unmet.length > 0 && (
                        <p>
                          先完成：
                          {unmet
                            .map((s) => s?.action || "待核对的前置步骤")
                            .join("、")}
                        </p>
                      )}
                      {step.completionReport && (
                        <p>
                          上次本人确认：
                          {new Date(step.completionReport.at).toLocaleString(
                            "zh-CN",
                          )}
                        </p>
                      )}
                    </details>
                    <div className="life-actions">
                      {(step.status !== "done" || step.reviewReason) &&
                        step.status !== "skipped" && (
                          <button
                            disabled={
                              busy || !!step.blockedReason || unmet.length > 0
                            }
                            onClick={() => update(plan, step, "done")}
                          >
                            {step.reviewReason
                              ? "我已重新核对"
                              : "我已确认完成"}
                          </button>
                        )}
                      {step.status === "done" && !step.reviewReason && (
                        <button
                          disabled={busy}
                          onClick={() => update(plan, step, "pending")}
                        >
                          改为待准备
                        </button>
                      )}
                      {!step.required &&
                        !step.bindings.some((b) =>
                          p.constraints.excludedItemIds.includes(b.itemId),
                        ) && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              update(
                                plan,
                                step,
                                step.status === "skipped"
                                  ? "pending"
                                  : "skipped",
                              )
                            }
                          >
                            {step.status === "skipped"
                              ? "恢复准备"
                              : "这次不带"}
                          </button>
                        )}
                      {step.status === "pending" && (
                        <button
                          disabled={busy}
                          onClick={() => update(plan, step, "blocked")}
                        >
                          遇到问题
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="life-actions">
              <button
                disabled={busy}
                onClick={() => onContinue(plan, "重新核对这份准备清单")}
              >
                重新核对物品
              </button>
              <button
                disabled={busy}
                onClick={() => onContinue(plan, "继续准备")}
              >
                继续对话调整
              </button>
            </div>
            <small>
              可继续说“相机没电了”或“只剩10分钟，手电筒不带了”。变化不会删除已经完成的记录。
            </small>
            <details>
              <summary>查看调整记录（{p.history.length}）</summary>
              {p.history
                .slice()
                .reverse()
                .map((h, i) => (
                  <p key={i}>
                    {new Date(h.at).toLocaleString("zh-CN")} · {h.reason}
                  </p>
                ))}
            </details>
          </details>
        );
      })}
    </section>
  );
}
