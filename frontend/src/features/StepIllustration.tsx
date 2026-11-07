import { useEffect, useId, useState } from "react";
import { request } from "../api";
import type { TaskBoard, TaskEntry } from "../api";
import "../step-illustration.css";

type Picture = {
  image_id: string;
  point?: [number, number];
  box?: [number, number, number, number];
  label: string;
  basis: string;
  manual_page_id?: string;
  manual_pdf_page?: number;
  evidence_kind?: string;
};
const loading = new Map<string, Promise<TaskBoard>>();
/** Same current step as text, diagram and camera; merely viewing never confirms it. */
export default function StepIllustration({
  board,
  entry,
  update,
  enabled = true,
  photos = [],
}: {
  board: TaskBoard;
  entry: TaskEntry;
  update: (board: TaskBoard) => void;
  enabled?: boolean;
  photos?: string[];
}) {
  const [manual, setManual] = useState(false);
  const marker = useId().replaceAll(":", "");
  const picture = (
    board.task.plan.guidance as { pictures?: Record<string, Picture> }
  )?.pictures?.[entry.id];
  useEffect(() => {
    if (picture || !enabled || board.access !== "owner") return;
    let cancelled = false;
    const key = board.task.id + ":" + board.task.version + ":" + entry.id;
    if (!loading.has(key))
      loading.set(
        key,
        request<TaskBoard>(`/tasks/${board.task.id}/picture`, "POST", {
          expected_version: board.task.version,
          step_id: entry.id,
          photo_ids: photos.slice(-1),
        }),
      );
    void loading
      .get(key)!
      .then((next) => {
        if (!cancelled) update(next);
      })
      .catch(() => {})
      .finally(() => {
        setTimeout(() => loading.delete(key), 60000);
      });
    return () => {
      cancelled = true;
    };
  }, [board.task.id, board.task.version, entry.id, enabled, !!picture]);
  if (!picture) return null;
  const point =
    picture.point ||
    (picture.box
      ? [
          (picture.box[0] + picture.box[2]) / 2,
          (picture.box[1] + picture.box[3]) / 2,
        ]
      : null);
  const start = point
    ? [
        Math.min(890, Math.max(110, point[0] + (point[0] < 500 ? 190 : -190))),
        Math.max(65, point[1] - 240),
      ]
    : null;
  return (
    <figure
      className="step-illustration"
      aria-label={"实物位置指引：" + picture.label}
    >
      <div className="step-photo">
        <img
          src={"/api/assets/" + picture.image_id}
          alt={"用户实拍：" + picture.label}
        />
        {point && start && (
          <svg
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            role="img"
            aria-label={"箭头指向" + picture.label}
          >
            <defs>
              <marker
                id={marker}
                markerWidth="7"
                markerHeight="7"
                refX="5"
                refY="3"
                orient="auto"
              >
                <path
                  d="M0 0 L6 3 L0 6"
                  fill="none"
                  stroke="white"
                  strokeWidth="1.6"
                />
              </marker>
            </defs>
            <line
              x1={start[0]}
              y1={start[1]}
              x2={point[0]}
              y2={point[1]}
              stroke="#527e89"
              strokeWidth="17"
            />
            <line
              x1={start[0]}
              y1={start[1]}
              x2={point[0]}
              y2={point[1]}
              stroke="white"
              strokeWidth="7"
              markerEnd={"url(#" + marker + ")"}
            />
            <ellipse
              cx={point[0]}
              cy={point[1]}
              rx="43"
              ry="65"
              fill="none"
              stroke="#527e89"
              strokeWidth="8"
            />
          </svg>
        )}
      </div>
      <figcaption>
        <strong>{picture.label}</strong>
        <span>
          {picture.evidence_kind === "reviewed_photo_annotation"
            ? "实拍位置参考"
            : picture.manual_pdf_page
              ? "说明书页图 · 模型定位参考"
              : "实拍 · 模型定位参考"}
        </span>
        {picture.manual_page_id && (
          <button className="quiet-button" onClick={() => setManual(!manual)}>
            {manual ? "收起说明书" : "查看说明书本页"}
          </button>
        )}
      </figcaption>
      {manual && picture.manual_page_id && (
        <a
          href={"/api/assets/" + picture.manual_page_id}
          target="_blank"
          rel="noreferrer"
        >
          <img
            className="manual-page"
            src={"/api/assets/" + picture.manual_page_id}
            alt={"官方说明书 PDF 第 " + picture.manual_pdf_page + " 页截图"}
          />
        </a>
      )}
    </figure>
  );
}
