import type { Box } from "./opticalFlow";
import { warmTracker, createTracker, type Tracker } from "./trackerEngine";

export type Grounding = {
  visible: boolean;
  bbox: Box | null;
  label: string;
  confidence: number;
  candidates: Box[];
  explanation: string;
  elapsed_seconds: number;
};
export type CameraState = "seeking" | "following" | "waiting" | "stopped";
type Ports = {
  reference?: (
    frame: HTMLCanvasElement,
  ) => Promise<{
    tracker: Tracker;
    value: {
      box: Box;
      quad: number[][];
      ms: number;
      retained: number;
      engine?: string;
    };
  } | null>;
  read: () => HTMLCanvasElement | null;
  ground: (snapshot: HTMLCanvasElement) => Promise<Grounding>;
  schedule: (callback: () => void) => () => void;
  overlay: (box: Box | null, label?: string, quad?: number[][]) => void;
  status: (state: CameraState, text: string) => void;
  metrics?: (value: {
    ms: number;
    retained: number;
    cloudCalls: number;
    engine?: string;
  }) => void;
  afterAttempt?: () => void;
};
const copy = (source: HTMLCanvasElement) => {
  const c = document.createElement("canvas");
  c.width = source.width;
  c.height = source.height;
  c.getContext("2d")!.drawImage(source, 0, 0);
  return c;
};

/** Cloud chooses semantic target; buffered local frames align its delayed result.
 * Tracking loss clears the overlay and schedules a fresh detection automatically.
 * Optional reviewed reference-plane targets are projected onto actual frames;
 * there is no saved video trajectory or substituted model answer. */
