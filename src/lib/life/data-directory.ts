import path from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";

const within = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};
function physical(target: string): string {
  if (existsSync(target)) return realpathSync(target);
  const parent = path.dirname(target);
  return parent === target
    ? target
    : path.join(physical(parent), path.basename(target));
}
/** Never open the historical data/ database, another checkout, or a junction into it. */
export function lifeDataDirectory(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
  temporary = tmpdir(),
) {
  const root = physical(cwd);
  if (/(?:^|[\\/])ProductAgent-Dev(?:[\\/]|$)/i.test(root))
    throw Error("新版程序禁止从原版工作区启动或写入数据");
  const selected = physical(
    path.resolve(env.PRODUCT_AGENT_DATA_DIR || path.join(root, "data-life-v1")),
  );
  const temporaryRoot = physical(temporary);
  if (env.AUTH_MODE === "public-demo") {
    if (
      env.WUJIAN_DEPLOYMENT !== "cloud" ||
      !env.PRODUCT_AGENT_DATA_DIR ||
      !path.isAbsolute(env.PRODUCT_AGENT_DATA_DIR) ||
      selected === root ||
      selected === path.parse(selected).root ||
      selected === temporaryRoot ||
      /(?:^|[\\/])ProductAgent-Dev(?:[\\/]|$)/i.test(selected) ||
      within(path.join(root, "data"), selected) ||
      within(path.join(root, "data-life-v1"), selected)
    )
      throw Error("云端演示需明确配置独立持久化目录，禁止使用开发数据库");
    if (
      within(root, selected) &&
      !within(path.join(root, ".runtime"), selected)
    )
      throw Error("本机生产模拟只能使用.runtime独立目录");
    return selected;
  }
  if (
    within(path.join(root, "data"), selected) ||
    selected === root ||
    selected === temporaryRoot ||
    (!within(root, selected) && !within(temporaryRoot, selected))
  ) {
    throw Error(
      "新版数据目录必须在当前工作区的独立目录或系统临时目录中，禁止连接旧版 data 或其他工作区",
    );
  }
  return selected;
}
