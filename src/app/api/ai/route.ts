import { withDemoRequest } from "@/lib/cloud/request";
import { actor, read, localOnly, database } from "@/lib/db";
import { canRead } from "@/lib/domain";
import { runAssist } from "@/lib/ai/harness";
import { createProvider } from "@/lib/ai/provider";
import { saveRun, accessibleRun } from "@/lib/service-store";
export const runtime = "nodejs";
async function POSTHandler(r: Request) {
  try {
    localOnly(r);
    const a = actor(r);
    let p;
    try {
      p = await r.json();
    } catch {
      return Response.json({ error: "请求格式无效" }, { status: 400 });
    }
    if (
      !p ||
      typeof p.question !== "string" ||
      !p.question.trim() ||
      p.question.length > 2000 ||
      typeof p.itemId !== "string" ||
      (p.mode !== undefined && p.mode !== "service" && p.mode !== "ideas")
    )
      return Response.json(
        { error: "请输入 1—2000 字的问题，并选择有效服务类型" },
        { status: 400 },
      );
    const state = read();
    if (!state.items.some((i) => i.id === p.itemId && canRead(i, a)))
      return Response.json(
        { error: "物品不存在或没有访问权限" },
        { status: 403 },
      );
    const result = await runAssist(
      state,
      a,
      {
        itemId: p.itemId,
        question: p.question.trim(),
        mode: p.mode || "service",
      },
      createProvider(),
      (run) => saveRun(database(), run),
    );
    // Re-check after network I/O: ownership and sharing may have changed.
    if (!accessibleRun(result.run, read(), a)) {
      result.run.status = "failed";
      result.run.errorCode = "scope_changed";
      delete result.run.validatedAnswer;
      result.run.events?.push({
        sequence: result.run.events.length + 1,
        stage: "failed",
        at: new Date().toISOString(),
        elapsedMs: result.run.latencyMs,
        detail: "scope_changed",
      });
      saveRun(database(), result.run);
      return Response.json(
        { error: "物品授权或型号已改变，请重新打开物品。" },
        { status: 409 },
      );
    }
    saveRun(database(), result.run);
    if (result.error)
      return Response.json(
        {
          error: result.error,
          run: result.run,
          ...(result.run.errorCode === "not_configured"
            ? { configured: false }
            : {}),
        },
        {
          status:
            result.run.status === "needs_identity"
              ? 422
              : result.run.status === "unavailable"
                ? 503
                : 502,
        },
      );
    return Response.json({
      ...result.answer,
      source: "真实模型选择事实 · 资料原文校验",
      model: result.run.model,
      evidence:
        "回答逐条对应版本化资料原文；拒绝自由改写，未验证实物状态或操作结果。",
      run: result.run,
      citations: result.pack
        ? [
            {
              ...result.pack.source,
              packId: result.pack.id,
              model: result.pack.model,
              claims: result.pack.claims.filter((c) =>
                result.answer?.evidenceIds.includes(c.id),
              ),
            },
          ]
        : [],
    });
  } catch {
    return Response.json(
      { error: "服务请求失败，请检查演示角色或稍后重试。" },
      { status: 403 },
    );
  }
}

export const POST = withDemoRequest(POSTHandler);
