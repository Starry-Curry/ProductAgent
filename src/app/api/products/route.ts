import { withDemoRequest } from "@/lib/cloud/request";
import { localOnly } from "@/lib/db";
import { searchProducts } from "@/lib/products";
async function GETHandler(r: Request) {
  try {
    localOnly(r);
    const q = (new URL(r.url).searchParams.get("q") || "").slice(0, 100);
    return Response.json({
      candidates: searchProducts(q),
      source: "官方资料摘编 · 有限目录",
      requiresConfirmation: true,
    });
  } catch {
    return Response.json({ error: "仅供本地访问" }, { status: 403 });
  }
}

export const GET = withDemoRequest(GETHandler);
