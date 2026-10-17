import { read, localOnly } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  r: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    localOnly(r);
    const { token } = await params;
    const g = read().gifts.find((g) => g.token === token && !g.revoked);
    if (!g)
      return Response.json(
        { error: "礼物链接不存在或已撤销" },
        { status: 404 },
      );
    return Response.json({
      itemName: g.itemName,
      message: g.message,
      nickname: g.nickname,
      stories: g.stories,
      storyAuthors: (g.storySnapshots || []).map((s) => s.author),
      includeKnowledge: g.includeKnowledge,
      claimed: !!g.claimedBy,
    });
  } catch {
    return Response.json({ error: "当前仅支持本地礼物预览" }, { status: 403 });
  }
}
