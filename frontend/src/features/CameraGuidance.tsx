import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as CanvasPointerEvent,
} from "react";
import { Modal } from "antd";
import { Camera, ScanLine, Video, Square } from "lucide-react";
import { request, upload, type TaskBoard, type TaskEntry } from "../api";
import { loadOpenCv, LocalTracker, type Box } from "./camera/opticalFlow";

type Grounding = {
  visible: boolean;
  bbox: Box | null;
  label: string;
  confidence: number;
  explanation: string;
  elapsed_seconds: number;
  model: string;
  candidates: Box[];
};
export default function CameraGuidance({
  board,
  entry,
}: {
  board: TaskBoard;
  entry: TaskEntry;
}) {
  const [anchor, setAnchor] = useState("auto");
  const [manual, setManual] = useState(false);
  const dragStart = useRef<[number, number] | null>(null);
  const [open, setOpen] = useState(false),
    [status, setStatus] = useState(
      "选择相机或本地视频，画面只在你点击定位时发送一帧。",
    ),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState(false),
    [result, setResult] = useState<Grounding>(),
    [stats, setStats] = useState(""),
    [activeLabel, setActiveLabel] = useState(""),
    [following, setFollowing] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    file = useRef<HTMLInputElement>(null),
    stream = useRef<MediaStream | undefined>(undefined),
    objectUrl = useRef(""),
    tracker = useRef<LocalTracker | undefined>(undefined),
    raf = useRef(0),
    generation = useRef(0),
    deadline = useRef(0);
  const frame = useRef<HTMLCanvasElement | null>(null);
  if (!frame.current) frame.current = document.createElement("canvas");
  const cancelLoop = useRef<() => void>(() => {});
  function clearOverlay() {
    const c = canvas.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
  }
  function nextFrame(loop: () => void) {
    const v = video.current;
    if (v?.requestVideoFrameCallback) {
      const id = v.requestVideoFrameCallback(loop);
      cancelLoop.current = () => v.cancelVideoFrameCallback(id);
    } else {
      const id = requestAnimationFrame(loop);
      cancelLoop.current = () => cancelAnimationFrame(id);
    }
  }
  function stop() {
    generation.current++;
    cancelLoop.current();
    tracker.current?.dispose();
    tracker.current = undefined;
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
    setResult(undefined);
    setBusy(false);
    setFollowing(false);
    setActiveLabel("");
    setManual(false);
    dragStart.current = null;
    clearOverlay();
  }
  useEffect(() => () => stop(), [board.task.id, board.task.version, entry.id]);
  function capture() {
    const v = video.current!,
      f = frame.current!,
      scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
    f.width = Math.round(v.videoWidth * scale);
    f.height = Math.round(v.videoHeight * scale);
    f.getContext("2d")!.drawImage(v, 0, 0, f.width, f.height);
    return f;
  }
  async function camera() {
    try {
      stop();
      const token = generation.current;
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
      setSource(true);
      setStatus("把当前要操作的位置放进画面，尽量保持不动。");
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = undefined;
      setSource(false);
      setStatus("相机没有打开。请允许相机权限，或使用本地视频。");
    }
  }
  async function localVideo(file?: File) {
    if (!file) return;
    stop();
    const token = generation.current,
      v = video.current;
    if (!v) return;
    const url = URL.createObjectURL(file);
    objectUrl.current = url;
    setStatus("正在读取视频…");
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("这个视频暂时无法播放，请换个格式。")),
          12000,
        );
        v.onloadeddata = () => {
          clearTimeout(timer);
          resolve();
        };
        v.onerror = () => {
          if (token === generation.current) {
            clearTimeout(timer);
            reject(new Error("这个视频暂时无法播放，请换个格式。"));
          }
        };
        v.preload = "auto";
        v.src = url;
        v.load();
      });
      if (token !== generation.current) return;
      v.pause();
      setSource(true);
      setStatus("视频停在这一帧。点击定位后，可播放并在本地跟随。");
    } catch (error) {
      if (token === generation.current) setStatus((error as Error).message);
    }
  }
  const demoId = (
    board.task.plan.guidance as { demo_video_id?: string } | undefined
  )?.demo_video_id;
  async function demo() {
    if (!demoId) return;
    try {
      const response = await fetch("/api/assets/" + demoId, {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("演示片段暂时无法读取");
      const blob = await response.blob();
      await localVideo(
        new File([blob], "controlled-demo.webm", { type: blob.type }),
      );
    } catch (error) {
      setStatus((error as Error).message);
    }
  }
  function draw(box: Box, label: string, quad?: number[][]) {
    const c = canvas.current!,
      f = frame.current!;
    c.width = f.width;
    c.height = f.height;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    g.strokeStyle = "#78bac5";
    g.lineWidth = 3;
    if (quad) {
      g.beginPath();
      quad.forEach(([x, y], index) =>
        index ? g.lineTo(x, y) : g.moveTo(x, y),
      );
      g.closePath();
      g.stroke();
    } else g.strokeRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    g.fillStyle = "#315d67";
    g.font = "15px sans-serif";
    g.fillText(label, Math.max(4, box[0]), Math.max(18, box[1] - 8));
  }
  function pixels(box: Box) {
    const f = frame.current!;
    return box.map((n, i) => (n / 999) * (i % 2 ? f.height : f.width)) as Box;
  }
  function startManual() {
    if (!source || busy || following || !video.current?.videoWidth) return;
    generation.current++;
    cancelLoop.current();
    video.current.pause();
    tracker.current?.dispose();
    tracker.current = undefined;
    const f = capture(),
      c = canvas.current!;
    c.width = f.width;
    c.height = f.height;
    clearOverlay();
    setResult(undefined);
    setManual(true);
    setStatus("在画面里拖出一个框，圈住你要看的部位。");
  }
  function point(
    event: CanvasPointerEvent<HTMLCanvasElement>,
    clamp = false,
  ): [number, number] | null {
    const c = event.currentTarget,
      b = c.getBoundingClientRect(),
      scale = Math.min(b.width / c.width, b.height / c.height),
      x = (event.clientX - b.left - (b.width - c.width * scale) / 2) / scale,
      y = (event.clientY - b.top - (b.height - c.height * scale) / 2) / scale;
    if (!clamp && (x < 0 || y < 0 || x > c.width || y > c.height)) return null;
    return [
      Math.max(0, Math.min(c.width, x)),
      Math.max(0, Math.min(c.height, y)),
    ];
  }
  function down(event: CanvasPointerEvent<HTMLCanvasElement>) {
    if (!manual) return;
    const p = point(event);
    if (!p) return;
    dragStart.current = p;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: CanvasPointerEvent<HTMLCanvasElement>) {
    const from = dragStart.current,
      to = point(event, true);
    if (!manual || !from || !to) return;
    draw(
      [
        Math.min(from[0], to[0]),
        Math.min(from[1], to[1]),
        Math.max(from[0], to[0]),
        Math.max(from[1], to[1]),
      ],
      "你框选的位置",
    );
  }
  async function up(event: CanvasPointerEvent<HTMLCanvasElement>) {
    const from = dragStart.current,
      to = point(event, true);
    dragStart.current = null;
    if (!manual || !from || !to) return;
    const box: Box = [
      Math.min(from[0], to[0]),
      Math.min(from[1], to[1]),
      Math.max(from[0], to[0]),
      Math.max(from[1], to[1]),
    ];
    if (box[2] - box[0] < 12 || box[3] - box[1] < 12) {
      setStatus("框有点小，靠近一点或把周围边缘也圈进去。");
      return;
    }
    const token = generation.current;
    try {
      const { cv } = await loadOpenCv();
      if (token !== generation.current || !canvas.current) return;
      tracker.current = new LocalTracker(cv, frame.current!, box);
      draw(box, "你框选的位置");
      setActiveLabel("你框选的位置");
      setManual(false);
      setStatus("已按你的框选校准位置，核对后可开始跟随。");
    } catch (error) {
      if (token === generation.current) setStatus((error as Error).message);
    }
  }
  function drawChoices(boxes: Box[]) {
    const c = canvas.current!,
      f = frame.current!;
    c.width = f.width;
    c.height = f.height;
    const g = c.getContext("2d")!;
    g.strokeStyle = "#b78345";
    g.fillStyle = "#815929";
    g.font = "18px sans-serif";
    g.lineWidth = 2;
    boxes.forEach((value, index) => {
      const b = pixels(value);
      g.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
      g.fillText(String(index + 1), b[0] + 4, b[1] + 20);
    });
  }
  async function choose(index: number) {
    if (!result || result.confidence < 0.65 || following || busy) return;
    const token = generation.current;
    try {
      const { cv } = await loadOpenCv();
      if (token !== generation.current || !canvas.current) return;
      const box = pixels(result.candidates[index]);
      tracker.current?.dispose();
      tracker.current = new LocalTracker(cv, frame.current!, box);
      const label = `位置${index + 1}（你选择）`;
      draw(box, label);
      setActiveLabel(label);
      setStatus(`已选择位置${index + 1}，核对后可开始跟随。`);
    } catch (error) {
      if (token === generation.current) setStatus((error as Error).message);
    }
  }
  async function locate() {
    if (busy || !video.current?.videoWidth) return;
    cancelLoop.current();
    tracker.current?.dispose();
    tracker.current = undefined;
    setResult(undefined);
    setFollowing(false);
    setActiveLabel("");
    setStats("");
    setBusy(true);
    const token = ++generation.current;
    video.current.pause();
    const f = capture();
    clearOverlay();
    setStatus("正在定位这一帧。相机画面先保持不动…");
    try {
      const blob = await new Promise<Blob>((resolve) =>
        f.toBlob((value) => resolve(value!), "image/jpeg", 0.88),
      );
      const photo = await upload(
        new File([blob], "teaching-frame.jpg", { type: "image/jpeg" }),
      );
      const [{ cv }, answer] = await Promise.all([
        loadOpenCv(),
        request<Grounding>(`/tasks/${board.task.id}/grounding`, "POST", {
          expected_version: board.task.version,
          step_id: entry.id,
          frame_id: photo.id,
          anchor,
        }),
      ]);
      if (token !== generation.current) return;
      setResult(answer);
      if (!answer.visible || !answer.bbox) {
        if (answer.candidates.length > 1 && answer.confidence >= 0.65)
          drawChoices(answer.candidates);
        setStatus(
          answer.explanation || "当前画面没有足够可靠的目标，请换个角度。",
        );
        return;
      }
      const box = pixels(answer.bbox);
      draw(box, answer.label);
      tracker.current = new LocalTracker(cv, f, box);
      setActiveLabel(answer.label);
      setStatus(
        `定位用了 ${answer.elapsed_seconds.toFixed(1)} 秒。请核对框的位置，再开始本地跟随。`,
      );
    } catch (error) {
      if (token === generation.current) setStatus((error as Error).message);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  async function follow() {
    if (!tracker.current) return;
    try {
      await video.current!.play();
    } catch {
      setStatus("视频暂时无法继续播放，请重新选择片段。");
      return;
    }
    setFollowing(true);
    deadline.current = performance.now() + 12000;
    let frames = 0;
    const loop = () => {
      if (!tracker.current || !video.current || video.current.paused) return;
      try {
        if (performance.now() > deadline.current)
          throw new Error("本次跟随已到 12 秒，请重新核对目标后定位。");
        const next = tracker.current.update(capture());
        draw(next.box, activeLabel || "当前目标", next.quad);
        if (++frames % 15 === 0)
          setStats(
            `本地处理 ${next.ms.toFixed(1)} ms / 帧 · 特征保留 ${(next.retained * 100).toFixed(0)}%`,
          );
        nextFrame(loop);
      } catch (error) {
        clearOverlay();
        tracker.current?.dispose();
        tracker.current = undefined;
        video.current.pause();
        setResult(undefined);
        setFollowing(false);
        setStatus((error as Error).message);
      }
    };
    setStatus("正在本地跟随。画面中的框只提示位置，不能判断操作是否成功。");
    nextFrame(loop);
  }
  return (
    <>
      <button
        className="soft-button"
        disabled={board.access !== "owner"}
        onClick={() => setOpen(true)}
      >
        <ScanLine size={18} /> 用相机找这一步的位置
      </button>
      <Modal
        open={open}
        title="和阿圆一起看看"
        width={800}
        footer={null}
        destroyOnHidden
        onCancel={() => {
          stop();
          setOpen(false);
        }}
      >
        <p>{entry.guidance?.instruction}</p>
        <div className="camera-preview">
          <video
            ref={video}
            muted
            playsInline
            onEnded={() => {
              cancelLoop.current();
              tracker.current?.dispose();
              tracker.current = undefined;
              setResult(undefined);
              setFollowing(false);
              clearOverlay();
              setStatus("视频已结束，重新定位可再试。");
            }}
          />
          <canvas
            ref={canvas}
            style={{
              pointerEvents: manual ? "auto" : "none",
              touchAction: manual ? "none" : "auto",
              cursor: manual ? "crosshair" : "default",
            }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={(event) => void up(event)}
            onPointerCancel={() => {
              dragStart.current = null;
            }}
          />
        </div>
        <p role="status">{status}</p>
        {stats && (
          <details className="form-note">
            <summary>查看跟随状态</summary>
            {stats}
          </details>
        )}
        <details className="form-note">
          <summary>位置不对？给一个方位提示</summary>
          <label>
            以当前画面为准{" "}
            <select
              aria-label="画面方位提示"
              disabled={busy || following}
              value={anchor}
              onChange={(event) => setAnchor(event.target.value)}
            >
              <option value="auto">阿圆判断</option>
              <option value="bottommost">画面最下方</option>
              <option value="topmost">画面最上方</option>
              <option value="leftmost">画面最左侧</option>
              <option value="rightmost">画面最右侧</option>
              <option value="center">画面中央</option>
            </select>
          </label>{" "}
          <button
            className="quiet-button"
            disabled={!source || busy || following}
            onClick={startManual}
          >
            手动框选校准
          </button>
        </details>
        {result &&
          result.candidates.length > 1 &&
          result.confidence >= 0.65 && (
            <div className="camera-controls" aria-label="选择画面位置">
              {result.candidates.map((_, index) => (
                <button
                  className="soft-button"
                  key={index}
                  disabled={busy || following}
                  onClick={() => void choose(index)}
                >
                  位置{index + 1}
                </button>
              ))}
            </div>
          )}
        <div className="camera-controls">
          <button className="soft-button" onClick={() => void camera()}>
            <Camera size={17} />
            打开相机
          </button>
          <button className="soft-button" onClick={() => file.current?.click()}>
            <Video size={17} />
            本地视频
          </button>
          {demoId && (
            <button className="soft-button" onClick={() => void demo()}>
              试看片段
            </button>
          )}
          <button
            className="primary-button"
            disabled={!source || busy}
            onClick={() => void locate()}
          >
            定位当前帧
          </button>
          <button
            className="soft-button"
            disabled={busy || following || !tracker.current}
            onClick={() => void follow()}
          >
            开始本地跟随
          </button>
          <button className="quiet-button" onClick={stop}>
            <Square size={16} />
            停止
          </button>
        </div>
        {demoId && (
          <small className="form-note">
            演示片段使用官方商品图与合成运动，便于观察跟随和遮挡效果；并非实物录像。
          </small>
        )}
        <input
          ref={file}
          type="file"
          accept="video/*"
          hidden
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = "";
            void localVideo(chosen);
          }}
        />
        <small className="muted">
          云端定位是模型判断；快速转动、反光、遮挡或目标离开画面时需要重新定位。只在你反馈后，教学计划才会继续。
        </small>
      </Modal>
    </>
  );
}