export class AutoCameraSession {
  private tracker?: Tracker;
  private cancelFrame = () => {};
  private closed = false;
  private pending = false;
  private aligning = false;
  private frames: HTMLCanvasElement[] = [];
  private capturedAt = 0;
  private lastBuffer = 0;
  private nextCloud = 0;
  private lastDetection = 0;
  private calls: number[] = [];
  private totalCalls = 0;
  private localFrames = 0;
  private nextReference = 0;
  private label = "当前目标";
  private previousBox?: Box;
  private phase: CameraState = "stopped";
  constructor(private ports: Ports) {}
  start(seek = true) {
    if (!seek) this.nextCloud = Infinity;
    this.setStatus("seeking", "正在自动寻找当前步骤的位置…");
    this.tick();
  }
  private setStatus(state: CameraState, text: string) {
    this.phase = state;
    this.ports.status(state, text);
  }
  private releaseFrames() {
    for (const frame of this.frames) {
      frame.width = 0;
      frame.height = 0;
    }
    this.frames = [];
  }
  stop() {
    this.closed = true;
    this.cancelFrame();
    this.tracker?.dispose();
    this.tracker = undefined;
    this.releaseFrames();
    this.ports.overlay(null);
  }
  private lose(text: string) {
    this.tracker?.dispose();
    this.tracker = undefined;
    this.previousBox = undefined;
    this.ports.overlay(null);
    this.setStatus("seeking", text);
  }
  private tick = async () => {
    if (this.closed) return;
    const frame = this.ports.read(),
      now = performance.now();
    if (frame) {
      if (!this.tracker && this.ports.reference && now >= this.nextReference) {
        this.nextReference = now + 500;
        try {
          const matched = await this.ports.reference(frame);
          if (this.closed) {
            matched?.tracker.dispose();
            return;
          }
          if (matched) {
            this.tracker = matched.tracker;
            this.previousBox = matched.value.box;
            this.label = "当前操作部位";
            this.lastDetection = now;
            this.ports.overlay(
              matched.value.box,
              this.label,
              matched.value.quad,
            );
            this.ports.metrics?.({
              ...matched.value,
              cloudCalls: this.totalCalls,
            });
            this.setStatus("following", "已匹配当前部位，正在本地跟随。");
            this.ports.afterAttempt?.();
          }
        } catch {
          /* A reference miss falls back to actual cloud grounding below. */
        }
      }
      if (this.pending && now - this.lastBuffer >= 100) {
        this.lastBuffer = now;
        if (this.frames.length < 90) this.frames.push(copy(frame));
      }
      if (this.tracker && !this.aligning) {
        const active = this.tracker;
        try {
          const value = await active.update(frame);
          if (this.closed) return;
          if (this.tracker !== active) {
            this.cancelFrame = this.ports.schedule(this.tick);
            return;
          }
          this.previousBox = value.box;
          this.ports.overlay(value.box, this.label, value.quad);
          if (++this.localFrames % 15 === 0)
            this.ports.metrics?.({
              ms: value.ms,
              retained: value.retained,
              cloudCalls: this.totalCalls,
              engine: value.engine,
            });
        } catch {
          if (!this.closed && this.tracker === active)
            this.lose("暂时跟丢了，正在自动重新定位…");
        }
      }
      this.calls = this.calls.filter((time) => now - time < 60000);
      if (
        !this.pending &&
        now >= this.nextCloud &&
        (!this.tracker ||
          (this.tracker.engine !== "reference" &&
            now - this.lastDetection > 20000))
      ) {
        if (this.calls.length < 6) void this.locate(frame);
        else if (!this.tracker)
          this.setStatus(
            "waiting",
            "暂时没找到清晰位置，稍后自动再看。也可以靠近一些。",
          );
      }
    }
    this.cancelFrame = this.ports.schedule(this.tick);
  };
  private async locate(frame: HTMLCanvasElement) {
    this.pending = true;
    this.capturedAt = performance.now();
    this.lastBuffer = this.capturedAt;
    this.calls.push(this.capturedAt);
    this.totalCalls++;
    const snapshot = copy(frame);
    const prior = this.previousBox?.map(
      (value, i) => (value / (i % 2 ? frame.height : frame.width)) * 999,
    ) as Box | undefined;
    this.nextCloud = this.capturedAt + 8000;
    if (!this.tracker)
      this.setStatus("seeking", "正在自动找位置，画面可继续移动…");
    try {
      const [, answer] = await Promise.all([
        warmTracker(),
        this.ports.ground(snapshot),
      ]);
      if (this.closed) return;
      if (this.tracker?.engine === "reference") return;
      let box = answer.visible && answer.confidence >= 0.7 ? answer.bbox : null;
      // Re-associate only an already locked instance, never arbitrarily pick a
      // first target among duplicates. This is temporal overlap, not recognition.
      if (!box && prior && answer.confidence >= 0.7) {
        const overlap = (a: Box, b: Box) => {
          const intersection =
            Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
            Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
          return (
            intersection /
            ((a[2] - a[0]) * (a[3] - a[1]) +
              (b[2] - b[0]) * (b[3] - b[1]) -
              intersection || 1)
          );
        };
        const ranked = answer.candidates
          .map((value) => ({ value, score: overlap(value, prior) }))
          .sort((a, b) => b.score - a.score);
        if (
          ranked[0]?.score > 0.55 &&
          (!ranked[1] || ranked[0].score - ranked[1].score > 0.2)
        )
          box = ranked[0].value;
      }
      if (!box) {
        this.lose(
          answer.candidates.length > 1
            ? "有几个相似位置，请把要看的那一处靠近一些；我会自动再找。"
            : "暂时没看清目标，换个角度后会自动再找。",
        );
        return;
      }
      if (
        performance.now() - this.capturedAt > 10500 ||
        this.frames.length >= 90
      )
        throw new Error("outdated snapshot");
      const pixels = box.map(
        (value, i) =>
          (value / 999) * (i % 2 ? snapshot.height : snapshot.width),
      ) as Box;
      this.aligning = true;
      const next = await createTracker(snapshot, pixels);
      if (this.closed) {
        next.dispose();
        return;
      }
      let currentBox = pixels,
        currentQuad: number[][] | undefined;
      try {
        const sampled = [...this.frames],
          stride = Math.max(1, Math.ceil(sampled.length / 8));
        for (let i = 0; i < sampled.length; i += stride) {
          const moved = await next.update(sampled[i]);
          currentBox = moved.box;
          currentQuad = moved.quad;
        }
        const latest = this.ports.read();
        if (latest) {
          const moved = await next.update(latest);
          currentBox = moved.box;
          currentQuad = moved.quad;
        }
      } catch (error) {
        next.dispose();
        throw error;
      }
      if (this.closed) {
        next.dispose();
        return;
      }
      this.tracker?.dispose();
      this.tracker = next;
      this.label = answer.label;
      this.previousBox = currentBox;
      this.lastDetection = performance.now();
      this.ports.overlay(currentBox, this.label, currentQuad);
      this.setStatus("following", "已找到，正在自动跟随。");
    } catch {
      if (!this.closed && !this.tracker)
        this.lose("这次位置没跟上，正在等下一次自动定位；也可靠近一些。");
    } finally {
      snapshot.width = 0;
      snapshot.height = 0;
      this.releaseFrames();
      this.pending = false;
      this.aligning = false;
      if (!this.closed) this.ports.afterAttempt?.();
    }
  }
  async manual(frame: HTMLCanvasElement, box: Box) {
    if (this.pending) return;
    const next = await createTracker(frame, box);
    if (this.closed) {
      next.dispose();
      return;
    }
    this.tracker?.dispose();
    this.tracker = next;
    this.label = "你框选的位置";
    this.previousBox = box;
    this.lastDetection = performance.now();
    this.nextCloud = performance.now() + 8000;
    this.ports.overlay(box, this.label);
    this.setStatus("following", "已按你的框选跟随。");
    this.ports.afterAttempt?.();
  }
}
