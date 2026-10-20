import { withDemoRequest } from "@/lib/cloud/request";
import { z, ZodError } from "zod";
import { actor, localOnly, database, read } from "@/lib/db";
import { rooms } from "@/lib/home/contracts";
import { placements, placeItem, decideAction } from "@/lib/home/store";
import { AgentError } from "@/lib/agent/contracts";
export const runtime = "nodejs";
function failure(e: unknown) {
  return Response.json(
    {
      error:
        e instanceof AgentError
          ? e.message
          : e instanceof ZodError || e instanceof SyntaxError
            ? "请求内容或摆放范围无效"
            : "操作未完成，请检查权限后重试",
    },
    {
      status:
        e instanceof AgentError
          ? e.status
          : e instanceof ZodError || e instanceof SyntaxError
            ? 400
            : 403,
    },
  );
}
async function GETHandler(r: Request) {
  try {
    localOnly(r);
    const a = actor(r);
    return Response.json({
      rooms,
      placements: placements(database(), read(), a),
    });
  } catch (e) {
    return failure(e);
  }
}
async function POSTHandler(r: Request) {
  try {
    localOnly(r);
    const a = actor(r);
    const p = await r.json();
    if (p.action === "place")
      return Response.json({
        placement: placeItem(database(), read, a, p.input),
      });
    const v = z
      .object({ action: z.enum(["confirm", "cancel"]), id: z.string().uuid() })
      .strict()
      .parse(p);
    return Response.json(decideAction(database(), read, a, v.id, v.action));
  } catch (e) {
    return failure(e);
  }
}

export const GET = withDemoRequest(GETHandler);

export const POST = withDemoRequest(POSTHandler);
