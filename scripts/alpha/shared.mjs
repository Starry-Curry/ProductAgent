import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const root = path.join(
  fileURLToPath(new URL("../../", import.meta.url)),
  ".runtime/intelligence-alpha",
);
fs.mkdirSync(root, { recursive: true });
export function saveReport(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
    flush: true,
  });
}
