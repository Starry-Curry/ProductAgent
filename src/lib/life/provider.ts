import { createProvider } from "../ai/provider.ts";
export function cloudStatus(env: Record<string, string | undefined> = process.env) {
  if (!env.AI_API_KEY?.trim()) return { state: "missing_key", ready: false, message: "未配置密钥：请在本工作区 .env.local 填写北京百炼 Key" };
  if (!env.AI_BASE_URL || !env.AI_MODEL) return { state: "missing_config", ready: false, message: "未配置模型或服务地址：请检查 .env.local" };
  try {
    const u = new URL(env.AI_BASE_URL);
    if (u.protocol !== "https:" || u.username || u.password) throw Error();
  } catch { return { state: "invalid_config", ready: false, message: "模型地址配置无效：需要不带账号的 HTTPS 地址" }; }
  if (env.AI_ALLOW_PAID_CALLS !== "true" || env.WUJIAN_ALLOW_PAID_CALLS !== "true")
    return { state: "unauthorized", ready: false, message: "未开启费用授权；默认不发送模型请求。获准后以 npm run start:life -- --cloud 手动启用" };
  return { state: "ready", ready: true, message: "已准备就绪（配置及费用授权齐备，尚不代表网络或账户已验证）" };
}
/** Separate task authorization from a historical .env.local paid flag. */
export function lifeProvider() {
  return createProvider({
    ...process.env,
    AI_ALLOW_PAID_CALLS:
      process.env.WUJIAN_ALLOW_PAID_CALLS === "true"
        ? process.env.AI_ALLOW_PAID_CALLS
        : "false",
  });
}
