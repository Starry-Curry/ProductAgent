import { z } from "zod";
import { withDemoRequest } from "@/lib/cloud/request";
import { actor, database, localOnly, read } from "@/lib/db";
import { AgentError } from "@/lib/agent/contracts";
import {
  companionData,
  mutateCompanion,
  seedCompanion,
} from "@/lib/companion/store";
import { createReviewedEventPlan } from "@/lib/companion/event-planning";
import { lifeProvider } from "@/lib/life/provider";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function fail(e: unknown) {
  return Response.json(
    {
      error:
        e instanceof z.ZodError
          ? e.issues[0]?.message || "请检查填写内容"
          : e instanceof Error
            ? e.message
            : "操作未完成",
    },
    { status: e instanceof AgentError ? e.status : 400 },
  );
}
export const GET = withDemoRequest(async (r: Request) => {
  try {
    localOnly(r);
    const imageRequest = new URL(r.url).searchParams.get("wishPhoto");
    const rr =
      imageRequest && !r.headers.get("x-demo-actor")
        ? new Request(r, {
            headers: new Headers([
              ...r.headers.entries(),
              [
                "x-demo-actor",
                new URL(r.url).searchParams.get("actor") || "lin",
              ],
            ]),
          })
        : r;
    const a = actor(rr),
      db = database(),
      data = companionData(db, a);
    const photoId = new URL(r.url).searchParams.get("wishPhoto");
    if (photoId) {
      const wish = data.wishes.find((w) => w.id === photoId);
      if (!wish || !wish.photo.startsWith("/api/life/media/"))
        throw new AgentError("照片不存在或未分享", 404);
      const id = wish.photo.split("/media/")[1].split("?")[0];
      const media = db
        .prepare("SELECT mime,body FROM life_media WHERE id=? AND owner=?")
        .get(id, wish.owner) as { mime: string; body: Uint8Array } | undefined;
      if (!media) throw new AgentError("照片不存在", 404);
      return new Response(new Uint8Array(media.body), {
        headers: {
          "Content-Type": media.mime,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return Response.json(data);
  } catch (e) {
    return fail(e);
  }
});
export const POST = withDemoRequest(async (r: Request) => {
  try {
    localOnly(r);
    const a = actor(r),
      db = database();
    const p = z
      .object({ action: z.string(), input: z.unknown().optional() })
      .parse(await r.json());
    if (p.action === "seed") {
      if ((p.input as any)?.confirmed !== true)
        throw new AgentError("请确认载入示例");
      seedCompanion(db);
      return Response.json(companionData(db, a));
    }
    const prepared =
      p.action === "createPlan"
        ? await createReviewedEventPlan(
            read(),
            a,
            z
              .object({ goal: z.string().trim().min(2).max(1000) })
              .strict()
              .parse(p.input).goal,
            lifeProvider(),
          )
        : undefined;
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = mutateCompanion(
        db,
        read(),
        a,
        p.action,
        p.input,
        prepared,
      );
      db.exec("COMMIT");
      return Response.json(result);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (e) {
    return fail(e);
  }
});
