import { withDemoRequest } from "@/lib/cloud/request";
import { actor, database, read, localOnly } from "@/lib/db";
import { createLifeItem } from "@/lib/life/intake";
import {
  adapterState,
  analyzeOwnedLamp,
  grantSoftware,
  executeSoftware,
  readSoftware,
} from "@/lib/devices/software-lab";
import { AgentError } from "@/lib/agent/contracts";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = withDemoRequest(async (r: Request) => {
  try {
    localOnly(r);
    const a = actor(r),
      db = database();
    if (process.env.WUJIAN_ENABLE_DEVICE_LAB !== "true")
      throw new AgentError("软件设备实验未启用", 403);
    const v = z
      .object({
        action: z.enum([
          "create",
          "analyze",
          "grant",
          "revoke",
          "read",
          "execute",
          "status",
        ]),
        itemId: z.string().max(100).optional(),
        confirmed: z.boolean().optional(),
        requestId: z.string().uuid().optional(),
        brightness: z.number().int().min(0).max(100).optional(),
      })
      .strict()
      .parse(await r.json());
    if (v.action === "create") {
      if (!v.confirmed || !v.requestId)
        throw new AgentError("请确认创建合成持有的软件灯");
      return Response.json(
        createLifeItem(db, read, a, {
          name: "自有虚拟灯（软件实验）",
          model: "WUJIAN-SOFTWARE-LAMP-1",
          brand: "Wujian",
          category: "电子设备",
          lifecycle: "长期耐用",
          availability: "available",
          ownsConfirmed: true,
          synthetic: true,
          requestId: v.requestId,
        }),
      );
    }
    const id = v.itemId;
    if (!id || !read().items.some((i) => i.id === id && i.owner === a))
      throw new AgentError("物品未获授权", 403);
    if (v.action === "status")
      return Response.json({
        adapter: adapterState(db, a, id),
        simulated: true,
      });
    if (v.action === "analyze")
      return Response.json({
        adapter: await analyzeOwnedLamp(db, read, a, id),
      });
    if (v.action === "grant" || v.action === "revoke") {
      if (!v.confirmed) throw new AgentError("请明确确认授权变化");
      return Response.json(
        grantSoftware(db, read, a, id, v.action === "grant"),
      );
    }
    if (v.action === "read")
      return Response.json(await readSoftware(db, read, a, id));
    if (!v.requestId || v.brightness === undefined)
      throw new AgentError("缺少操作请求或亮度");
    return Response.json(
      await executeSoftware(db, read, a, {
        itemId: id,
        requestId: v.requestId,
        brightness: v.brightness,
        confirmed: v.confirmed === true,
      }),
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof AgentError
            ? e.message
            : "软件分析或执行失败，未声称成功",
      },
      { status: e instanceof AgentError ? e.status : 503 },
    );
  }
});
