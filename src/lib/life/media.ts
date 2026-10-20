import sharp from "sharp";
import type { DatabaseSync } from "node:sqlite";
import type { Person } from "../domain.ts";
import { AgentError } from "../agent/contracts.ts";
export async function storePhoto(
  db: DatabaseSync,
  actor: Person,
  bytes: Uint8Array,
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
  const existing = db
    .prepare(
      "SELECT id FROM life_media WHERE owner=? AND mime='image/jpeg' AND body=?",
    )
    .get(actor, body) as { id: string } | undefined;
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
