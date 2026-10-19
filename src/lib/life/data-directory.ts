import path from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";

const within = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};
function physical(target: string): string {
  if (existsSync(target)) return realpathSync(target);
  const parent = path.dirname(target);
  return parent === target ? target : path.join(physical(parent), path.basename(target));
}
/** Never open the historical data/ database, another checkout, or a junction into it. */
export function lifeDataDirectory(env: Record<string,string|undefined> = process.env, cwd = process.cwd(), temporary = tmpdir()) {
  const root = physical(cwd);
  const selected = physical(path.resolve(env.PRODUCT_AGENT_DATA_DIR || path.join(root, "data-life-v1")));
  const temporaryRoot = physical(temporary);
  if (within(path.join(root, "data"), selected) || selected === root || selected === temporaryRoot ||
      (!within(root, selected) && !within(temporaryRoot, selected))) {
    throw Error("新版数据目录必须在当前工作区的独立目录或系统临时目录中，禁止连接旧版 data 或其他工作区");
  }
  return selected;
}
