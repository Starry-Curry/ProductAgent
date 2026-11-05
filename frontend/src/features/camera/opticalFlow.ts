// OpenCV's Shi-Tomasi + pyramidal Lucas-Kanade implementation; glue adds
// forward/backward checks and fail-closed lifecycle, not a replacement CV model.
// References: https://docs.opencv.org/4.12.0/db/d7f/tutorial_js_lucas_kanade.html
import cvUrl from "@techstark/opencv-js/dist/opencv.js?url";

export type Box = [number, number, number, number];
type Cv = typeof import("@techstark/opencv-js");
let ready: Promise<{ cv: Cv }> | undefined;
export function loadOpenCv(): Promise<{ cv: Cv }> {
  const existing = (window as unknown as { cv?: Cv }).cv;
  if (!ready && existing?.Mat) ready = Promise.resolve({ cv: existing });
  if (!ready)
    ready = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = cvUrl;
      const timer = setTimeout(() => fail(), 20000);
      const fail = () => {
        clearTimeout(timer);
        ready = undefined;
        script.remove();
        reject(new Error("本地追踪组件加载失败，请重试"));
      };
      // Older Emscripten modules are self-thenables. Resolve a wrapper, otherwise
      // Promise assimilation can spin forever and starve the browser event loop.
      const done = (cv: Cv) => {
        clearTimeout(timer);
        resolve({ cv });
      };
      script.onerror = fail;
      script.onload = async () => {
        try {
          const candidate = (window as unknown as { cv: Cv | Promise<Cv> }).cv;
          if (candidate instanceof Promise) done(await candidate);
          else if (candidate.Mat) done(candidate);
          else candidate.onRuntimeInitialized = () => done(candidate);
        } catch {
          fail();
        }
      };
      document.head.appendChild(script);
    });
  return ready;
}
const median = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
};

