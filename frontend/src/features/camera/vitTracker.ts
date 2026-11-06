/** Apache-2.0 adaptation of OpenCV TrackerVit preprocessing/decoding.
 * See vendor/vittrack/NOTICE.md for pinned source and model provenance.
 * No category-specific coordinates, saved boxes or cloud calls occur here. */
import * as ort from "onnxruntime-web/wasm";
import modelUrl from "../../vendor/vittrack/vittrack.onnx?url";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import moduleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import type { Box } from "./opticalFlow";

let ready: Promise<ort.InferenceSession> | undefined;
export function loadVitTrack() {
  if (!ready) {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: moduleUrl };
    ready = ort.InferenceSession.create(modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  }
  return ready;
}
const means = [0.485, 0.456, 0.406],
  std = [0.229, 0.224, 0.225];
type Crop = { tensor: ort.Tensor; size: number; x: number; y: number };
function crop(
  frame: HTMLCanvasElement,
  box: Box,
  factor: number,
  side: number,
): Crop {
  const width = box[2] - box[0],
    height = box[3] - box[1];
  const size = Math.ceil(Math.sqrt(width * height) * factor);
  if (
    !Number.isFinite(size) ||
    size < 8 ||
    size > Math.max(frame.width, frame.height) * 4
  )
    throw new Error("目标尺寸异常，重新定位。");
  const x = Math.trunc(box[0] + (width - size) / 2),
    y = Math.trunc(box[1] + (height - size) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = "black";
  g.fillRect(0, 0, side, side);
  g.drawImage(frame, x, y, size, size, 0, 0, side, side);
  const rgba = g.getImageData(0, 0, side, side).data,
    area = side * side,
    values = new Float32Array(area * 3);
  // OpenCV's reference uses BGR image input without swapRB.
  for (let channel = 0; channel < 3; channel++)
    for (let pixel = 0; pixel < area; pixel++)
      values[channel * area + pixel] =
        (rgba[pixel * 4 + 2 - channel] / 255 - means[channel]) / std[channel];
  canvas.width = 0;
  canvas.height = 0;
  return {
    tensor: new ort.Tensor("float32", values, [1, 3, side, side]),
    size,
    x,
    y,
  };
}

export class VitTracker {
  readonly engine = "ViTTrack";
  private disposed = false;
  private constructor(
    private session: ort.InferenceSession,
    private template: ort.Tensor,
    private box: Box,
  ) {}
  static async create(frame: HTMLCanvasElement, box: Box) {
    const session = await loadVitTrack();
    return new VitTracker(session, crop(frame, box, 2, 128).tensor, [...box]);
  }
  async update(frame: HTMLCanvasElement) {
    if (this.disposed) throw new Error("跟随已经停止");
    const started = performance.now(),
      search = crop(frame, this.box, 4, 256);
    let outputs: ort.InferenceSession.OnnxValueMapType | undefined;
    try {
      outputs = await this.session.run({
        template: this.template,
        search: search.tensor,
      });
      if (this.disposed) throw new Error("跟随已经停止");
      const confidence = outputs.output1.data as Float32Array,
        sizeMap = outputs.output2.data as Float32Array,
        offset = outputs.output3.data as Float32Array;
      let best = -1,
        score = -Infinity;
      for (let i = 0; i < 256; i++) {
        const row = Math.floor(i / 16),
          col = i % 16;
        const hann =
          0.5 *
          (1 - Math.cos((2 * Math.PI * (row + 1)) / 17)) *
          0.5 *
          (1 - Math.cos((2 * Math.PI * (col + 1)) / 17));
        const value = confidence[i] * hann;
        if (value > score) {
          score = value;
          best = i;
        }
      }
      if (best < 0 || score < 0.2)
        throw new Error("目标不够清晰，自动重新定位。");
      const cx = ((best % 16) + offset[best]) / 16,
        cy = (Math.floor(best / 16) + offset[256 + best]) / 16;
      const width = sizeMap[best] * search.size,
        height = sizeMap[256 + best] * search.size;
      const x = cx * search.size + search.x - width / 2,
        y = cy * search.size + search.y - height / 2;
      const next: Box = [
        Math.max(0, x),
        Math.max(0, y),
        Math.min(frame.width, x + width),
        Math.min(frame.height, y + height),
      ];
      const area = (next[2] - next[0]) * (next[3] - next[1]),
        previousArea =
          (this.box[2] - this.box[0]) * (this.box[3] - this.box[1]);
      if (
        next.some((value) => !Number.isFinite(value)) ||
        width < 8 ||
        height < 8 ||
        area < 64 ||
        area > frame.width * frame.height * 0.9 ||
        area / previousArea < 0.35 ||
        area / previousArea > 2.5
      )
        throw new Error("目标位置变化较大，自动重新定位。");
      this.box = next;
      return {
        box: next,
        quad: [
          [next[0], next[1]],
          [next[2], next[1]],
          [next[2], next[3]],
          [next[0], next[3]],
        ],
        ms: performance.now() - started,
        retained: score,
        score,
        engine: this.engine,
      };
    } finally {
      search.tensor.dispose();
      if (outputs) Object.values(outputs).forEach((value) => value.dispose());
    }
  }
  dispose() {
    if (!this.disposed) {
      this.disposed = true;
      this.template.dispose();
    }
  }
}
