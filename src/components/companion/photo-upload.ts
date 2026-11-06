"use client";
/** Resize on the phone before upload; strip camera metadata and flatten alpha. */
export async function preparePhonePhoto(file: File): Promise<File> {
  if (file.size > 30_000_000)
    throw Error("照片太大，请选择一张小于 30MB 的照片。");
  const url = URL.createObjectURL(file);
  try {
    const picture = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(Error("这张照片暂时无法读取，请选择 JPEG、PNG 或 WebP 照片。"));
      image.src = url;
    });
    const scale = Math.min(
      1,
      1600 / Math.max(picture.naturalWidth, picture.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("照片处理未完成，请重试。");
    ctx.fillStyle = "#faf9f5";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(picture, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(Error("照片处理未完成，请重试。"))),
        "image/jpeg",
        0.84,
      ),
    );
    return new File([blob], "wujian-photo.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
