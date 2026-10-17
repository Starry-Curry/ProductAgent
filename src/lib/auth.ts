export type AuthMode = "local-demo" | "authenticated";
/** This is a local simulation, deliberately disabled outside explicit local-demo mode. */
export function assertLocalDemo(
  r: Request,
  env: Record<string, string | undefined> = process.env,
) {
  if (env.AUTH_MODE !== "local-demo")
    throw new Error("本机角色模拟未启用；真实身份认证尚未接入");
  const rawHost = r.headers.get("host");
  if (!rawHost) throw new Error("缺少请求主机");
  let supplied: URL;
  try {
    supplied = new URL(`http://${rawHost}`);
  } catch {
    throw new Error("无效主机");
  }
  const loopbacks = ["localhost", "127.0.0.1", "[::1]"];
  if (
    !loopbacks.includes(new URL(r.url).hostname) ||
    !loopbacks.includes(supplied.hostname)
  )
    throw new Error("演示身份只允许本机访问");
  if ((r.headers.has("x-forwarded-host") && r.headers.get("x-forwarded-host") !== rawHost) || r.headers.has("forwarded"))
    throw new Error("演示身份不允许代理转发");
  if (r.headers.get("sec-fetch-site") === "cross-site")
    throw new Error("拒绝跨站请求");
  const origin = r.headers.get("origin");
  if (origin && origin !== `${new URL(r.url).protocol}//${rawHost}`)
    throw new Error("不允许跨来源写入");
}
