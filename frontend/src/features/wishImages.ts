/** Wishes describe desired categories, rather than verified purchased SKUs. */
export function wishImage(title: string): { src: string; framed?: boolean } {
  const base = "/illustrations/wishes/";
  if (/相框/.test(title)) return { src: "/illustrations/memory-sea-v1.png", framed: true };
  if (/相机|摄影/.test(title)) return { src: base + "camera.jpg" };
  if (/咖啡/.test(title)) return { src: base + "coffee.jpg" };
  if (/耳机/.test(title)) return { src: base + "earbuds.jpg" };
  if (/音箱|听歌/.test(title)) return { src: base + "speaker.jpg" };
  if (/杯|陶/.test(title)) return { src: base + "cup.jpg" };
  if (/灯|照明/.test(title)) return { src: base + "lamp.jpg" };
  if (/绿|植物|阳台|花/.test(title)) return { src: "/illustrations/memory-reading-v1.png" };
  return { src: "/illustrations/memory-gift-v1.png" };
}
