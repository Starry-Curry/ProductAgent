import { withDemoRequest } from "@/lib/cloud/request";
import { actor, read, localOnly } from "@/lib/db";
import { discover } from "@/lib/discovery";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function GETHandler(r: Request) {
  try {
    localOnly(r);
    const a = actor(r);
    const url = new URL(r.url);
    const scene = url.searchParams.get("scene");
    const value = (key: string) => {
      const raw = url.searchParams.get(key);
      if (raw === null) return undefined;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) throw Error("载荷必须是非负数字");
      return n;
    };
    return Response.json({
      candidates: discover(read(), a, {
        scene: scene === "outdoor" ? "outdoor" : "indoor",
        loadKg: value("loadKg"),
        perShelfKg: value("perShelfKg"),
        foodContact: url.searchParams.get("foodContact") === "true",
      }),
      source: "规则匹配候选 · 非模型生成 · 未实物验证",
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export const GET = withDemoRequest(GETHandler);
