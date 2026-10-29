import fs from "node:fs";
import path from "node:path";
export const root = path.resolve(
  process.env.BEHAVIOR_EVIDENCE_DIR || "../intelligence-behavior",
);
fs.mkdirSync(root, { recursive: true });
export function saveReport(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
    flush: true,
  });
}
