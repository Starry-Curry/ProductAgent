import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Modal } from "antd";
import { Box, Play, RotateCcw } from "lucide-react";
import { request, type TaskBoard, type TaskEntry } from "../api";
import type { Plan, Vec3, PartMaterial, Pose } from "../vendor/bygga/lib/types";
import type { GeneratedMesh } from "./GeneratedModel";
const GeneratedModel = lazy(() => import("./GeneratedModel"));

type Scene = {
  title: string;
  parts: {
    id: string;
    name: string;
    shape: "box" | "cyl" | "sphere" | "arc" | "cone";
    arc_angle?: number;
    radius_ratio?: number;
    size: Vec3;
    pos: Vec3;
    rot: Vec3;
    material: PartMaterial;
    color?: string;
    face?: Pose | null;
    attach_to?: string | null;
  }[];
  focus_ids: string[];
  view_ids?: string[];
  action?: string;
  movement: Vec3;
  part_movements?: Record<string, Vec3>;
  turns: number;
  explanation: string;
  uncertainty: string;
};
type Saved = {
  schema: "schematic/1";
  scene: Scene;
  nature: string;
  step_signature: string;
  photo_ids?: string[];
  mesh?: GeneratedMesh;
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
function asPlan(scene: Scene, labels?: Record<string, string>): Plan {
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
    parts: scene.parts.map((part, index) => ({
      ...part,
      label: labels?.[part.id] || String(index + 1),
      qty: 1,
    })),
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
          from:
            scene.part_movements?.[part.id] ??
            ((
              scene.action === "press"
                ? part.id === scene.focus_ids[0] || part.id === "action_pointer"
                : scene.focus_ids.includes(part.id)
            )
              ? scene.movement
              : [0, 0, 0]),
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
  photoIds = [],
  onConfirm,
}: {
  board: TaskBoard;
  entry: TaskEntry;
  update: (next: TaskBoard) => void;
  photoIds?: string[];
  onConfirm?: () => Promise<void>;
}) {
  const host = useRef<HTMLDivElement>(null),
    stage = useRef<import("../vendor/bygga/engine/stage").Stage | null>(null);
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(""),
    [open, setOpen] = useState(false),
    [ready, setReady] = useState(false);
  const [detailView, setDetailView] = useState(false);
  const candidate = (
    board.task.plan.visualizations as Record<string, Saved> | undefined
  )?.[entry.id];
  const saved =
    candidate?.nature !== "reviewed_schematic" &&
    photoIds.length &&
    photoIds.slice(-2).join(",") !== (candidate?.photo_ids || []).join(",")
      ? undefined
      : candidate;
  useEffect(() => {
    let cancelled = false;
    if (saved && !saved.mesh && host.current && ready)
      void import("../vendor/bygga/engine/stage").then(({ Stage }) => {
        if (cancelled || !host.current) return;
        try {
          const view = new Stage(host.current, {
            labels: true,
            interactive: true,
            loop: false,
            callout: false,
            margins: { t: -48, b: -32, l: 0, r: 0 },
            labelIds:
              saved.nature === "reviewed_schematic"
                ? saved.scene.focus_ids.filter((id) => id !== "action_pointer")
                : undefined,
          });
          const visible =
            saved.nature === "reviewed_schematic" &&
            detailView &&
            saved.scene.view_ids?.length
              ? {
                  ...saved.scene,
                  parts: saved.scene.parts.filter((part) =>
                    saved.scene.view_ids!.includes(part.id),
                  ),
                }
              : saved.scene;
          view.setPlan(
            asPlan(
              visible,
              Object.fromEntries(
                saved.scene.parts.map((part, index) => [
                  part.id,
                  String(index + 1),
                ]),
              ),
            ),
          );
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
  }, [saved, ready, detailView]);
  async function generate(localOnly = false) {
    setBusy(true);
    setFailure("");
    try {
      update(
        await request<TaskBoard>(`/tasks/${board.task.id}/diagram`, "POST", {
          expected_version: board.task.version,
          step_id: entry.id,
          photo_ids: photoIds.slice(-2),
          use_model: true,
          local_only: localOnly,
        }),
      );
    } catch (error) {
      setFailure((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="soft-button"
        disabled={board.access !== "owner"}
        onClick={() => {
          setOpen(true);
          if ((!saved || (!saved.mesh && saved.nature !== "reviewed_schematic")) && !busy) void generate();
        }}
      >
        <Box size={18} />
        3D 图解
      </button>
      <Modal
        open={open}
        title={entry.title + " · 3D 图解"}
        width={800}
        footer={
          onConfirm ? (
            <button
              className="primary-button"
              onClick={() => {
                setReady(false);
                setOpen(false);
                void onConfirm();
              }}
            >
              我完成了这一步，继续
            </button>
          ) : null
        }
        destroyOnHidden
        afterOpenChange={setReady}
        onCancel={() => {
          setReady(false);
          setOpen(false);
        }}
      >
        <section className="teaching-diagram">
          <div className="section-title">
            <h4>看看这一步怎么做</h4>
            <button
              className="quiet-button"
              disabled={busy || board.access !== "owner" || saved?.nature === "reviewed_schematic"}
              onClick={() => void generate()}
            >
              {busy
                ? "正在整理图解…"
                : saved?.nature === "reviewed_schematic"
                  ? "本步资源已准备"
                  : saved
                    ? "重新生成"
                    : "重试"}
            </button>
            {saved?.mesh && !saved.mesh.fallback && <button className="quiet-button" disabled={busy || board.access !== "owner"} onClick={() => void generate(true)}>改用本地模型</button>}
          </div>
          {saved && (
            <>
              {saved.mesh && ready ? <Suspense fallback={<p>正在打开外观模型…</p>}><GeneratedModel mesh={saved.mesh} board={board} entry={entry} photoIds={saved.photo_ids || []} /></Suspense> : !saved.mesh ? <><div
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
                  onClick={() => {
                    if (
                      saved.nature === "reviewed_schematic" &&
                      saved.scene.view_ids?.length
                    ) {
                      setDetailView(!detailView);
                      return;
                    }
                    stage.current?.setMode({
                      kind: "assembled",
                      view: { az: 0.7, el: 0.4 },
                    });
                  }}
                >
                  <RotateCcw size={16} />
                  {saved.nature === "reviewed_schematic" && !detailView
                    ? "看操作处"
                    : "看全貌"}
                </button>
              </div>
              <div className="diagram-legend" aria-label="图解部件">
                {saved.scene.parts.map((part, index) =>
                  part.id === "action_pointer" ||
                  (saved.nature === "reviewed_schematic" &&
                    !saved.scene.focus_ids.includes(part.id)) ? null : (
                    <button
                      key={part.id}
                      className="quiet-button"
                      onClick={() => stage.current?.setHighlight([part.id])}
                    >
                      <span>{index + 1}</span>
                      {part.name}
                    </button>
                  ),
                )}
              </div>
              </> : null}
              <p>{saved.scene.explanation}</p>
              <small className="muted">
                {saved.nature === "reviewed_schematic"
                  ? "按实拍与手册校核的示意图"
                  : "AI 示意图"}
                {contactDetail(saved.scene).cropped ? " · 连接处局部画面" : ""}{" "}
                · 拖动可旋转，请按实物和原图核对。
              </small>
              <details>
                <summary>这张图还有哪些不确定</summary>
                <p>{saved.scene.uncertainty}</p>
              </details>
            </>
          )}
          {!saved && (
            <p className="empty-note">
              {busy
                ? "正在结合这件物品和当前步骤生成示意图…"
                : "可结合物品照片与当前步骤生成简图。"}
            </p>
          )}
          {failure && <p role="alert">{failure}</p>}
        </section>
      </Modal>
    </>
  );
}
