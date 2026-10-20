import { withDemoRequest } from "@/lib/cloud/request";
import { replayRun } from "@/lib/ai/harness";
import type { Run } from "@/lib/ai/types";
import { actor, database, localOnly, read } from "@/lib/db";
import { listRuns, recordFeedback, accessibleRun } from "@/lib/service-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function GETHandler(r: Request) {
  try {
    localOnly(r);
    const a = actor(r);
    const url = new URL(r.url);
    if (url.searchParams.get("replay") === "1") {
      const row = database()
        .prepare("SELECT body FROM service_runs WHERE id=?")
        .get(url.searchParams.get("runId") || "") as
        { body: string } | undefined;
      const run = row && (JSON.parse(row.body) as Run | undefined);
      if (!run || !accessibleRun(run, read(), a))
        return Response.json(
          { error: "记录不存在或未获授权" },
          { status: 403 },
        );
      return Response.json({ replay: replayRun(run) });
    }
    return Response.json({
      records: listRuns(
        database(),
        read(),
        a,
        new URL(r.url).searchParams.get("itemId") || "",
      ),
    });
  } catch {
    return Response.json({ error: "无法读取记录" }, { status: 403 });
  }
}
async function POSTHandler(r: Request) {
  try {
    localOnly(r);
    const a = actor(r);
    const p = await r.json();
    if (typeof p?.runId !== "string" || p.runId.length > 100)
      throw new Error("运行编号无效");
    return Response.json({
      feedback: recordFeedback(database(), read, a, p.runId, p.outcome),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "反馈未保存" },
      { status: 400 },
    );
  }
}

export const GET = withDemoRequest(GETHandler);

export const POST = withDemoRequest(POSTHandler);
