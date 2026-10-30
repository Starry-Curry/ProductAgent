"use client";
import { useEffect, useState } from "react";
import type { Item, Person } from "@/lib/domain";
import type { TaskSpec, TaskRun } from "@/lib/foundation/tasks";
export function TaskContinuity({
  actor,
  items,
  onResume,
  onExit,
}: {
  actor: Person;
  items: Item[];
  onResume: (taskId: string, itemId?: string, sessionId?: string, newGoal?: string) => void;
  onExit: () => void;
}) {
  const [tasks, setTasks] = useState<TaskSpec[]>([]),
    [current, setCurrent] = useState<{
      task: TaskSpec;
      runs: TaskRun[];
      outcomes: any[];
    } | null>(null),
    [goal, setGoal] = useState(""),
    [chosen, setChosen] = useState<string[]>([]),
    [notes, setNotes] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [reuse, setReuse] = useState(false);
  const [allowCloud,setAllowCloud]=useState(false);
  const [editing,setEditing]=useState<any>(null),[correction,setCorrection]=useState("");
  async function request(action?: string, input?: unknown, id?: string) {
    const r = await fetch(
      "/api/foundation" + (id ? "?taskId=" + encodeURIComponent(id) : ""),
      {
        method: action ? "POST" : "GET",
        headers: { "Content-Type": "application/json", "x-demo-actor": actor },
        ...(action ? { body: JSON.stringify({ action, input }) } : {}),
      },
    );
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "任务未能加载");
    return d;
  }
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const d = await request();
        if (!live) return;
        setTasks(d.tasks);
        const id = localStorage.getItem("wujian-task:" + actor);
        if (id) {
          if (!d.tasks.some((t: TaskSpec) => t.taskId === id)) {
            setCurrent(null);
            localStorage.removeItem("wujian-task:" + actor);
          } else {
            const detail = await request(undefined, undefined, id);
            if (live)
              setCurrent({
                task: detail.task,
                runs: detail.runs,
                outcomes: detail.outcomes,
              });
          }
        }
      } catch (e) {
        if (live) {
          setCurrent(null);
          setTasks([]);
          setError(e instanceof Error ? e.message : "任务读取失败");
        }
      }
    };
    setCurrent(null);
    setTasks([]);
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [actor]);
  async function open(t: TaskSpec, resume = true, fresh = false) {
    const d = await request(undefined, undefined, t.taskId);
    setCurrent({ task: d.task, runs: d.runs, outcomes: d.outcomes });
    localStorage.setItem("wujian-task:" + actor, t.taskId);
    if (resume) {
      const session = d.runs.find((r: TaskRun) => r.sessionId)?.sessionId;
      onResume(t.taskId, t.itemInstanceIds[0], session, fresh ? d.task.goal : undefined);
    }
  }
  async function create() {
    setBusy(true);
    setError("");
    try {
      const d = await request("create", {
        requestId: crypto.randomUUID(),
        goal,
        intent: "plan",
        itemInstanceIds: chosen,
      });
      setTasks((t) => [d.task, ...t]);
      await open(d.task,true,true);
      setGoal("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }
  async function report(status: "achieved" | "not_achieved") {
    if (!current) return;
    const run = current.runs[0];
    if (!run) return;
    setBusy(true);
    setError("");
    try {
      await request("outcome", {
        taskId: current.task.taskId,
        runId: run.runId,
        requestId: crypto.randomUUID(),
        expectedRevision: current.task.revision,
        goalStatus: status,
        notes,
        confirmed: true,
        reuse,
        allowCloud,
      });
      await open(current.task, false);
      setNotes("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "反馈失败");
    } finally {
      setBusy(false);
    }
  }
  async function amend(o:any, operation:"correct"|"forget"|"revoke_reuse") {
    if(!current)return;
    setBusy(true);setError("");
    try {
      await request("amend_outcome",{outcomeId:o.outcomeId,requestId:crypto.randomUUID(),expectedRevision:o.revision||1,operation,confirmed:true,...(operation==="correct"?{notes:correction,reuse,allowCloud}:{})});
      setEditing(null);setCorrection("");await open(current.task,false);
    }catch(e){setError(e instanceof Error?e.message:"经验更新失败");}finally{setBusy(false);}
  }
  return (
    <details className="life-task-continuity" data-testid="task-continuity">
      <summary>继续我的事{current ? " · " + current.task.goal : ""}</summary>
      <p>
        从物品、故事或家人处返回时，继续同一件事。建议不会自动记为现实完成。
      </p>
      {error && <p role="alert">{error}</p>}
      {current && (
        <section>
          <h3>{current.task.goal}</h3>
          <p>
            {current.task.currentStage === "completed"
              ? "你已报告完成"
              : current.task.currentStage === "blocked"
                ? "需要重新核对条件或权限"
                : "等待你的下一步"}{" "}
            · {current.runs.length}次运行
          </p>
          <button
            onClick={() => open(current.task).catch((e) => setError(e.message))}
          >
            回到这件事
          </button>
          <button
            onClick={() => {
              localStorage.removeItem("wujian-task:" + actor);
              setCurrent(null);
              onExit();
            }}
          >
            暂时离开这件事
          </button>
          {current.runs.length > 0 && (
            <>
              <label>
                实际尝试结果
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="只有你实际经历的情况"
                  maxLength={1200}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={reuse}
                  onChange={(e) => setReuse(e.target.checked)}
                />
                允许以后同一物品的任务参考这条结果（仍仅自己可见）
              </label>
              {reuse&&<label><input type="checkbox" checked={allowCloud} onChange={e=>setAllowCloud(e.target.checked)}/>也允许本条结果交给云端 AI 帮助我（可不选）</label>}
              <button
                disabled={busy || !notes.trim()}
                onClick={() => report("achieved")}
              >
                确认：我已完成
              </button>
              <button
                disabled={busy || !notes.trim()}
                onClick={() => report("not_achieved")}
              >
                确认：还没解决
              </button>
              <small>记为你的报告；不是设备回读，也不自动分享。</small>
            </>
          )}
          {current.outcomes.map((o) => (
            <div key={o.outcomeId}>
              <p>{o.status==="forgotten"?"这条经验已忘记":`用户报告：${o.notes}`}</p>
              {o.basis==="user_report"&&o.status!=="forgotten"&&<>
                <small>{o.canReuseForFutureTasks?"你允许以后参考；仍须核对当前条件":"不用于后续任务"}</small>
                <button disabled={busy} onClick={()=>{setEditing(o);setCorrection(o.notes);setReuse(false);setAllowCloud(false);}}>纠正这条经验</button>
                <button disabled={busy||!o.canReuseForFutureTasks} onClick={()=>amend(o,"revoke_reuse")}>不再复用</button>
                <button disabled={busy} onClick={()=>{if(window.confirm("忘记这条经验？之后不再用于回答，正文将从当前记录删除。"))void amend(o,"forget");}}>忘记这条经验</button>
                {editing?.outcomeId===o.outcomeId&&<div>
                  <label>纠正后的实际经历<input value={correction} onChange={e=>setCorrection(e.target.value)} maxLength={1200}/></label>
                  <label><input type="checkbox" checked={reuse} onChange={e=>setReuse(e.target.checked)}/>允许以后参考这条更正</label>
                  {reuse&&<label><input type="checkbox" checked={allowCloud} onChange={e=>setAllowCloud(e.target.checked)}/>允许云端 AI 使用这条更正</label>}
                  <button disabled={busy||!correction.trim()} onClick={()=>amend(o,"correct")}>确认更正经验</button>
                  <button onClick={()=>setEditing(null)}>取消更正</button>
                </div>}
              </>}
            </div>
          ))}
        </section>
      )}
      <div className="life-task-list">
        {tasks.slice(0, 8).map((t) => (
          <button
            key={t.taskId}
            onClick={() => open(t).catch((e) => setError(e.message))}
          >
            {t.goal}
          </button>
        ))}
      </div>
      <label>
        留下一件要继续做的事
        <input
          aria-label="新任务目标"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="例如：帮家人连好耳机，再安排周末拍摄"
          maxLength={2000}
        />
      </label>
      <details>
        <summary>选择这次相关的物品（可不选）</summary>
        {items.map((i) => (
          <label key={i.id}>
            <input
              type="checkbox"
              checked={chosen.includes(i.id)}
              onChange={(e) =>
                setChosen((s) =>
                  e.target.checked
                    ? [...s, i.id]
                    : s.filter((id) => id !== i.id),
                )
              }
            />
            {i.name} {i.synthetic ? "· 模拟持有" : ""}
          </label>
        ))}
      </details>
      <button disabled={busy || !goal.trim()} onClick={create}>
        开始并保留进度
      </button>
    </details>
  );
}
