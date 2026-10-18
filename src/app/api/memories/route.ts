import {
  reconcileMemories,
  captureSettings,
  setCaptureEnabled,
} from "@/lib/memory/ambient";
import { z, ZodError } from "zod";
import { actor, read, database, localOnly } from "@/lib/db";
import { canRead } from "@/lib/domain";
import { AgentError } from "@/lib/agent/contracts";
import {
  saveMemory,
  listMemories,
  forgetMemory,
  getPersona,
  savePersona,
} from "@/lib/memory/store";
import { readSession } from "@/lib/repositories/sessions";
import { pruneExpired } from "@/lib/repositories/retention";
export const runtime = "nodejs";
function fail(e: unknown) {
  return Response.json(
    {
      error:
        e instanceof AgentError
          ? e.message
          : e instanceof ZodError
            ? "请检查记忆内容、类型与长度"
            : "记忆操作未完成，请检查角色或稍后重试",
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
    const itemId = new URL(r.url).searchParams.get("itemId") || undefined;
    if (itemId && !read().items.some((i) => i.id === itemId && canRead(i, a)))
      throw new AgentError("物品未获授权", 403);
    reconcileMemories(database(), read(), a);
    return Response.json({
      capture: captureSettings(database(), a),
      memories: listMemories(database(), read(), a),
      persona: getPersona(database(), a, itemId),
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(r: Request) {
  try {
    localOnly(r);
    const a = actor(r);
    const p = await r.json();
    if (p.action === "capture") {
      const input = z
        .object({ action: z.literal("capture"), enabled: z.boolean() })
        .strict()
        .parse(p);
      return Response.json({
        capture: setCaptureEnabled(database(), a, input.enabled),
      });
    }
    if (p.action === "persona")
      return Response.json({
        persona: savePersona(database(), read(), a, p.input),
      });
    if (p.action === "saveMethod") {
      const sessionId = z.string().uuid().parse(p.sessionId),
        requestId = z.string().uuid().parse(p.requestId);
      const s = readSession(database(), read(), a, sessionId);
      if (s.status !== "user_resolved")
        throw new AgentError("请先确认这次问题已经解决");
      const steps =
        s.messages.filter((m) => m.role === "assistant").at(-1)?.reply?.steps ||
        [];
      const unique = [
        ...new Map(steps.map((step) => [step.id, step])).values(),
      ];
      if (!unique.length) throw new AgentError("这次没有可以保存的操作步骤");
      return Response.json({
        memory: saveMemory(
          database(),
          read,
          a,
          {
            kind: "method",
            text: (
              "本次最后一轮建议；我反馈有效（用户报告，非设备检测）：\n" +
              unique.map((step) => step.text).join("\n")
            ).slice(0, 1500),
            itemId: s.itemId,
            allowCloud: false,
          },
          undefined,
          "method:" + requestId,
        ),
      });
    }
    if (p.action === "importStory") {
      const id = z.string().parse(p.storyId);
      const s = read();
      const story = s.memories.find(
        (m) =>
          m.id === id &&
          m.author === a &&
          !m.origin &&
          s.items.some((i) => i.id === m.itemId && canRead(i, a)),
      );
      if (!story)
        throw new AgentError("仅能主动引用自己写下且仍可访问的原始故事", 403);
      return Response.json({
        memory: saveMemory(
          database(),
          read,
          a,
          {
            kind: "story",
            text: story.text,
            itemId: story.itemId,
            allowCloud: false,
          },
          undefined,
          "story:" + id,
        ),
      });
    }
    const input = z
      .object({
        memory: z.unknown(),
        id: z.string().uuid().optional(),
        requestId: z.string().uuid(),
      })
      .strict()
      .parse(p);
    return Response.json({
      memory: saveMemory(
        database(),
        read,
        a,
        input.memory,
        input.id,
        input.requestId,
      ),
    });
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(r: Request) {
  try {
    localOnly(r);
    const a = actor(r);
    const p = z
      .object({ id: z.string().uuid() })
      .strict()
      .parse(await r.json());
    forgetMemory(database(), a, p.id);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
