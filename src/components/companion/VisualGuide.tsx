"use client";
import { useEffect, useRef, useState } from "react";
import {
  Camera,
  ImagePlus,
  ArrowLeft,
  ArrowRight,
  Video,
  Download,
  Volume2,
  ScanLine,
  Play,
  Pause,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { Item, Person, API } from "./types";
import { itemPhoto } from "@/lib/life/item-photos";
import {
  guideSketch,
  diagramMarker,
  washerGuide,
  type GuideStep,
  type GuideMarker,
  type GuideAnalysis,
} from "@/lib/companion/visual-guide";
import { speak } from "./Chat";
async function loadImage(src: string) {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = () => reject(Error("图片没有加载完成，请换一张近照。"));
    i.src = src;
  });
}
async function jpeg(src: string) {
  const i = await loadImage(src),
    c = document.createElement("canvas"),
    scale = Math.min(1, 1100 / i.naturalWidth);
  c.width = Math.round(i.naturalWidth * scale);
  c.height = Math.round(i.naturalHeight * scale);
  c.getContext("2d")!.drawImage(i, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}
function Marker({ target }: { target: GuideMarker | null }) {
  if (!target) return null;
  const x = target.x * 1000,
    y = target.y * 760,
    sx = Math.max(50, Math.min(950, x + (x > 0.65 * 1000 ? -230 : 230))),
    sy = Math.max(40, Math.min(710, y + (y < 180 ? 150 : -150))),
    angle = Math.atan2(y - sy, x - sx),
    back = 26;
  return (
    <svg
      className="wj-guide-overlay"
      viewBox="0 0 1000 760"
      preserveAspectRatio="none"
      aria-label={"红色箭头指向" + target.label}
    >
      <ellipse
        cx={x}
        cy={y}
        rx={Math.max(28, target.width * 500)}
        ry={Math.max(22, target.height * 380)}
        fill="rgba(220,67,57,.08)"
        stroke="#e34e42"
        strokeWidth="5"
      />
      <line
        x1={sx}
        y1={sy}
        x2={x - Math.cos(angle) * 20}
        y2={y - Math.sin(angle) * 20}
        stroke="#e34e42"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <polygon
        points={`${x},${y} ${x - Math.cos(angle) * back - Math.sin(angle) * 16},${y - Math.sin(angle) * back + Math.cos(angle) * 16} ${x - Math.cos(angle) * back + Math.sin(angle) * 16},${y - Math.sin(angle) * back - Math.cos(angle) * 16}`}
        fill="#e34e42"
      />
    </svg>
  );
}
export function VisualGuide({
  item,
  actor,
  steps: provided,
  question = "",
  api,
  notify,
}: {
  item?: Item;
  actor: Person;
  steps?: GuideStep[];
  question?: string;
  api: API;
  notify: (s: string) => void;
}) {
  const initial = item ? itemPhoto(item, actor)?.src : "";
  const [tab, setTab] = useState<"steps" | "live" | "video">("steps"),
    [index, setIndex] = useState(0),
    [photo, setPhoto] = useState(initial || ""),
    [marks, setMarks] = useState<Record<number, GuideAnalysis>>({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [ratio, setRatio] = useState(1000 / 760),
    [liveRatio, setLiveRatio] = useState(16 / 9),
    [source, setSource] = useState<"none" | "camera" | "sample">("none"),
    [live, setLive] = useState(false),
    [liveMark, setLiveMark] = useState<GuideAnalysis | null>(null),
    [clip, setClip] = useState(""),
    [clipType, setClipType] = useState("webm"),
    [making, setMaking] = useState(false),
    [progress, setProgress] = useState("");
  const alive = useRef(true),
    working = useRef(false),
    file = useRef<HTMLInputElement>(null),
    video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    recorder = useRef<MediaRecorder | null>(null),
    calls = useRef(0),
    currentFrame = useRef({ index, source }),
    clipRef = useRef("");
  currentFrame.current = { index, source };
  const steps = (
      source === "sample"
        ? washerGuide
        : provided?.length
          ? provided
          : washerGuide
    ).slice(0, 9),
    step = steps[Math.min(index, steps.length - 1)],
    name =
      source === "sample"
        ? "示例洗衣机"
        : item?.name || (/洗衣/.test(question) ? "洗衣机" : "物品操作");
  function stopCamera() {
    if (source === "sample") setIndex(0);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setLive(false);
    setSource("none");
    setLiveMark(null);
  }
  useEffect(() => {
    alive.current = true;
    const hide = () => {
      if (document.hidden) {
        stream.current?.getTracks().forEach((t) => t.stop());
        stream.current = null;
        setLive(false);
        setSource("none");
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", hide);
      stream.current?.getTracks().forEach((t) => t.stop());
      if (recorder.current?.state === "recording") recorder.current.stop();
      if (clipRef.current) URL.revokeObjectURL(clipRef.current);
    };
  }, []);
  async function locate(src: string, current: number, fromFrame = false) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setMessage("");
    try {
      const image = await jpeg(src);
      const data = (await api("/api/guidance", {
        image,
        step: steps[current].text,
        ...(item && source !== "sample" ? { itemId: item.id } : {}),
      })) as GuideAnalysis;
      if (!alive.current) return;
      if (fromFrame) {
        if (
          currentFrame.current.index === current &&
          currentFrame.current.source === source
        )
          setLiveMark(data);
      } else setMarks((m) => ({ ...m, [current]: data }));
      if (data.message) setMessage(data.message);
    } catch (e) {
      if (alive.current) {
        setMessage((e as Error).message);
        setLive(false);
      }
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (tab === "steps" && photo && !marks[index]) void locate(photo, index);
  }, [tab, photo, index]);
  async function camera() {
    try {
      stopCamera();
      setIndex(0);
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error("此浏览器不能打开摄像头，可以上传照片或用示例画面体验。");
      stream.current?.getTracks().forEach((t) => t.stop());
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      if (!alive.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      setSource("camera");
      setLiveMark(null);
      setMessage(
        "摄像头已开启。点击“开始实时识别”后，才会定时发送当前画面进行标注。",
      );
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    if (source === "camera" && video.current && stream.current) {
      video.current.srcObject = stream.current;
      void video.current
        .play()
        .catch(() => setMessage("请点击画面播放，或改用上传照片。"));
    }
  }, [source, tab]);
  async function frame() {
    if (working.current) return;
    let src = "";
    if (source === "sample") src = guideSketch("示例洗衣机");
    else if (video.current && video.current.readyState >= 2) {
      const c = document.createElement("canvas"),
        v = video.current;
      c.width = Math.min(1100, v.videoWidth);
      c.height = Math.round((c.width * v.videoHeight) / v.videoWidth);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      src = c.toDataURL("image/jpeg", 0.8);
    }
    if (src) await locate(src, index, true);
    else setMessage("画面还没准备好，可以稍等一下或上传照片。");
  }
  useEffect(() => {
    if (!live || tab !== "live") return;
    const run = () => {
      if (working.current) return;
      if (calls.current >= 12) {
        setLive(false);
        setMessage("这轮识别已暂停，可以点击继续开始下一轮。");
        return;
      }
      calls.current++;
      void frame();
    };
    run();
    const timer = setInterval(run, 5000);
    return () => clearInterval(timer);
  }, [live, tab, index, source]);
  const analysis = marks[index],
    usePhoto = !!photo && (!analysis || !!analysis.target),
    picture = usePhoto ? photo : guideSketch(name),
    target = usePhoto ? analysis?.target || null : diagramMarker(step.text);
  async function upload(f: File) {
    try {
      if (!f.type.startsWith("image/") || f.size > 12000000)
        throw Error("请选一张小于 12MB 的图片。");
      stopCamera();
      setIndex(0);
      const raw = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(Error("图片读取失败"));
        r.readAsDataURL(f);
      });
      setPhoto(await jpeg(raw));
      setMarks({});
      setClip("");
      setMessage("正在根据你的实拍图定位当前操作。");
      setTab("steps");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function makeVideo() {
    if (making) return;
    setMaking(true);
    setProgress("正在准备画面…");
    try {
      if (
        typeof MediaRecorder === "undefined" ||
        !HTMLCanvasElement.prototype.captureStream
      )
        throw Error(
          "此浏览器不支持合成视频，可换用 Chrome 或 Edge；图片指导仍可使用。",
        );
      const mime = ["video/webm;codecs=vp8", "video/mp4", "video/webm"].find(
        (t) => MediaRecorder.isTypeSupported(t),
      );
      if (!mime)
        throw Error("当前浏览器不支持视频编码，请换用 Chrome / Edge。");
      const canvas = document.createElement("canvas");
      canvas.width = 960;
      canvas.height = 720;
      const ctx = canvas.getContext("2d")!,
        media = canvas.captureStream(12),
        chunks: BlobPart[] = [];
      const rec = new MediaRecorder(media, {
        mimeType: mime,
        videoBitsPerSecond: 1700000,
      });
      recorder.current = rec;
      const finished = new Promise<Blob>((resolve, reject) => {
        rec.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        rec.onerror = () => reject(Error("视频编码未完成"));
        rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
      });
      const frames = await Promise.all(
        steps.map(async (s, n) => ({
          image: await loadImage(
            photo && marks[n]?.target ? photo : guideSketch(name),
          ),
          target:
            photo && marks[n]?.target ? marks[n].target : diagramMarker(s.text),
          text: s.text,
        })),
      );
      rec.start();
      for (let n = 0; n < frames.length; n++) {
        if (!alive.current) break;
        setProgress(`正在生成第 ${n + 1} / ${frames.length} 步`);
        const f = frames[n];
        await new Promise<void>((resolve) => {
          const start = performance.now();
          function draw(now: number) {
            if (!alive.current) {
              resolve();
              return;
            }
            ctx.fillStyle = "#f7f6f2";
            ctx.fillRect(0, 0, 960, 720);
            ctx.fillStyle = "#34484b";
            ctx.font = "bold 24px sans-serif";
            ctx.fillText(`${name} · 第 ${n + 1} 步`, 34, 43);
            const scale = Math.min(
                890 / f.image.naturalWidth,
                490 / f.image.naturalHeight,
              ),
              w = f.image.naturalWidth * scale,
              h = f.image.naturalHeight * scale,
              x = (960 - w) / 2,
              y = 70 + (490 - h) / 2;
            ctx.drawImage(f.image, x, y, w, h);
            if (f.target) {
              const tx = x + f.target.x * w,
                ty = y + f.target.y * h,
                sx = Math.max(
                  x + 20,
                  Math.min(x + w - 20, tx + (f.target.x > 0.6 ? -130 : 130)),
                ),
                sy = Math.max(y + 20, Math.min(y + h - 20, ty - 100)),
                a = Math.atan2(ty - sy, tx - sx);
              ctx.strokeStyle = "#e44d43";
              ctx.fillStyle = "#e44d43";
              ctx.lineWidth = 5 + Math.sin(now / 160);
              ctx.beginPath();
              ctx.ellipse(
                tx,
                ty,
                Math.max(20, (f.target.width * w) / 2),
                Math.max(16, (f.target.height * h) / 2),
                0,
                0,
                Math.PI * 2,
              );
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(sx, sy);
              ctx.lineTo(tx, ty);
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(tx, ty);
              ctx.lineTo(
                tx - Math.cos(a) * 23 - Math.sin(a) * 13,
                ty - Math.sin(a) * 23 + Math.cos(a) * 13,
              );
              ctx.lineTo(
                tx - Math.cos(a) * 23 + Math.sin(a) * 13,
                ty - Math.sin(a) * 23 - Math.cos(a) * 13,
              );
              ctx.closePath();
              ctx.fill();
            }
            ctx.fillStyle = "#34484b";
            ctx.font = "23px sans-serif";
            let line = "",
              row = 0;
            for (const char of f.text.slice(0, 96)) {
              if (ctx.measureText(line + char).width > 860) {
                ctx.fillText(line, 45, 610 + row * 32);
                line = "";
                row++;
              }
              line += char;
            }
            ctx.fillText(line, 45, 610 + row * 32);
            ctx.fillStyle = "#8a9692";
            ctx.font = "15px sans-serif";
            ctx.fillText(
              "操作演示 · 根据当前步骤合成 · 示意位置以实际面板为准",
              34,
              701,
            );
            if (now - start < 2500) requestAnimationFrame(draw);
            else resolve();
          }
          requestAnimationFrame(draw);
        });
      }
      if (rec.state === "recording") rec.stop();
      const blob = await finished;
      media.getTracks().forEach((t) => t.stop());
      if (!alive.current) return;
      if (!blob.size) throw Error("没有生成有效视频");
      if (clipRef.current) URL.revokeObjectURL(clipRef.current);
      clipRef.current = URL.createObjectURL(blob);
      setClip(clipRef.current);
      setClipType(mime.includes("mp4") ? "mp4" : "webm");
      setProgress("视频已生成，可以播放或下载。");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      if (alive.current) setMaking(false);
    }
  }
  return (
    <div className="wj-visual-guide">
      <div className="wj-segment wj-visual-tabs">
        {[
          ["steps", "看图跟着做"],
          ["live", "实时识别"],
          ["video", "演示视频"],
        ].map(([v, label]) => (
          <button
            key={v}
            className={tab === v ? "active" : ""}
            onClick={() => {
              setTab(v as typeof tab);
              if (v !== "live") stopCamera();
            }}
          >
            {v === "steps" ? (
              <ScanLine size={16} />
            ) : v === "live" ? (
              <Camera size={16} />
            ) : (
              <Video size={16} />
            )}{" "}
            {label}
          </button>
        ))}
      </div>
      <div className="wj-guide-step-title">
        <span>
          {index + 1} / {steps.length}
        </span>
        <h3>{step.text}</h3>
        <button
          className="wj-icon-btn"
          aria-label="朗读当前步骤"
          onClick={() => speak(step.text, notify)}
        >
          <Volume2 size={18} />
        </button>
      </div>
      {tab === "steps" && (
        <>
          <div
            className="wj-guide-picture"
            style={{
              aspectRatio: ratio,
              maxWidth: `min(700px, ${35 * ratio}vh)`,
              marginLeft: "auto",
              marginRight: "auto",
            }}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const p = {
                label: "手动调整的操作位置",
                x: (e.clientX - r.left) / r.width,
                y: (e.clientY - r.top) / r.height,
                width: 0.13,
                height: 0.1,
                confidence: 1,
                visible: true,
              };
              setMarks((m) => ({
                ...m,
                [index]: {
                  instruction: step.text,
                  target: p,
                  source: "demonstration",
                },
              }));
              if (!usePhoto) setPhoto(picture);
            }}
          >
            <img
              src={picture}
              alt={usePhoto ? "当前物品实拍图" : "操作示意图"}
              onLoad={(e) =>
                setRatio(
                  e.currentTarget.naturalWidth / e.currentTarget.naturalHeight,
                )
              }
            />
            <Marker target={target} />
            {busy && (
              <div className="wj-guide-analyzing">
                <Loader2 className="spin" size={16} />
                正在定位这一步…
              </div>
            )}
          </div>
          <div className="wj-guide-source">
            {usePhoto && analysis?.source === "vision-model"
              ? "大模型根据当前照片定位"
              : usePhoto && analysis
                ? "手动演示标注"
                : "操作示意图 · 位置以实际面板为准"}
            {target && <b>{target.label}</b>}
          </div>
          <div className="wj-actions">
            <button
              className="wj-btn secondary"
              onClick={() => file.current?.click()}
            >
              <ImagePlus size={16} />
              上传面板近照
            </button>
            <button
              className="wj-btn secondary"
              disabled={busy || !photo}
              onClick={() => void locate(photo, index)}
            >
              <RefreshCw size={15} />
              重新定位
            </button>
            <span className="wj-muted">点图片可调整标注位置。</span>
          </div>
        </>
      )}
      {tab === "live" && (
        <>
          <div
            className="wj-guide-picture wj-live-picture"
            style={{
              aspectRatio: source === "camera" ? liveRatio : 1000 / 760,
              maxWidth: `min(700px, ${32 * (source === "camera" ? liveRatio : 1000 / 760)}vh)`,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            {source === "camera" ? (
              <video
                ref={video}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={(e) =>
                  setLiveRatio(
                    e.currentTarget.videoWidth / e.currentTarget.videoHeight,
                  )
                }
              />
            ) : source === "sample" ? (
              <img src={guideSketch("示例洗衣机")} alt="示例洗衣机画面" />
            ) : (
              <div className="wj-camera-placeholder">
                <Camera size={42} />
                <p>把摄像头对准面板，我来找这一步的位置。</p>
              </div>
            )}
            <Marker target={liveMark?.target || null} />
            {source !== "none" && (
              <span className={"wj-live-badge " + (live ? "active" : "")}>
                {source === "sample" ? "示例画面" : "摄像头画面"} ·{" "}
                {live ? "实时识别中" : "已暂停"}
              </span>
            )}
            {busy && (
              <div className="wj-guide-analyzing">
                <Loader2 size={16} className="spin" />
                正在识别当前画面…
              </div>
            )}
          </div>
          <div className="wj-actions">
            <button className="wj-btn secondary" onClick={camera}>
              <Camera size={16} />
              开启摄像头
            </button>
            <button
              className="wj-btn secondary"
              onClick={() => {
                stopCamera();
                setSource("sample");
                setIndex(0);
                setLiveMark(null);
                setMessage("这是示例画面，仍会调用视觉模型进行定位。");
              }}
            >
              用示例画面体验
            </button>
            <button
              className="wj-btn"
              disabled={source === "none"}
              onClick={() => {
                calls.current = 0;
                setLive(!live);
              }}
            >
              {live ? <Pause size={16} /> : <Play size={16} />}{" "}
              {live ? "暂停实时识别" : "开始实时识别"}
            </button>
            <button
              className="wj-link"
              disabled={source === "none" || busy}
              onClick={() => void frame()}
            >
              识别当前画面
            </button>
            {source !== "none" && (
              <button className="wj-link" onClick={stopCamera}>
                {source === "camera" ? "关闭摄像头" : "退出示例"}
              </button>
            )}
          </div>
          {liveMark && (
            <p className="wj-guide-source">
              {liveMark.source === "vision-model"
                ? "视觉模型识别"
                : "本次未完成定位"}
              {liveMark.target
                ? ` · ${liveMark.target.label}`
                : " · 目标暂不可见，请对准操作面板"}
            </p>
          )}
          <p className="wj-visual-note">
            实时模式约每 5 秒发送一帧进行 AI
            定位，按模型服务商计费；切走页面会暂停。物间不保存摄像头画面。
          </p>
        </>
      )}
      {tab === "video" && (
        <>
          <div className="wj-guide-video">
            {clip ? (
              <video
                controls
                playsInline
                src={clip}
                aria-label="物品操作演示视频"
              />
            ) : (
              <div className="wj-camera-placeholder">
                <Video size={44} />
                <h3>把步骤变成一段演示</h3>
                <p>当前照片或示意图 + 红色指示 + 分步字幕</p>
              </div>
            )}
          </div>
          <div className="wj-actions">
            <button
              className="wj-btn"
              disabled={making}
              onClick={() => void makeVideo()}
            >
              {making ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Video size={16} />
              )}{" "}
              {making
                ? "正在合成…"
                : clip
                  ? "重新生成视频"
                  : "生成操作演示视频"}
            </button>
            {clip && (
              <a
                className="wj-btn secondary"
                href={clip}
                download={`物间-${name}-操作演示.${clipType}`}
              >
                <Download size={16} />
                下载视频
              </a>
            )}
          </div>
          {progress && <p role="status">{progress}</p>}
          <p className="wj-visual-note">
            根据当前步骤合成的视频，含字幕与箭头；不是厂商实录。支持的浏览器可直接生成和下载。
          </p>
        </>
      )}
      {message && (
        <p className="wj-form-notice" role="status">
          {message}
        </p>
      )}
      <div className="wj-guide-navigation">
        <button
          className="wj-btn secondary"
          disabled={index === 0}
          onClick={() => {
            setIndex(index - 1);
            setLiveMark(null);
          }}
        >
          <ArrowLeft size={16} />
          上一步
        </button>
        <span>
          {index + 1} / {steps.length}
        </span>
        <button
          className="wj-btn"
          disabled={index === steps.length - 1}
          onClick={() => {
            setIndex(index + 1);
            setLiveMark(null);
          }}
        >
          下一步
          <ArrowRight size={16} />
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*"
        capture="environment"
        className="wj-hidden-input"
        aria-label="上传操作面板照片"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
