import { loadOpenCv, LocalTracker, type Box } from "./opticalFlow";
type Result = {
  box: Box;
  quad: number[][];
  ms: number;
  retained: number;
  engine?: string;
};
export type Tracker = {
  engine?: string;
  update: (frame: HTMLCanvasElement) => Result | Promise<Result>;
  dispose: () => void;
};
let engine: Promise<typeof import("./vitTracker") | null> | undefined;
export async function warmTracker() {
  if (!engine)
    engine = (async () => {
      try {
        const module = await import("./vitTracker");
        await module.loadVitTrack();
        return module;
      } catch {
        return null;
      }
    })();
  const module = await engine;
  if (!module) await loadOpenCv();
  return module;
}
export async function createTracker(
  frame: HTMLCanvasElement,
  box: Box,
): Promise<Tracker> {
  const module = await warmTracker();
  if (module) return module.VitTracker.create(frame, box);
  const { cv } = await loadOpenCv();
  return new LocalTracker(cv, frame, box);
}
