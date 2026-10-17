import { actor, read, write, localOnly } from "@/lib/db";
import { visible } from "@/lib/domain";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(r: Request) {
  try {
    localOnly(r);
    const a = actor(r);
    return Response.json(visible(read(), a));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 403 });
  }
}
export async function POST(r: Request) {
  try {
    localOnly(r);
    const a = actor(r);
    const { action, ...p } = await r.json();
    return Response.json(visible(write(a, action, p), a));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
