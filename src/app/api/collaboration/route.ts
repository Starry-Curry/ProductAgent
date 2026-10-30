import { withDemoRequest } from "@/lib/cloud/request";
import { actor, database, read, localOnly } from "@/lib/db";
import { householdMembers, collaborate } from "@/lib/collaboration";
import { visible } from "@/lib/domain";
import { AgentError } from "@/lib/agent/contracts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withDemoRequest(async (r: Request) => {
  try {
    localOnly(r);
    const a = actor(r);
    return Response.json({
      members: householdMembers(database(), a),
      workspace: visible(read(), a),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "无法读取" },
      { status: 403 },
    );
  }
});
export const POST = withDemoRequest(async (r: Request) => {
  try {
    localOnly(r);
    return Response.json(
      collaborate(database(), read, actor(r), await r.json()),
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof AgentError ? e.message : "协作内容无效" },
      { status: e instanceof AgentError ? e.status : 400 },
    );
  }
});
