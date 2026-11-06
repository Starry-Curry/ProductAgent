import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as CanvasPointerEvent,
} from "react";
import { Modal } from "antd";
import { Camera, Video, Pause, Play } from "lucide-react";
import { upload, type TaskBoard, type TaskEntry } from "../api";
import {
  AutoCameraSession,
  type CameraState,
  type Grounding,
} from "./camera/autoSession";
import type { Box } from "./camera/opticalFlow";

export default function CameraGuidance({
  board,
  entry,
}: {
  board: TaskBoard;
  entry: TaskEntry;
}) {
  const [open, setOpen] = useState(false),
    [source, setSource] = useState(false),
    [phase, setPhase] = useState<CameraState>("stopped");
  const [status, setStatus] = useState("打开后会自动寻找和跟随当前部位。"),
    [stats, setStats] = useState(""),
    [manual, setManual] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    file = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | undefined>(undefined),
    session = useRef<AutoCameraSession | undefined>(undefined),
    objectUrl = useRef("");
  const generation = useRef(0),
    drag = useRef<[number, number] | null>(null),
    local = useRef(false);
  const frame = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const controller = useRef<AbortController | undefined>(undefined);
  const demoId = (
    board.task.plan.guidance as { demo_video_id?: string } | undefined
  )?.demo_video_id;
  const videoNature = (
    board.task.plan.guidance as { demo_video_nature?: string } | undefined
  )?.demo_video_nature;
  function capture() {
    const v = video.current,
      c = frame.current;
    if (!v?.videoWidth) return null;
    const scale = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return c;
  }
  function draw(box: Box | null, label = "", quad?: number[][]) {
    const c = canvas.current;
    if (!c) return;
    const f = frame.current;
    c.width = f.width;
    c.height = f.height;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    if (!box) return;
    g.strokeStyle = "#78bac5";
    g.fillStyle = "#315d67";
    g.lineWidth = 2;
    g.font = "13px sans-serif";
    if (quad) {
      g.beginPath();
      quad.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.stroke();
    } else g.strokeRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    g.fillText(label, Math.max(3, box[0]), Math.max(15, box[1] - 5));
  }
  function stopTracking() {
    generation.current++;
    session.current?.stop();
    session.current = undefined;
    controller.current?.abort();
    setPhase("stopped");
    draw(null);
  }
  function stopSource() {
    stopTracking();
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = undefined;
    if (video.current) {
      video.current.pause();
      video.current.srcObject = null;
      video.current.removeAttribute("src");
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = "";
    setSource(false);
    setManual(false);
  }
  useEffect(
    () => () => stopSource(),
    [board.task.id, board.task.version, entry.id],
  );
  function automate(seek = true) {
    stopTracking();
    setManual(false);
    const token = generation.current;
    setStats("");
    session.current = new AutoCameraSession({
      read: capture,
      overlay: draw,
      schedule: (callback) => {
        const v = video.current!;
        if (v.requestVideoFrameCallback && !v.paused) {
          const id = v.requestVideoFrameCallback(callback);
          return () => v.cancelVideoFrameCallback(id);
        }
        const id = window.setTimeout(callback, 70);
        return () => clearTimeout(id);
      },
      status: (value, text) => {
        if (token === generation.current) {
          setPhase(value);
          setStatus(text);
        }
      },
      metrics: (value) => {
        if (token === generation.current)
          setStats(
            `${value.engine || "兼容光流"} · 本地 ${value.ms.toFixed(1)} ms/帧 · 云端已定位 ${value.cloudCalls} 次`,
          );
      },
      afterAttempt: () => {
        if (token === generation.current && local.current)
          void video.current?.play().catch(() => {});
      },
      ground: async (snapshot) => {
        const blob = await new Promise<Blob>((resolve, reject) =>
          snapshot.toBlob(
            (value) =>
              value ? resolve(value) : reject(new Error("无法读取画面")),
            "image/jpeg",
            0.9,
          ),
        );
        if (token !== generation.current) throw new Error("closed");
        const photo = await upload(
          new File([blob], "camera-frame.jpg", { type: "image/jpeg" }),
        );
        if (token !== generation.current) throw new Error("closed");
        controller.current = new AbortController();
        const response = await fetch(`/api/tasks/${board.task.id}/grounding`, {
          method: "POST",
          credentials: "same-origin",
          signal: controller.current.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expected_version: board.task.version,
            step_id: entry.id,
            frame_id: photo.id,
          }),
        });
        const answer = await response.json();
        if (!response.ok) throw new Error(answer.detail || "定位暂不可用");
        return answer as Grounding;
      },
    });
    session.current.start(seek);
  }
  async function camera() {
    stopSource();
    local.current = false;
    const token = generation.current;
    setStatus("正在打开相机…");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 } },
        audio: false,
      });
      if (token !== generation.current || !video.current) {
        s.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = s;
      video.current.srcObject = s;
      await video.current.play();
      if (token !== generation.current) return;
      setSource(true);
      automate();
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = undefined;
      setStatus("相机未打开。请允许权限，或选择视频体验自动跟随。");
    }
  }
  async function localVideo(chosen?: File) {
    if (!chosen) return;
    stopSource();
    local.current = true;
    const token = generation.current,
      v = video.current;
    if (!v) return;
    objectUrl.current = URL.createObjectURL(chosen);
    setStatus("正在读取视频…");
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("视频暂时无法读取，请换个格式。")),
          12000,
        );
        v.onloadeddata = () => {
          clearTimeout(timeout);
          resolve();
        };
        v.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("视频无法播放"));
        };
        v.src = objectUrl.current;
        v.load();
      });
      if (token !== generation.current) return;
      v.pause();
      setSource(true);
      automate();
    } catch (error) {
      if (token === generation.current) setStatus((error as Error).message);
    }
  }
  async function demo() {
    if (!demoId) return;
    try {
      const response = await fetch("/api/assets/" + demoId, {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("片段暂不可用");
      const blob = await response.blob();
      await localVideo(new File([blob], "demo.webm", { type: blob.type }));
    } catch (error) {
      setStatus((error as Error).message);
    }
  }
  function point(
    event: CanvasPointerEvent<HTMLCanvasElement>,
  ): [number, number] {
    const c = event.currentTarget,
      b = c.getBoundingClientRect(),
      scale = Math.min(b.width / c.width, b.height / c.height);
    return [
      Math.max(
        0,
        Math.min(
          c.width,
          (event.clientX - b.left - (b.width - c.width * scale) / 2) / scale,
        ),
      ),
      Math.max(
        0,
        Math.min(
          c.height,
          (event.clientY - b.top - (b.height - c.height * scale) / 2) / scale,
        ),
      ),
    ];
  }
  function manualStart() {
    stopTracking();
    video.current?.pause();
    capture();
    draw(null);
    setManual(true);
    setStatus("圈住要看的部位，松开后自动跟随。");
  }
  async function manualEnd(event: CanvasPointerEvent<HTMLCanvasElement>) {
    const a = drag.current,
      b = point(event);
    drag.current = null;
    if (!manual || !a) return;
    const box: Box = [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
    ];
    if (box[2] - box[0] < 10 || box[3] - box[1] < 10) {
      setStatus("框有点小，请把部位和附近边缘一起圈住。");
      return;
    }
    // Start the same session with the explicit user ROI; this is a correction,
    // never reported as automatic cloud recognition.
    automate(false);
    setManual(false);
    try {
      await session.current?.manual(frame.current, box);
    } catch {
      setStatus("这个位置纹理不足，请靠近一些再试。");
    }
  }
  return (
    <>
      <button
        className="soft-button"
        disabled={board.access !== "owner"}
        onClick={() => setOpen(true)}
      >
        <Camera size={18} />
        相机辅助
      </button>
      <Modal
        open={open}
        title="和阿圆一起看看"
        width={800}
        footer={null}
        destroyOnHidden
        afterOpenChange={(visible) => {
          if (visible) void camera();
        }}
        onCancel={() => {
          stopSource();
          setOpen(false);
        }}
      >
        <p>{entry.guidance?.target_label || entry.title}</p>
        <div className="camera-preview" data-tracking-state={phase}>
          <video
            ref={video}
            muted
            playsInline
            onEnded={() => {
              stopTracking();
              setStatus("视频已结束，可换一个片段继续。");
            }}
          />
          <canvas
            ref={canvas}
            style={{
              pointerEvents: manual ? "auto" : "none",
              touchAction: manual ? "none" : "auto",
            }}
            onPointerDown={(event) => {
              if (manual) {
                drag.current = point(event);
                event.currentTarget.setPointerCapture(event.pointerId);
              }
            }}
            onPointerMove={(event) => {
              if (manual && drag.current) {
                const a = drag.current,
                  b = point(event);
                draw(
                  [
                    Math.min(a[0], b[0]),
                    Math.min(a[1], b[1]),
                    Math.max(a[0], b[0]),
                    Math.max(a[1], b[1]),
                  ],
                  "你框选的位置",
                );
              }
            }}
            onPointerUp={(event) => void manualEnd(event)}
            onPointerCancel={() => {
              drag.current = null;
            }}
          />
        </div>
        <p role="status">{status}</p>
        <div className="camera-controls">
          <button className="soft-button" onClick={() => void camera()}>
            <Camera size={17} />
            相机
          </button>
          <button className="soft-button" onClick={() => file.current?.click()}>
            <Video size={17} />
            换视频
          </button>
          {demoId && (
            <button className="soft-button" onClick={() => void demo()}>
              试看片段
            </button>
          )}
          {source && (
            <button
              className="quiet-button"
              onClick={() => {
                if (phase === "stopped") {
                  void video.current?.play();
                  automate();
                } else {
                  stopTracking();
                  video.current?.pause();
                  setStatus("已暂停。");
                }
              }}
            >
              {phase === "stopped" ? <Play size={17} /> : <Pause size={17} />}{" "}
              {phase === "stopped" ? "继续" : "暂停"}
            </button>
          )}
        </div>
        <details className="form-note">
          <summary>位置不准确时</summary>
          <p>多件相似物品时先靠近要看的那一处。仍有偏差可圈选校准。</p>
          <button
            className="quiet-button"
            disabled={!source}
            onClick={manualStart}
          >
            手动校准
          </button>
          {stats && <p>{stats}</p>}
        </details>
        <small className="muted">
          会间歇发送一帧定位，其余在本地跟随；跟丢后自动重找。标注只提示位置，不判断操作已经完成。
        </small>
        {demoId && (
          <p className="form-note">
            {videoNature ||
              "示例片段使用真实商品图片与合成运动，不能当作实物操作验收。"}
          </p>
        )}
        <input
          ref={file}
          type="file"
          accept="video/*"
          hidden
          onChange={(event) => {
            const value = event.target.files?.[0];
            event.target.value = "";
            void localVideo(value);
          }}
        />
      </Modal>
    </>
  );
}
