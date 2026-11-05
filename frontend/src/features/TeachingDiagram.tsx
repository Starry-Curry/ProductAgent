import { useEffect, useRef, useState } from "react";
import { App as AntApp } from "antd";
import { Box, Play, RotateCcw } from "lucide-react";
import { request, type TaskBoard, type TaskEntry } from "../api";
import type { Plan, Vec3, PartMaterial, Pose } from "../vendor/bygga/lib/types";

type Scene = {
  title: string;
  parts: {
    id: string;
    name: string;
    shape: "box" | "cyl";
    size: Vec3;
    pos: Vec3;
    rot: Vec3;
    material: PartMaterial;
    face?: Pose | null;
    attach_to?: string | null;
  }[];
  focus_ids: string[];
  movement: Vec3;
  turns: number;
  explanation: string;
  uncertainty: string;
};
type Saved = {
  schema: "schematic/1";
  scene: Scene;
  nature: string;
  step_signature: string;
};

function contactDetail(scene: Scene) {
  const parts = scene.parts.map((part) => ({
    ...part,
    size: [...part.size] as Vec3,
    pos: [...part.pos] as Vec3,
  }));
  const target = parts.find((part) => scene.focus_ids.includes(part.id));
  const parent = parts.find((part) => part.id === target?.attach_to);
  let cropped = false;
  if (parts.length === 2 && target?.face && parent) {
    const axis = "xyz".indexOf(target.face[1]),
      sign = target.face[0] === "+" ? 1 : -1;
    const length = Math.max(...target.size) * 4;
    if (parent.size[axis] > length) {
      const face = parent.pos[axis] + (sign * parent.size[axis]) / 2;
      parent.size[axis] = length;
      parent.pos[axis] = face - (sign * length) / 2;
      parent.name += "（局部）";
      cropped = true;
    }
  }
  return { parts, cropped };
}
function asPlan(scene: Scene): Plan {
  scene = { ...scene, parts: contactDetail(scene).parts };
  const face =
    scene.parts.find((part) => scene.focus_ids.includes(part.id))?.face || "+y";
  return {
    spec: {
      name: scene.title,
      variant: "示意",
      category: "教学",
      archetype: "custom",
      size: { w: 40, h: 40, d: 40 },
      minutes: 1,
      people: 1,
      difficulty: 1,
      source: "ai",
    },
    parts: scene.parts.map((part) => ({ ...part, label: part.name, qty: 1 })),
    hardware: [],
    tools: [],
    items: scene.parts.map((part) => ({
      key: part.id,
      kind: "part",
      ref: part.id,
      final: { pos: part.pos, rot: part.rot },
      holes: [],
      states: [
        {
          step: 0,
          scene: "teaching",
          pos: part.pos,
          rot: part.rot,
          delay: 0,
          from: scene.focus_ids.includes(part.id) ? scene.movement : [0, 0, 0],
          spin: scene.focus_ids.includes(part.id) ? scene.turns : 0,
        },
      ],
    })),
    steps: [
      {
        n: 1,
        title: scene.title,
        tools: [],
        people: 1,
        scene: "teaching",
        pose: face,
        warnings: [],
        kind: "general",
        minutes: 1,
      },
    ],
  };
}

export default function TeachingDiagram({
  board,
  entry,
  update,
}: {
  board: TaskBoard;
  entry: TaskEntry;
  update: (next: TaskBoard) => void;
}) {
  const { message } = AntApp.useApp();
  const host = useRef<HTMLDivElement>(null),
    stage = useRef<import("../vendor/bygga/engine/stage").Stage | null>(null);
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
  const saved = (
    board.task.plan.visualizations as Record<string, Saved> | undefined
  )?.[entry.id];
  useEffect(() => {
    let cancelled = false;
    if (saved && host.current)
      void import("../vendor/bygga/engine/stage").then(({ Stage }) => {
        if (cancelled || !host.current) return;
        try {
          const view = new Stage(host.current, {
            labels: true,
            interactive: true,
            loop: false,
            callout: false,
          });
          view.setPlan(asPlan(saved.scene));
          view.setMode({ kind: "step", index: 0 });
          view.setHighlight(saved.scene.focus_ids);
          stage.current = view;
        } catch (error) {
          setFailure("当前浏览器无法启动 3D 图解，请继续使用上方文字步骤。");
        }
      });
    return () => {
      cancelled = true;
      stage.current?.dispose();
      stage.current = null;
    };
  }, [saved]);
  async function generate() {
    setBusy(true);
    setFailure("");
    try {
      update(
        await request<TaskBoard>(`/tasks/${board.task.id}/diagram`, "POST", {
          expected_version: board.task.version,
          step_id: entry.id,
        }),
      );
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="teaching-diagram">
      <div className="section-title">
        <h4>
          <Box size={19} /> 看看这一步怎么做
        </h4>
        <button
          className="quiet-button"
          disabled={busy || board.access !== "owner"}
          onClick={() => void generate()}
        >
          {busy ? "正在整理图解…" : saved ? "重新生成" : "生成 3D 图解"}
        </button>
      </div>
      {saved && (
        <>
          <div
            ref={host}
            className="teaching-stage"
            role="img"
            aria-label={saved.scene.title}
          />
          <div className="diagram-controls">
            <button
              className="soft-button"
              onClick={() => {
                stage.current?.setMode({ kind: "step", index: 0 });
                stage.current?.replay();
              }}
            >
              <Play size={16} />
              重看动作
            </button>
            <button
              className="quiet-button"
              onClick={() =>
                stage.current?.setMode({
                  kind: "assembled",
                  view: { az: 0.7, el: 0.4 },
                })
              }
            >
              <RotateCcw size={16} />
              看全貌
            </button>
          </div>
          <p>{saved.scene.explanation}</p>
          <small className="muted">
            AI 示意图
            {contactDetail(saved.scene).cropped ? " · 连接处局部画面" : ""} ·
            拖动可旋转，请按实物和原图核对。
          </small>
          <details>
            <summary>这张图还有哪些不确定</summary>
            <p>{saved.scene.uncertainty}</p>
          </details>
        </>
      )}
      {!saved && (
        <p className="empty-note">
          按需生成当前步骤的简化示意，突出要留意的部分。
        </p>
      )}
      {failure && <p role="alert">{failure}</p>}
    </section>
  );
}
