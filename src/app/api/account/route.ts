import {
  assertAccountOrigin,
  readAccount,
  login,
  logout,
} from "@/lib/accounts";
import { AgentError } from "@/lib/agent/contracts";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(r: Request) {
  if (process.env.AUTH_MODE !== "authenticated")
    return Response.json({ mode: "demo" });
  try {
    assertAccountOrigin(r);
    return Response.json(
      { mode: "authenticated", account: readAccount(r) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { mode: "authenticated", account: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
export async function POST(r: Request) {
  try {
    if (process.env.AUTH_MODE !== "authenticated")
      throw new AgentError("当前不是独立账号服务", 403);
    assertAccountOrigin(r);
    const v = z
      .object({
        action: z.enum(["register", "login", "logout"]),
        name: z.string().max(32).optional(),
        password: z.string().max(128).optional(),
      })
      .strict()
      .parse(await r.json());
    if (v.action === "logout") {
      logout(r);
      return Response.json(
        { ok: true },
        {
          headers: {
            "Set-Cookie":
              "wujian_account=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          },
        },
      );
    }
    const result = login(
      v.name || "",
      v.password || "",
      v.action === "register",
    );
    return Response.json(
      { account: result.account },
      { headers: { "Set-Cookie": result.cookie, "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof AgentError ? e.message : "登录信息无效" },
      { status: e instanceof AgentError ? e.status : 400 },
    );
  }
}