export class LocalTracker {
  private previous: InstanceType<Cv["Mat"]>;
  private points: InstanceType<Cv["Mat"]>;
  private box: Box;
  private initialCount: number;
  private cv: Cv;
  private corners: number[][];
  lost = false;
  private disposed = false;
  constructor(cv: Cv, frame: HTMLCanvasElement, box: Box) {
    this.cv = cv;
    this.box = box;
    this.corners = [
      [box[0], box[1]],
      [box[2], box[1]],
      [box[2], box[3]],
      [box[0], box[3]],
    ];
    const rgba = cv.imread(frame);
    this.previous = new cv.Mat();
    cv.cvtColor(rgba, this.previous, cv.COLOR_RGBA2GRAY);
    rgba.delete();
    const mask = cv.Mat.zeros(frame.height, frame.width, cv.CV_8UC1);
    const padX = Math.max(8, (48 - box[2] + box[0]) / 2),
      padY = Math.max(8, (48 - box[3] + box[1]) / 2);
    cv.rectangle(
      mask,
      new cv.Point(Math.max(0, box[0] - padX), Math.max(0, box[1] - padY)),
      new cv.Point(
        Math.min(frame.width - 1, box[2] + padX),
        Math.min(frame.height - 1, box[3] + padY),
      ),
      new cv.Scalar(255),
      -1,
    );
    this.points = new cv.Mat();
    cv.goodFeaturesToTrack(this.previous, this.points, 80, 0.01, 4, mask, 3);
    mask.delete();
    this.initialCount = this.points.rows;
    if (this.initialCount < 8) {
      this.dispose();
      throw new Error("这个位置纹理太少，无法稳定追踪，请靠近或换个角度。");
    }
  }
  update(frame: HTMLCanvasElement) {
    if (this.lost) throw new Error("追踪已经停止，请重新定位");
    const started = performance.now(),
      cv = this.cv;
    const rgba = cv.imread(frame),
      gray = new cv.Mat(),
      next = new cv.Mat(),
      status = new cv.Mat(),
      err = new cv.Mat(),
      back = new cv.Mat(),
      bs = new cv.Mat(),
      be = new cv.Mat();
    try {
      cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
      const criteria = new cv.TermCriteria(
          cv.TermCriteria_COUNT + cv.TermCriteria_EPS,
          20,
          0.03,
        ),
        win = new cv.Size(21, 21);
      cv.calcOpticalFlowPyrLK(
        this.previous,
        gray,
        this.points,
        next,
        status,
        err,
        win,
        3,
        criteria,
      );
      cv.calcOpticalFlowPyrLK(
        gray,
        this.previous,
        next,
        back,
        bs,
        be,
        win,
        3,
        criteria,
      );
      const p: number[] = [],
        q: number[] = [],
        dx: number[] = [],
        dy: number[] = [];
      for (let i = 0; i < this.points.rows; i++) {
        const x = this.points.data32F[i * 2],
          y = this.points.data32F[i * 2 + 1],
          nx = next.data32F[i * 2],
          ny = next.data32F[i * 2 + 1];
        if (
          status.data[i] &&
          bs.data[i] &&
          err.data32F[i] < 22 &&
          Math.hypot(x - back.data32F[i * 2], y - back.data32F[i * 2 + 1]) <
            1.4 &&
          nx >= 0 &&
          ny >= 0 &&
          nx < frame.width &&
          ny < frame.height
        ) {
          p.push(x, y);
          q.push(nx, ny);
          dx.push(nx - x);
          dy.push(ny - y);
        }
      }
      const tx = median(dx),
        ty = median(dy),
        count = dx.length;
      if (
        count < 8 ||
        count / this.initialCount < 0.5 ||
        Math.hypot(tx, ty) > Math.min(frame.width, frame.height) * 0.16
      )
        throw new Error("画面变化或遮挡较大，已停止标注。请重新定位。");
      const from = cv.matFromArray(count, 1, cv.CV_32FC2, p),
        to = cv.matFromArray(count, 1, cv.CV_32FC2, q),
        inliers = new cv.Mat();
      let transform: InstanceType<Cv["Mat"]> | undefined;
      let quad: number[][] = [],
        dispersion = 0,
        kept: number[] = [];
      try {
        transform =
          typeof cv.estimateAffinePartial2D === "function"
            ? cv.estimateAffinePartial2D(
                from,
                to,
                inliers,
                cv.RANSAC,
                2,
                600,
                0.99,
                8,
              )
            : cv.findHomography(from, to, cv.RANSAC, 2, inliers, 600, 0.99);
        if (!transform || transform.empty())
          throw new Error("无法确认目标的运动，请重新定位。");
        const m = transform.data64F;
        const warp = (x: number, y: number) => {
          const d = transform!.rows === 3 ? m[6] * x + m[7] * y + m[8] : 1;
          return [
            (m[0] * x + m[1] * y + m[2]) / d,
            (m[3] * x + m[4] * y + m[5]) / d,
          ];
        };
        const errors: number[] = [];
        for (let i = 0; i < count; i++)
          if (inliers.data[i]) {
            kept.push(q[i * 2], q[i * 2 + 1]);
            const mapped = warp(p[i * 2], p[i * 2 + 1]);
            errors.push(
              Math.hypot(mapped[0] - q[i * 2], mapped[1] - q[i * 2 + 1]),
            );
          }
        dispersion = median(errors);
        quad = this.corners.map(([x, y]) => warp(x, y));
        const ratio =
          Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]) /
          Math.hypot(
            this.corners[1][0] - this.corners[0][0],
            this.corners[1][1] - this.corners[0][1],
          );
        if (
          kept.length / 2 < 8 ||
          kept.length / 2 / this.initialCount < 0.5 ||
          kept.length / 2 / count < 0.7 ||
          dispersion > 2 ||
          !Number.isFinite(ratio) ||
          ratio < 0.88 ||
          ratio > 1.12 ||
          quad.some((point) => point.some((n) => !Number.isFinite(n)))
        )
          throw new Error("目标变化太大或不够可靠，已停止标注。请重新定位。");
      } finally {
        from.delete();
        to.delete();
        inliers.delete();
        transform?.delete();
      }
      const moved: Box = [
        Math.min(...quad.map((p) => p[0])),
        Math.min(...quad.map((p) => p[1])),
        Math.max(...quad.map((p) => p[0])),
        Math.max(...quad.map((p) => p[1])),
      ];
      if (
        moved[0] < 0 ||
        moved[1] < 0 ||
        moved[2] > frame.width ||
        moved[3] > frame.height
      )
        throw new Error("目标离开画面，请重新定位。");
      this.box = moved;
      this.corners = quad;
      this.previous.delete();
      this.previous = gray.clone();
      this.points.delete();
      this.points = cv.matFromArray(kept.length / 2, 1, cv.CV_32FC2, kept);
      return {
        box: this.box,
        quad,
        count: kept.length / 2,
        retained: kept.length / 2 / this.initialCount,
        dispersion,
        ms: performance.now() - started,
      };
    } catch (error) {
      this.lost = true;
      throw error;
    } finally {
      [rgba, gray, next, status, err, back, bs, be].forEach((mat) =>
        mat.delete(),
      );
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.previous?.delete();
    this.points?.delete();
    this.lost = true;
  }
}
