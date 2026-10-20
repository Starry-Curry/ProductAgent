import { timingSafeEqual, createHash } from "node:crypto";
import {
  assertPublicRequest,
  publicDemo,
  publicOrigin,
  readVisitor,
  issueVisitor,
  registry,
  visitorCookie,
  CloudError,
} from "@/lib/cloud/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const hash = (s: string) => createHash("sha256").update(s).digest();
const cookie = (value: string, age: number) =>
  `${visitorCookie}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${publicOrigin().startsWith("https:") ? "; Secure" : ""}`;
export async function GET(r: Request) {
  if (!publicDemo())
    return Response.json({ publicDemo: false, authorized: true });
  try {
    assertPublicRequest(r);
    readVisitor(r);
    return Response.json(
      { publicDemo: true, authorized: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        publicDemo: true,
        authorized: false,
        invitationRequired: !!process.env.DEMO_ACCESS_CODE,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
export async function POST(r: Request) {
  try {
    if (!publicDemo()) throw new CloudError("disabled", "公开演示未启用", 404);
    assertPublicRequest(r);
    if (Number(r.headers.get("content-length") || 0) > 2048)
      throw new CloudError("body_limit", "请求过大", 413);
    const reader = r.body?.getReader();
    let body = "",
      size = 0;
    if (reader)
      while (true) {
        const row = await reader.read();
        if (row.done) break;
        size += row.value.length;
        if (size > 2048) {
          await reader.cancel();
          throw new CloudError("body_limit", "请求过大", 413);
        }
        body += new TextDecoder().decode(row.value);
      }
    const p = JSON.parse(body);
    if (p.consent !== true)
      throw new CloudError("consent_required", "请确认临时演示空间说明", 400);
    if (
      process.env.DEMO_ACCESS_CODE &&
      (typeof p.code !== "string" ||
        !timingSafeEqual(hash(p.code), hash(process.env.DEMO_ACCESS_CODE)))
    )
      throw new CloudError("invitation_required", "邀请码不正确", 403);
    try {
      readVisitor(r);
      return Response.json({ ok: true });
    } catch {}
    const result = issueVisitor();
    return Response.json(
      { ok: true, expiresAt: result.expires },
      {
        headers: {
          "Set-Cookie": cookie(
            result.token,
            Math.floor((result.expires - Date.now()) / 1000),
          ),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (e) {
    return Response.json(
      {
        error: e instanceof CloudError ? e.message : "无法创建演示空间",
        code: e instanceof CloudError ? e.code : "invalid_request",
      },
      { status: e instanceof CloudError ? e.status : 400 },
    );
  }
}
export async function DELETE(r: Request) {
  try {
    assertPublicRequest(r);
    const v = readVisitor(r),
      db = registry();
    try {
      db.prepare("UPDATE visitors SET expires=0 WHERE id=?").run(v.id);
    } finally {
      db.close();
    }
    return Response.json(
      { ok: true },
      { headers: { "Set-Cookie": cookie("", 0), "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "会话无效" }, { status: 401 });
  }
}
