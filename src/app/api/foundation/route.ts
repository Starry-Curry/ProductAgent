import { z, ZodError } from "zod";
import { withDemoRequest } from "@/lib/cloud/request";
import { actor, database, localOnly, read } from "@/lib/db";
import { AgentError } from "@/lib/agent/contracts";
import {
  createTask,
  listTasks,
  resolveTaskContext,
  taskRuns,
  taskOutcomes,
  recordOutcome,
  recoverRun,
  amendOutcome,
} from "@/lib/foundation/tasks";
import { readEvidenceClaims } from "@/lib/foundation/evidence";
import { registeredCapabilities } from "@/lib/foundation/capabilities";
export const runtime = "nodejs";
const error = (e: unknown) =>
  Response.json(
    {
      error:
        e instanceof AgentError
          ? e.message
          : e instanceof ZodError
            ? "请求字段无效"
            : "请求未完成",
    },
    { status: e instanceof AgentError ? e.status : 400 },
  );
export const GET = withDemoRequest(async (r: Request) => {
  try {
    localOnly(r);
    const a = actor(r),
      db = database(),
      s = read(),
      p = new URL(r.url).searchParams;
    if (p.has("itemId"))
      return Response.json({...readEvidenceClaims(db, s, a, p.get("itemId")!),capabilities:registeredCapabilities(db,s,a,p.get("itemId")!)});
    if (p.has("taskId")) {
      const id = z.string().uuid().parse(p.get("taskId"));
      return Response.json({
        ...resolveTaskContext(db, s, a, id),
        runs: taskRuns(db, s, a, id),
        outcomes: taskOutcomes(db, s, a, id),
      });
    }
    return Response.json({ tasks: listTasks(db, s, a) });
  } catch (e) {
    return error(e);
  }
});
export const POST = withDemoRequest(async (r: Request) => {
  try {
    localOnly(r);
    const a = actor(r),
      db = database(),
      p = z
        .object({
          action: z.enum(["create", "outcome", "recover", "amend_outcome"]),
          input: z.unknown(),
        })
        .strict()
        .parse(await r.json());
    if (p.action === "create")
      return Response.json({ task: createTask(db, read, a, p.input) });
    if (p.action === "outcome")
      return Response.json({ outcome: recordOutcome(db, read, a, p.input) });
    if (p.action === "amend_outcome") return Response.json({outcome:amendOutcome(db,read,a,p.input)});
    const v = z.object({ runId: z.string().uuid() }).strict().parse(p.input);
    return Response.json({ run: recoverRun(db, read(), a, v.runId) });
  } catch (e) {
    return error(e);
  }
});
