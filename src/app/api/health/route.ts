import { registry, publicDemo, publicOrigin } from "@/lib/cloud/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    if (publicDemo()) {
      publicOrigin();
      const db = registry();
      try {
        db.prepare("SELECT 1").get();
      } finally {
        db.close();
      }
    }
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
