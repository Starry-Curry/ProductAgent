import { z, ZodError } from "zod";
import { actor, read, database, localOnly } from "@/lib/db";
import { AgentError } from "@/lib/agent/contracts";
import { respond, handoff } from "@/lib/agent/service";
import { lifeProvider } from "@/lib/life/provider";
import {
  listSessions,
  attachSession,
  readSession,
  recordSessionFeedback,
  closeSession,
} from "@/lib/repositories/sessions";
import { pruneExpired } from "@/lib/repositories/retention";
export const runtime = "nodejs";
function fail(e: unknown) {
  return Response.json(
    {
      error:
        e instanceof AgentError
          ? e.message
          : e instanceof ZodError
            ? "请求内容或长度无效"
            : "请求未完成，请检查本机角色并重试",
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
export async function GET(r: Request) {
  try {
    localOnly(r);
    const a = actor(r);
    pruneExpired(database(), a);
    const p = new URL(r.url).searchParams;
    return Response.json(
      p.has("sessionId")
        ? { session: readSession(database(), read(), a, p.get("sessionId")!) }
        : {
            sessions: listSessions(
              database(),
              read(),
              a,
              p.get("itemId") || undefined,
              p.get("mode") || "service",
            ),
          },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(r: Request) {
  try {
    localOnly(r);
    const a = actor(r);
    const p = await r.json();
    pruneExpired(database(), a);
    if (p.action === "attach") {
      const v = z
        .object({
          sessionId: z.string().uuid(),
          itemId: z.string().min(1).max(100),
          expectedRevision: z.number().int().nonnegative(),
        })
        .strict()
        .parse(p.input);
      return Response.json({
        session: attachSession(
          database(),
          read,
          a,
          v.sessionId,
          v.itemId,
          v.expectedRevision,
        ),
      });
    }
    if (p.action === "feedback") {
      const input = z
        .object({
          sessionId: z.string().uuid(),
          requestId: z.string().uuid(),
          outcome: z.enum(["completed", "unresolved", "tried"]),
          reason: z.string().max(500).optional(),
          stepId: z.string().max(100).optional(),
        })
        .strict()
        .parse(p.input);
      return Response.json({
        session: recordSessionFeedback(database(), read, a, input),
      });
    }
    if (p.action === "handoff")
      return Response.json(handoff(database(), read, a, p.input));
    return Response.json(
      await respond(database(), read, a, p, lifeProvider()),
    );
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(r: Request) {
  try {
    localOnly(r);
    const a = actor(r);
    const p = z.object({ sessionId: z.string().uuid() }).parse(await r.json());
    closeSession(database(), read(), a, p.sessionId);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
