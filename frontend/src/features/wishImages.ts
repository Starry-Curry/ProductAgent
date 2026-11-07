/** Independently sourced gift ideas. Never resolve wishes from owned item photos. */
export function wishImage(title: string): { src: string; product: string } | null {
  const image = (name: string, product: string) => ({ src: `/illustrations/wishes/${name}.jpg`, product });
  if (/相框/.test(title)) return image("frame", "Nixplay 10.1英寸相框");
  if (/相机|摄影/.test(title)) return image("camera", "instax mini 12");
  if (/咖啡/.test(title)) return image("coffee", "Nespresso Essenza Mini C30");
  if (/耳机/.test(title)) return image("earbuds", "Bose QuietComfort");
  if (/音箱|听歌/.test(title)) return image("speaker", "JBL Go 4");
  if (/杯|陶/.test(title)) return image("cup", "KINTO CERAMIC LAB 陶杯");
  if (/柔和.*灯/.test(title)) return image("soft-lamp", "FADO 柔光球灯");
  if (/灯|照明/.test(title)) return image("lamp", "TÄRNABY 复古床头灯");
  if (/绿|植物|阳台|花/.test(title)) return image("plant", "小盆金钱树");
  return null;
}
