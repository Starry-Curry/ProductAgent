import { actor, localOnly, database, read } from "@/lib/db";
import { readMedia } from "@/lib/life/stories";
export const runtime = "nodejs";
export async function GET(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    localOnly(r);
    const headers = new Headers(r.headers);
    if (!headers.has("x-demo-actor"))
      headers.set(
        "x-demo-actor",
        new URL(r.url).searchParams.get("actor") || "",
      );
    const a = actor(new Request(r.url, { headers }));
    const media = readMedia(database(), read(), a, (await params).id);
    return new Response(new Uint8Array(media.body), {
      headers: {
        "Content-Type": media.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return Response.json({ error: "照片不存在或未获授权" }, { status: 403 });
  }
}
