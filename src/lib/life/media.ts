import sharp from "sharp";
import type { DatabaseSync } from "node:sqlite";
import type { Person } from "../domain.ts";
import { AgentError } from "../agent/contracts.ts";
export async function storePhoto(
  db: DatabaseSync,
  actor: Person,
  bytes: Uint8Array,
  purpose: "item" | "story" = "story",
) {
  if (bytes.length > 5_000_000 || bytes.length < 12)
    throw new AgentError("照片需要小于 5MB");
  const image = sharp(bytes, { limitInputPixels: 16_000_000 });
  const meta = await image.metadata();
  if (
    !["jpeg", "png", "webp"].includes(meta.format || "") ||
    (meta.pages || 1) > 1
  )
    throw new AgentError("仅支持单张 JPEG、PNG 或 WebP 图片");
  // Decoding verifies content; re-encoding strips EXIF including location. No original retained.
  const body = await image
    .rotate()
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 84 })
    .toBuffer();
  // Keep story-only assets separate from item photos, whose access can later be shared/gifted.
  const workspace = db
    .prepare("SELECT body FROM workspace WHERE id=1")
    .get() as { body: string } | undefined;
  const itemPhotos: string[] = workspace
    ? (JSON.parse(workspace.body).items || []).map(
        (i: { photo?: string }) => i.photo || "",
      )
    : [];
  const existing =
    purpose === "story"
      ? (
          db
            .prepare(
              "SELECT id FROM life_media WHERE owner=? AND mime='image/jpeg' AND body=?",
            )
            .all(actor, body) as { id: string }[]
        ).find((r) => !itemPhotos.some((url) => url.includes(`/media/${r.id}`)))
      : undefined;
  const id = existing?.id || crypto.randomUUID();
  db.prepare("INSERT OR IGNORE INTO life_media VALUES(?,?,?,?)").run(
    id,
    actor,
    "image/jpeg",
    body,
  );
  return {
    id,
    url: `/api/life/media/${id}?actor=${actor}`,
    notice:
      "已保存经过解码和压缩的照片，已去除 EXIF 定位；未识别照片内容，未上传模型。",
  };
}
