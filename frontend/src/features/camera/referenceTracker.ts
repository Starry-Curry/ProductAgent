/** Image-target tracking for a reviewed, photographed control surface.
 * OpenCV ORB + ratio-test matches + RANSAC homography, re-estimated each frame.
 * Only the reference plane/part locations are authored; video positions are
 * measured from the current frame. No saved video trajectory is played back.
 * https://docs.opencv.org/4.12.0/d1/de0/tutorial_py_feature_homography.html
 */
import { loadOpenCv, type Box } from "./opticalFlow";
import type { Tracker } from "./trackerEngine";
type Cv = typeof import("@techstark/opencv-js");
export type ReferenceSpec = {
  image_id: string;
  width: number;
  height: number;
  roi: Box;
  targets: Record<string, Box>;
  basis: string;
};
export class ReferenceSurface {
  private descriptor: InstanceType<Cv["Mat"]>;
  private points: number[][] = [];
  private orb: InstanceType<Cv["ORB"]>;
  private matcher: InstanceType<Cv["BFMatcher"]>;
  private closed = false;
  private constructor(
    private cv: Cv,
    private spec: ReferenceSpec,
    frame: HTMLCanvasElement,
  ) {
    this.orb = new cv.ORB(1500, 1.2, 8, 15, 0, 2, cv.ORB_HARRIS_SCORE, 31, 5);
    this.matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
    const rgba = cv.imread(frame),
      gray = new cv.Mat(),
      mask = cv.Mat.zeros(frame.height, frame.width, cv.CV_8UC1),
      keys = new cv.KeyPointVector();
    this.descriptor = new cv.Mat();
    try {
      cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
      cv.rectangle(
        mask,
        new cv.Point(spec.roi[0], spec.roi[1]),
        new cv.Point(spec.roi[2], spec.roi[3]),
        new cv.Scalar(255),
        -1,
      );
      this.orb.detectAndCompute(gray, mask, keys, this.descriptor);
      for (let i = 0; i < keys.size(); i++) {
        const p = keys.get(i).pt;
        this.points.push([p.x, p.y]);
      }
      if (this.points.length < 12) throw new Error("参考控制面的纹理不足。");
    } finally {
      rgba.delete();
      gray.delete();
      mask.delete();
      keys.delete();
    }
  }
  static async load(spec: ReferenceSpec) {
    const { cv } = await loadOpenCv();
    const image = new Image();
    image.src = "/api/assets/" + spec.image_id;
    await image.decode();
    const frame = document.createElement("canvas");
    frame.width = spec.width;
    frame.height = spec.height;
    frame.getContext("2d")!.drawImage(image, 0, 0, frame.width, frame.height);
    return new ReferenceSurface(cv, spec, frame);
  }
  tracker(target: string): Tracker {
    const rect = this.spec.targets[target];
    if (!rect) throw new Error("这一步没有校核的参考部位。");
    let disposed = false;
    return {
      engine: "reference",
      update: (frame) => {
        if (disposed) throw new Error("跟随已停止");
        return this.locate(frame, rect);
      },
      dispose: () => {
        disposed = true;
      },
    };
  }
  private locate(frame: HTMLCanvasElement, rect: Box) {
    if (this.closed) throw new Error("参考跟踪已关闭");
    const started = performance.now(),
      cv = this.cv,
      rgba = cv.imread(frame),
      gray = new cv.Mat(),
      mask = new cv.Mat(),
      keys = new cv.KeyPointVector(),
      descriptor = new cv.Mat(),
      pairs = new cv.DMatchVectorVector();
    let a: InstanceType<Cv["Mat"]> | undefined,
      b: InstanceType<Cv["Mat"]> | undefined,
      h: InstanceType<Cv["Mat"]> | undefined,
      inliers: InstanceType<Cv["Mat"]> | undefined;
    try {
      cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
      this.orb.detectAndCompute(gray, mask, keys, descriptor);
      if (descriptor.rows < 12) throw new Error("当前控制面不清楚");
      this.matcher.knnMatch(this.descriptor, descriptor, pairs, 2);
      const src: number[] = [],
        dst: number[] = [];
      for (let i = 0; i < pairs.size(); i++) {
        const pair = pairs.get(i);
        try {
          if (pair.size() < 2) continue;
          const first = pair.get(0),
            second = pair.get(1);
          if (first.distance < 0.76 * second.distance) {
            const p = keys.get(first.trainIdx).pt;
            src.push(...this.points[first.queryIdx]);
            dst.push(p.x, p.y);
          }
        } finally {
          pair.delete();
        }
      }
      const count = src.length / 2;
      if (count < 10) throw new Error("当前视角没有足够的参考匹配");
      a = cv.matFromArray(count, 1, cv.CV_32FC2, src);
      b = cv.matFromArray(count, 1, cv.CV_32FC2, dst);
      inliers = new cv.Mat();
      h = cv.findHomography(a, b, cv.RANSAC, 2.5, inliers);
      if (h.empty()) throw new Error("参考平面未匹配");
      const retained = Array.from(inliers.data as Uint8Array).filter(
        Boolean,
      ).length;
      if (retained < 10 || retained / count < 0.5)
        throw new Error("参考匹配不稳定");
      const values = h.data64F;
      const project = ([x, y]: number[]) => {
        const scale = values[6] * x + values[7] * y + values[8];
        return [
          (values[0] * x + values[1] * y + values[2]) / scale,
          (values[3] * x + values[4] * y + values[5]) / scale,
        ];
      };
      const quad = [
        [rect[0], rect[1]],
        [rect[2], rect[1]],
        [rect[2], rect[3]],
        [rect[0], rect[3]],
      ].map(project);
      const xs = quad.map((p) => p[0]),
        ys = quad.map((p) => p[1]);
      const box: Box = [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
      ];
      if (
        box.some((n) => !Number.isFinite(n)) ||
        box[0] < 0 ||
        box[1] < 0 ||
        box[2] > frame.width ||
        box[3] > frame.height ||
        box[2] - box[0] < 3 ||
        box[3] - box[1] < 3 ||
        box[2] - box[0] > frame.width * 0.4
      )
        throw new Error("部位已经离开可核对画面");
      return {
        box,
        quad,
        ms: performance.now() - started,
        retained: retained / count,
        engine: "OpenCV ORB/RANSAC",
      };
    } finally {
      rgba.delete();
      gray.delete();
      mask.delete();
      keys.delete();
      descriptor.delete();
      pairs.delete();
      a?.delete();
      b?.delete();
      h?.delete();
      inliers?.delete();
    }
  }
  dispose() {
    if (!this.closed) {
      this.closed = true;
      this.descriptor.delete();
      this.orb.delete();
      this.matcher.delete();
    }
  }
}
